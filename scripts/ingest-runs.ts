/**
 * Ingest per-detector run logs in the operator's long format.
 *
 *   npm run ingest -- --cycle 2026-08 --dir path/to/run-logs
 *
 * One CSV per detector, one row per (text, pass). Unlike the wide collection
 * sheet, these logs carry the ground truth alongside every reading, so this
 * script builds samples.json and detector-results.json together and checks that
 * every file tells the same story about every text.
 *
 * Two rules it enforces, because both are silent-corruption risks:
 *
 * 1. **Scale comes from the log, not the registry.** Each row declares its own
 *    `score_field` (human_score, ai_percent, class_probability_ai, …) and the
 *    scale is derived from that plus the observed range. Copyleaks and
 *    Originality report 0-100 here where the registry's API config expects
 *    0-1; trusting the registry would have multiplied those by 100 and clamped
 *    every reading to a confident 100% AI.
 *
 * 2. **Ground truth must agree across every file.** The same text scanned by
 *    five detectors must have one genre, one stress type, one AI fraction. A
 *    conflict means one log is from a different corpus revision, and scoring
 *    across them would compare detectors on different documents.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fail, heading, info, ok, repoPath, writeJson } from './lib/io.js';
import type { Reading, Sample, SampleClass } from './lib/types.js';

const GENRE_TO_DOMAIN: Record<string, string> = {
  'Academic essay': 'academic',
  'Business / professional': 'business',
  'Blog / opinion': 'blog',
  'Marketing copy': 'marketing',
  'Technical how-to': 'technical',
  'News article': 'news',
  'Creative fiction': 'fiction',
};

const STRESS_TO_PROFILE: Record<string, string> = {
  ESL: 'esl-nonnative',
  Translated: 'translated',
  Templated: 'template-structured',
  Technical: 'technical-formulaic',
  'Grammar-heavy': 'grammar-corrected',
  Short: 'short-form',
  Archaic: 'archival-formal',
};

/** Vendor field name -> which axis it is on. Range decides 0-1 vs 0-100. */
const FIELD_AXIS: Record<string, 'ai' | 'human'> = {
  human_score: 'human',
  human_confidence: 'human',
  ai_percent: 'ai',
  ai_confidence: 'ai',
  class_probability_ai: 'ai',
  fraction_ai: 'ai',
  average_generated_prob: 'ai',
  ai_gpt_percent: 'ai',
};

const DETECTOR_SLUG: Record<string, string> = {
  'Winston AI': 'winston-ai',
  'Originality.ai': 'originality-ai',
  GPTZero: 'gptzero',
  Copyleaks: 'copyleaks',
  Pangram: 'pangram',
  Sapling: 'sapling',
  ZeroGPT: 'zerogpt',
};

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

/** RFC4180-ish: handles the quoted JSON blobs in the raw_response column. */
function parseCsv(raw: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const header = (rows.shift() as string[]).map((h) => h.trim());
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function classOf(row: Record<string, string>): SampleClass {
  if (row.ground_truth === 'AI') return 'ai';
  if (row.ground_truth === 'Hybrid') return 'hybrid';
  return row.stress_type ? 'fp' : 'human';
}

function main(): void {
  const cycle = arg('cycle');
  const dir = arg('dir');
  const cycleDir = repoPath('data', 'cycles', cycle);

  const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  if (files.length === 0) throw new Error(`no CSVs in ${dir}`);

  heading(`Ingesting ${files.length} run log(s) for cycle ${cycle}`);

  const samples = new Map<string, Sample>();
  const truth = new Map<string, string>();
  const readings: Reading[] = [];
  const conflicts: string[] = [];
  const detectorsSeen = new Set<string>();

  for (const file of files) {
    const rows = parseCsv(readFileSync(`${dir}/${file}`, 'utf8'));
    if (rows.length === 0) continue;

    const detectorName = rows[0]!.detector as string;
    const slug = DETECTOR_SLUG[detectorName];
    if (!slug) throw new Error(`${file}: unknown detector name '${detectorName}'`);
    detectorsSeen.add(slug);

    // Decide the scale once per file, from the declared field and the range.
    const field = rows[0]!.score_field as string;
    const axis = FIELD_AXIS[field];
    if (!axis) throw new Error(`${file}: unrecognised score_field '${field}'`);
    const values = rows.filter((r) => r.run_status === 'ok' && r.score !== '').map((r) => Number(r.score));
    const unit = Math.max(...values) <= 1 ? 1 : 100;

    let errors = 0;
    for (const row of rows) {
      const id = row.text_id as string;
      const cls = classOf(row);

      const signature = [row.ground_truth, row.genre, row.stress_type, row.ai_word_pct, row.word_count].join('|');
      if (truth.has(id) && truth.get(id) !== signature) {
        conflicts.push(`${id}: ${file} says ${signature}, earlier log said ${truth.get(id)}`);
      }
      truth.set(id, signature);

      if (!samples.has(id)) {
        const domain = GENRE_TO_DOMAIN[row.genre as string];
        if (!domain) throw new Error(`${file}/${id}: unmapped genre '${row.genre}'`);
        const profile = cls === 'fp' ? STRESS_TO_PROFILE[row.stress_type as string] : undefined;
        if (cls === 'fp' && !profile) throw new Error(`${file}/${id}: unmapped stress type '${row.stress_type}'`);

        samples.set(id, {
          id,
          class: cls,
          domain,
          ...(profile ? { profile } : {}),
          aiFraction: Number(row.ai_word_pct) / 100,
          words: Number(row.word_count),
          // The operator supplied run logs, not the texts. Without the source
          // documents there is nothing to hash, and a placeholder is more
          // honest than a hash of something we never saw.
          sha256: 'not-supplied',
          origin: { source: row.source, created: row.created, textId: id },
        });
      }

      const okRow = row.run_status === 'ok' && row.score !== '';
      if (!okRow) errors++;
      const raw = okRow ? Number(row.score) : null;
      const aiProbability =
        raw === null ? null : Math.round((axis === 'human' ? unit - raw : raw) * (100 / unit) * 100) / 100;

      readings.push({
        detector: slug,
        sampleId: id,
        run: Number(row.pass_number),
        aiProbability,
        error: okRow ? null : row.error_code || 'unscorable',
        latencyMs: null,
        collectedAt: row.scanned_at || undefined,
      });
    }

    const label = `${detectorName.padEnd(15)} ${rows.length} readings, ${field} on 0-${unit} (${axis} axis), ${errors} error(s)`;
    errors === 0 ? ok(label) : info(label);
  }

  if (conflicts.length > 0) {
    fail(`${conflicts.length} ground-truth conflict(s) between logs — refusing to build a mixed corpus:`);
    for (const c of conflicts.slice(0, 10)) info(c);
    process.exitCode = 1;
    return;
  }

  const list = [...samples.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeJson(`${cycleDir}/samples.json`, list);
  writeJson(`${cycleDir}/detector-results.json`, readings);

  const counts = list.reduce<Record<string, number>>((a, s) => ({ ...a, [s.class]: (a[s.class] ?? 0) + 1 }), {});
  ok(`${list.length} samples (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  ok(`${readings.length} readings across ${detectorsSeen.size} detector(s): ${[...detectorsSeen].sort().join(', ')}`);
  info(`next: npm run score -- --cycle ${cycle}`);
}

try {
  main();
} catch (err) {
  fail((err as Error).message);
  process.exitCode = 1;
}
