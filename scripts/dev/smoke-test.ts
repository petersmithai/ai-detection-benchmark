/**
 * Offline smoke test for the whole pipeline.
 *
 *   npm run smoke-test
 *
 * Exercises every stage end to end without touching the network or spending a
 * credit: a nonce resolves to prompts, prompts and manifests resolve to samples,
 * samples and readings resolve to a leaderboard, and verification then catches
 * a tampered byte. Run it before opening a real cycle, and after any change to
 * the scoring or selection logic.
 *
 * To run offline it has to fabricate both halves of the input: corpus texts are
 * assembled from word banks, and readings are drawn from the per-detector noise
 * model in PROFILES below. NOTHING IT PRODUCES IS A MEASUREMENT OF ANY PRODUCT —
 * no detector is called and no vendor is measured, and the noise model is
 * invented for the purpose of exercising the arithmetic.
 *
 * So its output is deliberately unpublishable. It writes to data/cycles/.smoke/,
 * which is git-ignored, and stamps every artefact synthetic: true. It has no
 * bearing on any published cycle, whose numbers come from purchased API access
 * and manual collection. If you want a leaderboard, run a real cycle:
 * docs/RUNNING.md.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { heading, info, ok, readJson, repoPath, sha256, writeJson } from '../lib/io.js';

/** Leading dot: git-ignored, and skipped by verify's cycle listing. */
const CYCLE = '.smoke';
const DIR = repoPath('data', 'cycles', CYCLE);

/** Fixed so the run regenerates byte-identically. A real cycle draws 32 random bytes. */
const NONCE = 'smoke-test-nonce-not-random-00000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedFrom = (label: string): number => createHash('sha256').update(label).digest().readUInt32BE(0);

/** Box-Muller, so the noise model is a normal rather than a uniform smear. */
function gaussian(rand: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

// ---------------------------------------------------------------------------
// Fixture prose
// ---------------------------------------------------------------------------

const OPENERS = [
  'The question that follows from this',
  'What the record shows',
  'By any reasonable reading',
  'The point worth holding onto',
  'On the evidence available',
  'It is easy to miss that',
  'The difficulty here',
  'Anyone who has tried this',
] as const;

const SUBJECTS = [
  'the reporting requirement',
  'a small team',
  'the second draft',
  'the funding decision',
  'most of the participants',
  'the revised timetable',
  'the local authority',
  'the underlying assumption',
  'the measurement itself',
  'a follow-up review',
] as const;

const VERBS = [
  'turns on',
  'depends heavily on',
  'was never designed for',
  'quietly changed',
  'has little bearing on',
  'complicates',
  'sits awkwardly beside',
  'accounts for most of',
] as const;

const OBJECTS = [
  'the cost of the change',
  'a schedule nobody agreed to',
  'the difference between the two figures',
  'what the guidance actually says',
  'the outcome six months later',
  'the way the question was asked',
  'a threshold set years earlier',
  'the smaller of the two effects',
] as const;

const CLOSERS = [
  'which is not the same thing at all',
  'and the distinction matters',
  'though the effect is modest',
  'even where the intent was good',
  'for reasons that were never written down',
  'once the exceptions are set aside',
] as const;

function fixtureText(id: string, targetWords: number): string {
  const rand = mulberry32(seedFrom(`text|${id}`));
  const out: string[] = [];
  let words = 0;
  while (words < targetWords) {
    const shape = rand();
    const sentence =
      shape < 0.35
        ? `${pick(rand, OPENERS)} is that ${pick(rand, SUBJECTS)} ${pick(rand, VERBS)} ${pick(rand, OBJECTS)}.`
        : shape < 0.7
          ? `${cap(pick(rand, SUBJECTS))} ${pick(rand, VERBS)} ${pick(rand, OBJECTS)}, ${pick(rand, CLOSERS)}.`
          : `${cap(pick(rand, SUBJECTS))} ${pick(rand, VERBS)} ${pick(rand, OBJECTS)}.`;
    out.push(sentence);
    words += sentence.split(/\s+/).length;
    if (out.length % 5 === 0 && words < targetWords - 40) out.push('\n\n');
  }
  return out.join(' ').replace(/ \n\n /g, '\n\n').trim();
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Detector noise model — fabricated, see the header
// ---------------------------------------------------------------------------

interface Profile {
  /** Mean reported AI probability on generated text. */
  ai: number;
  /** Mean reported AI probability on ordinary human text. */
  human: number;
  /** Mean on the false-positive stress set before per-profile pressure. */
  fpBase: number;
  /** Reported hybrid share modelled as slope * trueFraction + intercept. */
  slope: number;
  intercept: number;
  /** Spread within a class, and drift between the two passes. */
  sd: number;
  drift: number;
  errorRate: number;
  /**
   * Real detector score distributions are bimodal, not Gaussian: most samples
   * land firmly on one side and a minority land firmly on the wrong one. A
   * unimodal model would put every tool at 100% on the binary metrics and make
   * the leaderboard look far more decisive than any detector really is, so the
   * tail is modelled explicitly.
   */
  aiMissRate: number;
  fpSpikeRate: number;
}

const PROFILES: Record<string, Profile> = {
  'winston-ai':      { ai: 93, human: 6,  fpBase: 10, slope: 0.93, intercept: 2,  sd: 6,  drift: 1.5, errorRate: 0,    aiMissRate: 0.03, fpSpikeRate: 0.02 },
  'originality-ai':  { ai: 96, human: 13, fpBase: 21, slope: 1.04, intercept: 6,  sd: 7,  drift: 2.0, errorRate: 0,    aiMissRate: 0.01, fpSpikeRate: 0.06 },
  gptzero:           { ai: 90, human: 9,  fpBase: 16, slope: 0.87, intercept: 4,  sd: 8,  drift: 3.0, errorRate: 0,    aiMissRate: 0.04, fpSpikeRate: 0.04 },
  copyleaks:         { ai: 91, human: 12, fpBase: 20, slope: 0.8,  intercept: 6,  sd: 9,  drift: 3.5, errorRate: 0.01, aiMissRate: 0.05, fpSpikeRate: 0.05 },
  sapling:           { ai: 85, human: 19, fpBase: 29, slope: 0.7,  intercept: 10, sd: 11, drift: 4.0, errorRate: 0,    aiMissRate: 0.09, fpSpikeRate: 0.10 },
  'undetectable-ai': { ai: 88, human: 21, fpBase: 31, slope: 0.74, intercept: 9,  sd: 12, drift: 5.0, errorRate: 0.01, aiMissRate: 0.07, fpSpikeRate: 0.11 },
  zerogpt:           { ai: 76, human: 27, fpBase: 39, slope: 0.58, intercept: 13, sd: 16, drift: 8.0, errorRate: 0.02, aiMissRate: 0.16, fpSpikeRate: 0.18 },
  smodin:            { ai: 74, human: 25, fpBase: 35, slope: 0.6,  intercept: 11, sd: 15, drift: 7.0, errorRate: 0.01, aiMissRate: 0.17, fpSpikeRate: 0.15 },
  isgen:             { ai: 84, human: 15, fpBase: 24, slope: 0.78, intercept: 7,  sd: 10, drift: 4.0, errorRate: 0,    aiMissRate: 0.07, fpSpikeRate: 0.07 },
  quillbot:          { ai: 80, human: 18, fpBase: 27, slope: 0.64, intercept: 9,  sd: 12, drift: 6.0, errorRate: 0.02, aiMissRate: 0.11, fpSpikeRate: 0.11 },
  scribbr:           { ai: 82, human: 17, fpBase: 26, slope: 0.71, intercept: 8,  sd: 11, drift: 5.5, errorRate: 0.02, aiMissRate: 0.09, fpSpikeRate: 0.09 },
  brandwell:         { ai: 70, human: 31, fpBase: 43, slope: 0.5,  intercept: 16, sd: 18, drift: 9.0, errorRate: 0.03, aiMissRate: 0.22, fpSpikeRate: 0.23 },
};

/** How much harder each stress profile is than baseline human text, in points. */
const PROFILE_PRESSURE: Record<string, number> = {
  'esl-nonnative': 12,
  'archival-formal': 14,
  translated: 9,
  'short-form': 8,
  'template-structured': 7,
  'technical-formulaic': 6,
  'grammar-corrected': 5,
};

// ---------------------------------------------------------------------------

interface Sample {
  id: string;
  class: 'ai' | 'human' | 'hybrid' | 'fp';
  profile?: string;
  aiFraction: number;
}

function synthesiseReadings(samples: Sample[], detectors: Array<{ slug: string }>) {
  const readings = [];
  for (const detector of detectors) {
    const p = PROFILES[detector.slug];
    if (!p) throw new Error(`no smoke-test profile for ${detector.slug}`);

    for (const sample of samples) {
      const base = mulberry32(seedFrom(`base|${detector.slug}|${sample.id}`));
      const tail = base();

      let centre: number;
      let spread = p.sd;
      if (sample.class === 'ai') {
        const missed = tail < p.aiMissRate;
        centre = missed ? 24 : p.ai;
        if (missed) spread = 14;
      } else if (sample.class === 'human' || sample.class === 'fp') {
        // The stress profiles do not just shift the mean, they make the tail
        // fatter: that is what a false-positive-prone profile actually is.
        const pressure = sample.class === 'fp' ? (PROFILE_PRESSURE[sample.profile ?? ''] ?? 0) : 0;
        const spiked = tail < p.fpSpikeRate * (1 + pressure / 14);
        centre = spiked ? 76 : (sample.class === 'fp' ? p.fpBase + pressure : p.human);
        if (spiked) spread = 14;
      } else {
        centre = p.slope * sample.aiFraction * 100 + p.intercept;
      }

      const trueValue = gaussian(base, centre, spread);

      for (const run of [1, 2]) {
        const rand = mulberry32(seedFrom(`run|${detector.slug}|${sample.id}|${run}`));
        if (rand() < p.errorRate) {
          readings.push({
            detector: detector.slug,
            sampleId: sample.id,
            run,
            aiProbability: null,
            error: 'synthetic-failure',
            latencyMs: null,
            synthetic: true,
          });
          continue;
        }
        readings.push({
          detector: detector.slug,
          sampleId: sample.id,
          run,
          aiProbability: Math.round(clampPct(gaussian(rand, trueValue, p.drift / 2)) * 100) / 100,
          error: null,
          latencyMs: Math.round(300 + rand() * 1400),
          synthetic: true,
        });
      }
    }
  }
  return readings;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  heading('Pipeline smoke test (synthetic input, offline)');
  mkdirSync(DIR, { recursive: true });

  // Freeze the current methodology into the scratch cycle, exactly as
  // commit-cycle does for a real one.
  for (const file of ['scoring.js', 'select-placeholders.js']) {
    copyFileSync(repoPath('methodology', 'v1', file), `${DIR}/${file}`);
  }

  writeJson(`${DIR}/generators.json`, {
    note: 'Smoke-test placeholders. A real cycle pins provider model ids here and cycle.json records them.',
    synthetic: true,
    generators: [
      { slug: 'gen-a', provider: 'fixture', model: 'smoke-fixture-a', keyEnv: 'NONE', maxTokens: 700 },
      { slug: 'gen-b', provider: 'fixture', model: 'smoke-fixture-b', keyEnv: 'NONE', maxTokens: 700 },
      { slug: 'gen-c', provider: 'fixture', model: 'smoke-fixture-c', keyEnv: 'NONE', maxTokens: 700 },
      { slug: 'gen-d', provider: 'fixture', model: 'smoke-fixture-d', keyEnv: 'NONE', maxTokens: 700 },
    ],
  });

  writeJson(`${DIR}/commit.json`, {
    cycle: CYCLE,
    status: 'smoke-test',
    synthetic: true,
    disclaimer:
      'Fabricated input, produced by scripts/dev/smoke-test.ts to exercise the pipeline offline. No detector was called and no vendor was measured. Not publishable and not comparable to any real cycle.',
    committedAt: '2026-01-01T00:00:00.000Z',
    revealedAt: '2026-01-01T00:00:00.000Z',
    nonceSha256: sha256(NONCE),
    templatesSha256: '',
    banksSha256: '',
  });
  writeFileSync(`${DIR}/nonce.txt`, `${NONCE}\n`, 'utf8');

  // Prompts, from the cycle's own frozen selection logic.
  const { selectPrompts } = await import(`${DIR}/select-placeholders.js`);
  const templates = readJson<{ templates: unknown[]; variantsPerTemplate: number }>(repoPath('datasets/ai/templates.json'));
  const banks = readJson<{ banks: Record<string, string[]> }>(repoPath('datasets/ai/banks.json'));
  const generators = readJson<{ generators: Array<{ slug: string }> }>(`${DIR}/generators.json`).generators.map((g) => g.slug);
  const prompts = selectPrompts({
    cycleId: CYCLE,
    nonce: NONCE,
    templates: templates.templates,
    banks: banks.banks,
    variantsPerTemplate: templates.variantsPerTemplate,
    generators,
  });
  writeJson(`${DIR}/prompts.json`, prompts);
  ok(`${prompts.length} prompts resolved from the nonce`);

  // Fixture corpus texts, one per manifest entry that is not a derived transform.
  const humanEntries = readJson<{ entries: Array<{ id: string }> }>(repoPath('datasets/human/manifest.json')).entries;
  const fpEntries = readJson<{ entries: Array<{ id: string; source: string }> }>(
    repoPath('datasets/false-positive/manifest.json'),
  ).entries;

  const write = (corpus: string, id: string, words: number) => {
    mkdirSync(repoPath('datasets', corpus, 'texts'), { recursive: true });
    writeFileSync(repoPath('datasets', corpus, 'texts', `${id}.txt`), `${fixtureText(id, words)}\n`, 'utf8');
  };

  for (const e of humanEntries) write('human', e.id, 240);
  for (const p of prompts as Array<{ id: string }>) write('ai', p.id, 250);
  for (const e of fpEntries) {
    // Derived entries are built by build-corpus from their source, except the
    // LanguageTool ones, which have no offline path — stand them in here.
    if (e.source === 'derived') write('false-positive', e.id, 200);
    else write('false-positive', e.id, 230);
  }
  ok(`${humanEntries.length + prompts.length + fpEntries.length} fixture texts written`);

  // Real pipeline from here: build the corpus, then score it.
  const tsx = (script: string, args: string[]) =>
    execFileSync('npx', ['tsx', repoPath('scripts', script), ...args], { stdio: 'inherit', cwd: repoPath() });

  tsx('build-corpus.ts', ['--cycle', CYCLE]);

  const samples = readJson<Sample[]>(`${DIR}/samples.json`);
  const registry = readJson<{ detectors: Array<{ slug: string }> }>(repoPath('detectors/registry.json'));
  writeJson(`${DIR}/detector-results.json`, synthesiseReadings(samples, registry.detectors));
  ok(`${samples.length * registry.detectors.length * 2} synthetic readings written`);

  tsx('score.ts', ['--cycle', CYCLE, '--published-at', '2026-01-01']);

  // The last stage of the pipeline is the audit, so the smoke test is not done
  // until the audit passes on what it just built.
  tsx('verify-cycle.ts', [CYCLE]);

  heading('Smoke test complete');
  info('every number above is synthetic — fabricated input, no detector called');
  info('to produce real results, run a real cycle: docs/RUNNING.md');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
