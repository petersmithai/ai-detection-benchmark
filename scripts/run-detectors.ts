/**
 * Collect readings from every detector over every sample.
 *
 *   npm run run-detectors -- --cycle 2026-10
 *   npm run run-detectors -- --cycle 2026-10 --detector winston-ai --runs 1
 *
 * Each sample is read twice per detector, on separate passes rather than
 * back to back, because a detector that answers 71 and then 44 for the same
 * paragraph an hour apart is telling you something a single reading hides.
 * Results are appended incrementally, so an interrupted run resumes instead of
 * paying for every call again.
 */

import { readFileSync } from 'node:fs';
import { probe } from '../adapters/index.js';
import { fail, heading, info, ok, readJson, repoPath, sha256, writeJson } from './lib/io.js';
import { normalize } from './lib/text.js';
import type { Detector, Reading, Sample } from './lib/types.js';

const CONCURRENCY = 4;

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

function corpusDir(sample: Sample): string {
  switch (sample.class) {
    case 'human':
      return 'human';
    case 'ai':
      return 'ai';
    case 'fp':
      return 'false-positive';
    case 'hybrid':
      return 'hybrid';
  }
}

/**
 * Load a sample's text and refuse to send it if it does not hash to what
 * samples.json says. A corpus that drifted after the cycle was committed would
 * otherwise produce numbers that look fine and mean nothing.
 */
function loadVerified(sample: Sample): string {
  const path = repoPath('datasets', corpusDir(sample), 'texts', `${sample.id}.txt`);
  const text = normalize(readFileSync(path, 'utf8'));
  const actual = sha256(text);
  if (actual !== sample.sha256) {
    throw new Error(`hash mismatch for ${sample.id}: committed ${sample.sha256.slice(0, 12)}, local ${actual.slice(0, 12)}`);
  }
  return text;
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++] as T;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const cycle = arg('cycle');
  const only = process.argv.includes('--detector') ? arg('detector') : null;
  const runs = Number(arg('runs', '2'));
  const cycleDir = repoPath('data', 'cycles', cycle);
  const outPath = `${cycleDir}/detector-results.json`;

  const samples = readJson<Sample[]>(`${cycleDir}/samples.json`);
  const registry = readJson<{ detectors: Detector[] }>(repoPath('detectors/registry.json'));
  const detectors = registry.detectors.filter((d) => (only ? d.slug === only : true));
  if (detectors.length === 0) throw new Error(`no detector matches --detector ${only}`);

  let existing: Reading[] = [];
  try {
    existing = readJson<Reading[]>(outPath);
  } catch {
    /* first run */
  }
  const done = new Set(existing.map((r) => `${r.detector}|${r.sampleId}|${r.run}`));

  const texts = new Map<string, { id: string; text: string; words: number }>();
  for (const s of samples) {
    texts.set(s.id, { id: s.id, text: loadVerified(s), words: s.words });
  }

  const results: Reading[] = [...existing];
  const manualNeeded: string[] = [];

  for (let run = 1; run <= runs; run++) {
    heading(`Cycle ${cycle} — pass ${run} of ${runs}`);
    for (const detector of detectors) {
      if (detector.access === 'manual') {
        if (run === 1) manualNeeded.push(detector.slug);
        continue;
      }
      const todo = samples.filter((s) => !done.has(`${detector.slug}|${s.id}|${run}`));
      if (todo.length === 0) {
        info(`${detector.name}: pass ${run} already complete`);
        continue;
      }

      let errors = 0;
      await pool(todo, CONCURRENCY, async (sample) => {
        const reading = await probe(detector, texts.get(sample.id)!, run);
        if (reading.error) errors++;
        results.push(reading);
        done.add(`${detector.slug}|${sample.id}|${run}`);
        // Written after every reading: a paid API call should never be lost to
        // a crash three samples later.
        writeJson(outPath, results);
      });

      const line = `${detector.name}: ${todo.length} readings, ${errors} error(s)`;
      errors === 0 ? ok(line) : fail(line);
    }
  }

  if (manualNeeded.length > 0) {
    heading('Manual collection required');
    for (const slug of manualNeeded) {
      info(`${slug}: paste each sample into the web UI and record readings in ${`data/cycles/${cycle}/manual/${slug}.csv`}`);
    }
    info('Then run: npm run -- import-manual --cycle ' + cycle);
    info('Format: sampleId,run,aiProbability,operator  (see docs/RUNNING.md)');
  }

  ok(`${results.length} total readings -> data/cycles/${cycle}/detector-results.json`);
}

main().catch((err) => {
  fail((err as Error).message);
  process.exitCode = 1;
});
