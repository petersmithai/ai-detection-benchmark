/**
 * Generate pre-filled collection sheets — one CSV per detector, every sample id
 * already in place, so collecting a cycle is typing numbers into a column.
 *
 *   npm run collection-sheet -- --cycle 2026-10
 *   npm run collection-sheet -- --cycle 2026-10 --detector zerogpt
 *
 * Works before the corpus is built: every sample id is derivable from the
 * manifests, the template list and the hybrid plan, so you can lay out the grid
 * on day one and fill it as texts arrive.
 *
 * Two decisions worth knowing about, because both affect what the numbers mean:
 *
 * 1. The sheet carries NO class or domain column. An operator who can see that
 *    hum-acad-02 is supposed to be human is an operator who might re-read a
 *    "surprising" result and not a boring one, and that asymmetry would quietly
 *    bias the corpus this benchmark exists to measure. Collect blind.
 *
 * 2. Record the number the tool DISPLAYS, never a converted one. Winston shows a
 *    human-likeness score where 100 means fully human; several vendors show
 *    0–1. The importer converts using the scale in detectors/registry.json.
 *    Mental arithmetic at 2am over a spreadsheet is exactly how a detector ends
 *    up accidentally inverted for a whole cycle.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { heading, info, ok, readJson, repoPath } from './lib/io.js';
import type { Detector, Sample } from './lib/types.js';

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

/**
 * Every sample id in the cycle. Prefers a built samples.json; falls back to
 * deriving the ids from the manifests so the sheets can exist before the corpus
 * does.
 */
function sampleIds(cycleDir: string): { ids: string[]; source: string } {
  if (existsSync(`${cycleDir}/samples.json`)) {
    return { ids: readJson<Sample[]>(`${cycleDir}/samples.json`).map((s) => s.id), source: 'samples.json' };
  }

  const human = readJson<{ entries: Array<{ id: string }> }>(repoPath('datasets/human/manifest.json')).entries;
  const fp = readJson<{ entries: Array<{ id: string }> }>(repoPath('datasets/false-positive/manifest.json')).entries;
  const hybrid = readJson<{ plan: Array<{ id: string }> }>(repoPath('datasets/hybrid/spec.json')).plan;
  const templates = readJson<{ templates: Array<{ domain: string }>; variantsPerTemplate: number }>(
    repoPath('datasets/ai/templates.json'),
  );

  const ai = templates.templates.flatMap((t) =>
    Array.from({ length: templates.variantsPerTemplate }, (_, i) => `ai-${t.domain}-${i + 1}`),
  );

  return {
    ids: [...ai, ...human.map((e) => e.id), ...hybrid.map((p) => p.id), ...fp.map((e) => e.id)],
    source: 'manifests (corpus not built yet)',
  };
}

/** What the operator will actually see on screen, per vendor. */
function scaleNote(detector: Detector): string {
  const scale = detector.api?.scoreScale;
  switch (scale) {
    case 'human-0-100':
      return `${detector.name} displays a HUMAN score (100 = fully human). Record it as shown — the importer inverts it.`;
    case 'human-0-1':
      return `${detector.name} displays a HUMAN score on a 0-1 scale. Record it as shown — the importer inverts it.`;
    case 'ai-0-1':
      return `${detector.name} reports on a 0-1 scale. Record it as shown (e.g. 0.87), not as a percentage.`;
    default:
      return `Record the AI percentage as displayed, 0-100.`;
  }
}

function sheet(detector: Detector, ids: string[]): string {
  return [
    `# ${detector.name} — ${detector.url}`,
    `# ${scaleNote(detector)}`,
    `# Threshold used in scoring: ${detector.threshold}. Vendor minimum: ${detector.minWords} words.`,
    '#',
    '# run1 and run2 must be collected in SEPARATE SITTINGS, ideally on different',
    '# days. Two readings taken back to back measure nothing; the gap is what makes',
    '# the consistency metric mean something. For a tool with no API, run1 and run2',
    '# should be two different operators working independently.',
    '#',
    '# Values: a number as displayed, or `refused` if the tool declines to score.',
    '# Leave blank for not-yet-collected. Blanks are skipped, not treated as zero.',
    '# Put anything odd in notes — it ends up in the cycle record.',
    '#',
    'sampleId,run1,run2,notes',
    ...ids.map((id) => `${id},,,`),
  ].join('\n');
}

function main(): void {
  const cycle = arg('cycle');
  const only = process.argv.includes('--detector') ? arg('detector') : null;
  const cycleDir = repoPath('data', 'cycles', cycle);

  const registry = readJson<{ detectors: Detector[] }>(repoPath('detectors/registry.json'));
  const detectors = registry.detectors.filter((d) => (only ? d.slug === only : true));
  if (detectors.length === 0) throw new Error(`no detector matches --detector ${only}`);

  const { ids, source } = sampleIds(cycleDir);
  const outDir = `${cycleDir}/manual`;
  mkdirSync(outDir, { recursive: true });

  heading(`Collection sheets — cycle ${cycle}`);
  info(`${ids.length} samples, ids from ${source}`);

  let written = 0;
  let skipped = 0;
  for (const detector of detectors) {
    const path = `${outDir}/${detector.slug}.csv`;
    if (existsSync(path) && !process.argv.includes('--force')) {
      skipped++;
      continue;
    }
    writeFileSync(path, `${sheet(detector, ids)}\n`, 'utf8');
    written++;
  }

  ok(`${written} sheet(s) written to data/cycles/${cycle}/manual/`);
  if (skipped > 0) info(`${skipped} left alone because they already exist (--force overwrites)`);
  info(`${ids.length * 2} numbers per detector, ${ids.length * 2 * detectors.length} in total`);
  info(`fill them in, then: npm run import-manual -- --cycle ${cycle}`);
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
