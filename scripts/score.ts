/**
 * Re-derive a cycle's leaderboard from its samples, its readings and its own
 * frozen scoring.js, then write the cycle manifest that verification checks.
 *
 *   npm run score -- --cycle 2026-10
 *
 * The scoring logic imported here is the copy inside the cycle directory, not a
 * shared module. A cycle is scored by the rules that were frozen when it opened,
 * for as long as it exists.
 */

import { readdirSync } from 'node:fs';
import { heading, info, ok, readJson, repoPath, sha256File, writeJson } from './lib/io.js';
import type { Detector, Reading, Sample } from './lib/types.js';

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

/** Files whose bytes are pinned in cycle.json. cycle.json itself cannot be in it. */
const MANIFEST_EXCLUDE = new Set(['cycle.json']);

export async function buildLeaderboard(cycle: string) {
  const cycleDir = repoPath('data', 'cycles', cycle);
  const { scoreCycle, SCORING_VERSION } = await import(`${cycleDir}/scoring.js`);

  const samples = readJson<Sample[]>(`${cycleDir}/samples.json`);
  const results = readJson<Reading[]>(`${cycleDir}/detector-results.json`);
  const registry = readJson<{ detectors: Detector[] }>(repoPath('detectors/registry.json'));

  // Only detectors that were actually run appear on the leaderboard. Scoring a
  // detector with no readings would put it on the table at zero, which reads as
  // "it failed" rather than "it was not tested" — a defamatory difference.
  const measured = new Set(results.map((r) => r.detector));
  const detectors = registry.detectors.filter((d) => measured.has(d.slug));
  const notMeasured = registry.detectors.filter((d) => !measured.has(d.slug)).map((d) => d.slug);

  const scored = scoreCycle({ samples, results, detectors });
  return { cycleDir, scored, SCORING_VERSION, samples, results, notMeasured };
}

function writeManifest(cycle: string, cycleDir: string, meta: Record<string, unknown>): void {
  const files = readdirSync(cycleDir)
    .filter((f) => !MANIFEST_EXCLUDE.has(f))
    .filter((f) => f.endsWith('.json') || f.endsWith('.js') || f.endsWith('.txt'))
    .sort();

  writeJson(`${cycleDir}/cycle.json`, {
    cycle,
    ...meta,
    files: Object.fromEntries(files.map((f) => [f, sha256File(`${cycleDir}/${f}`)])),
  });
}

function updateHistories(cycle: string, leaderboard: Array<Record<string, unknown>>, publishedAt: string): void {
  for (const row of leaderboard) {
    const slug = row.slug as string;
    const path = repoPath('data', 'detectors', `${slug}.json`);
    let history: { slug: string; name: string; cycles: Array<Record<string, unknown>> };
    try {
      history = readJson(path);
    } catch {
      history = { slug, name: row.name as string, cycles: [] };
    }
    history.name = row.name as string;
    history.cycles = history.cycles.filter((c) => c.cycle !== cycle);
    history.cycles.push({
      cycle,
      publishedAt,
      rank: row.rank,
      composite: row.composite,
      metrics: row.metrics,
      falsePositiveRate: (row.diagnostics as Record<string, unknown>).falsePositiveRate,
      hybridMeanAbsError: (row.diagnostics as Record<string, unknown>).hybridMeanAbsError,
    });
    history.cycles.sort((a, b) => String(a.cycle).localeCompare(String(b.cycle)));
    writeJson(path, history);
  }
}

async function main(): Promise<void> {
  const cycle = arg('cycle');
  const publishedAt = arg('published-at', new Date().toISOString().slice(0, 10));
  const { cycleDir, scored, SCORING_VERSION, samples, results, notMeasured } = await buildLeaderboard(cycle);

  const cycleMeta = readJson<Record<string, unknown>>(`${cycleDir}/commit.json`);

  writeJson(`${cycleDir}/leaderboard.json`, {
    cycle,
    publishedAt,
    status: cycleMeta.status ?? 'published',
    ...(cycleMeta.synthetic === true ? { synthetic: true, disclaimer: cycleMeta.disclaimer } : {}),
    scoringVersion: SCORING_VERSION,
    samples: samples.length,
    readings: results.length,
    weights: scored.weights,
    sampleCounts: scored.sampleCounts,
    detectorsNotMeasured: notMeasured,
    leaderboard: scored.leaderboard,
  });

  // A synthetic cycle scores and verifies like any other, but it must never
  // reach the per-detector histories: those are the published record of how a
  // product has performed over time, and one fabricated row in them would make
  // every trend line unciteable.
  if (cycleMeta.synthetic === true) {
    info('synthetic cycle — detector histories left untouched');
  } else {
    updateHistories(cycle, scored.leaderboard, publishedAt);
  }

  writeManifest(cycle, cycleDir, {
    publishedAt,
    status: cycleMeta.status ?? 'published',
    scoringVersion: SCORING_VERSION,
    samples: samples.length,
    readings: results.length,
  });

  heading(`Leaderboard — ${cycle}`);
  for (const row of scored.leaderboard) {
    const m = row.metrics;
    info(
      `${String(row.rank).padStart(2)}. ${row.name.padEnd(28)} ${String(row.composite).padStart(6)}   ` +
        `recall ${pct(m.aiRecall)}  human ${pct(m.humanSpecificity)}  fp-resist ${pct(m.fpResistance)}  hybrid ${pct(m.hybridAccuracy)}`,
    );
  }
  if (notMeasured.length > 0) {
    info(`not measured this cycle, omitted from the table: ${notMeasured.join(', ')}`);
  }
  ok(`data/cycles/${cycle}/leaderboard.json`);
}

const pct = (n: number) => `${(n * 100).toFixed(1).padStart(5)}%`;

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
