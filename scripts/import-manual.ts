/**
 * Fold hand-collected readings into detector-results.json.
 *
 *   npm run import-manual -- --cycle 2026-10
 *
 * Three of the twelve detectors have no public API at all. But any detector can
 * be collected by hand — a free web tier, an expired trial, a plan you did not
 * buy — so this accepts a sheet for any slug in the registry, not just the ones
 * marked manual. A cycle collected entirely by hand is a valid cycle; it is just
 * slower.
 *
 * Where a detector is read by hand, run 1 and run 2 should be two operators
 * working independently, which means the consistency metric measures
 * inter-operator agreement for that tool rather than repeat-call stability.
 * That is a real difference in what the number means, so it is recorded on the
 * leaderboard row rather than papered over.
 *
 * Sheets come from `npm run collection-sheet` and hold numbers AS THE VENDOR
 * DISPLAYS THEM. Conversion to a common 0-100 AI axis happens here, using the
 * scale in detectors/registry.json — never in the operator's head.
 */

import { existsSync, readFileSync } from 'node:fs';
import { toAiProbability } from '../adapters/index.js';
import { fail, info, heading, ok, readJson, repoPath, writeJson } from './lib/io.js';
import type { Detector, Reading, Sample } from './lib/types.js';

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith('#'));
  if (lines.length === 0) return [];
  const header = (lines.shift() as string).split(',').map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

interface Entry {
  sampleId: string;
  run: number;
  raw: string;
  notes: string;
}

/**
 * Accepts both shapes: the wide sheet this repo generates (one row per sample,
 * run1/run2 columns) and the long form (one row per reading). Hand entry is
 * error-prone enough without insisting on a layout.
 */
function toEntries(rows: Array<Record<string, string>>): Entry[] {
  const out: Entry[] = [];
  for (const row of rows) {
    const sampleId = row.sampleId ?? '';
    const notes = row.notes ?? '';
    if ('run' in row) {
      out.push({ sampleId, run: Number(row.run), raw: row.aiProbability ?? '', notes });
      continue;
    }
    for (const run of [1, 2]) {
      const raw = row[`run${run}`] ?? '';
      if (raw !== '') out.push({ sampleId, run, raw, notes });
    }
  }
  return out;
}

/** A displayed value becomes a 0-100 AI probability, or null for a refusal. */
function normaliseReading(detector: Detector, raw: string): number | null {
  const value = raw.toLowerCase();
  if (value === 'refused' || value === 'n/a' || value === 'error') return null;

  const numeric = Number(raw.replace('%', ''));
  if (!Number.isFinite(numeric)) throw new Error(`'${raw}' is neither a number nor 'refused'`);

  const scale = detector.api?.scoreScale ?? 'ai-0-100';
  const max = scale.endsWith('0-1') ? 1 : 100;
  if (numeric < 0 || numeric > max) {
    throw new Error(`${numeric} is outside the 0-${max} range this detector reports on`);
  }
  return toAiProbability(numeric, scale);
}

function main(): void {
  const cycle = arg('cycle');
  const cycleDir = repoPath('data', 'cycles', cycle);
  const samples = readJson<Sample[]>(`${cycleDir}/samples.json`);
  const validIds = new Set(samples.map((s) => s.id));

  const registry = readJson<{ detectors: Detector[] }>(repoPath('detectors/registry.json'));

  let results: Reading[] = [];
  try {
    results = readJson<Reading[]>(`${cycleDir}/detector-results.json`);
  } catch {
    /* none yet */
  }

  heading(`Importing hand-collected readings for cycle ${cycle}`);
  let imported = 0;
  let found = 0;

  for (const detector of registry.detectors) {
    const path = `${cycleDir}/manual/${detector.slug}.csv`;
    if (!existsSync(path)) {
      // Only a problem for a detector that has no other way in.
      if (detector.access === 'manual') fail(`${detector.slug}: no sheet at ${path.replace(repoPath(), '.')}`);
      continue;
    }
    found++;

    const entries = toEntries(parseCsv(readFileSync(path, 'utf8')));
    const seen = new Set<string>();

    for (const entry of entries) {
      const where = `${detector.slug}/${entry.sampleId || '(blank)'}`;
      if (!validIds.has(entry.sampleId)) throw new Error(`${where}: unknown sample id`);
      if (entry.run !== 1 && entry.run !== 2) throw new Error(`${where}: run must be 1 or 2`);

      const key = `${entry.sampleId}|${entry.run}`;
      if (seen.has(key)) throw new Error(`${detector.slug}: duplicate row for ${key}`);
      seen.add(key);

      let aiProbability: number | null;
      try {
        aiProbability = normaliseReading(detector, entry.raw);
      } catch (err) {
        throw new Error(`${where} run ${entry.run}: ${(err as Error).message}`);
      }

      results = results.filter(
        (r) => !(r.detector === detector.slug && r.sampleId === entry.sampleId && r.run === entry.run),
      );
      results.push({
        detector: detector.slug,
        sampleId: entry.sampleId,
        run: entry.run,
        aiProbability,
        error: aiProbability === null ? 'refused-or-unscorable' : null,
        latencyMs: null,
        ...(entry.notes ? { notes: entry.notes } : {}),
      });
      imported++;
    }

    const expected = samples.length * 2;
    const line = `${detector.slug}: ${entries.length}/${expected} readings`;
    entries.length === expected ? ok(line) : info(line);

    if (entries.length < expected) {
      const have = new Set(entries.map((e) => `${e.sampleId}|${e.run}`));
      const gaps = samples.flatMap((s) => [1, 2].filter((r) => !have.has(`${s.id}|${r}`)).map((r) => `${s.id}#${r}`));
      info(`  still open: ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? ` (+${gaps.length - 6})` : ''}`);
    }
  }

  if (found === 0) {
    fail(`no sheets found in data/cycles/${cycle}/manual/`);
    info(`generate them first: npm run collection-sheet -- --cycle ${cycle}`);
    process.exitCode = 1;
    return;
  }

  writeJson(`${cycleDir}/detector-results.json`, results);
  ok(`${imported} reading(s) merged across ${found} detector(s)`);
}

try {
  main();
} catch (err) {
  fail((err as Error).message);
  process.exitCode = 1;
}
