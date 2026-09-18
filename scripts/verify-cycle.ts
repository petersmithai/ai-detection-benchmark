/**
 * Audit a published cycle end to end.
 *
 *   npm run verify                       # every cycle
 *   npm run verify -- 2026-10            # one cycle
 *
 * Five independent checks, each of which fails loudly on its own:
 *
 *   1. Commitment    SHA-256(nonce) equals the hash published before the cycle
 *                    opened, so the prompt set could not have been chosen after
 *                    seeing which detectors were being tested.
 *   2. Replay        Re-running the cycle's own select-placeholders.js against
 *                    that nonce reproduces prompts.json exactly.
 *   3. Ground truth  Every hybrid's committed AI fraction is within tolerance of
 *                    its planned ratio, and no sample class is empty.
 *   4. Manifest      Every file listed in cycle.json still hashes to what it
 *                    hashed at publication.
 *   5. Score replay  Re-running the cycle's own scoring.js over its samples and
 *                    readings reproduces leaderboard.json exactly.
 *
 * Nothing here trusts a number written by hand. If a row on the leaderboard were
 * edited by a person, check 5 would fail; if the underlying reading were edited
 * instead, check 4 would.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fail, heading, info, ok, readJson, repoPath, sha256, sha256File } from './lib/io.js';
import type { Detector, Reading, Sample } from './lib/types.js';

async function verifyPromptReplay(cycle: string, dir: string): Promise<void> {
  const nonce = readFileSync(`${dir}/nonce.txt`, 'utf8').trim();
  const { selectPrompts } = await import(`${dir}/select-placeholders.js`);
  const templates = readJson<{ templates: unknown[]; variantsPerTemplate: number }>(repoPath('datasets/ai/templates.json'));
  const banks = readJson<{ banks: Record<string, string[]> }>(repoPath('datasets/ai/banks.json'));
  const generators = readJson<{ generators: Array<{ slug: string }> }>(`${dir}/generators.json`).generators.map((g) => g.slug);
  const committedPrompts = readJson<unknown[]>(`${dir}/prompts.json`);

  const replayed = selectPrompts({
    cycleId: cycle,
    nonce,
    templates: templates.templates,
    banks: banks.banks,
    variantsPerTemplate: templates.variantsPerTemplate,
    generators,
  });
  check(stable(replayed) === stable(committedPrompts), `prompt replay: ${replayed.length} prompts re-derived from the nonce`);
}

let failures = 0;
const check = (passed: boolean, message: string) => {
  passed ? ok(message) : fail(message);
  if (!passed) failures++;
};

const stable = (v: unknown) => JSON.stringify(v);

async function verifyCycle(cycle: string): Promise<void> {
  const dir = repoPath('data', 'cycles', cycle);
  heading(`Cycle ${cycle}`);

  const commit = readJson<{
    nonceSha256?: string;
    status: string;
    corpusProvenance?: string;
    banksSha256?: string;
    templatesSha256?: string;
  }>(`${dir}/commit.json`);

  // A cycle collected against a corpus the operator assembled themselves has no
  // nonce and no generated prompts, so checks 1 and 2 have nothing to test.
  // Skipping them is stated out loud rather than passed silently: this cycle
  // carries less proof than one built through the commit-reveal scheme, and a
  // reader is entitled to know which kind they are looking at.
  const operatorCorpus = commit.corpusProvenance === 'operator-supplied';
  if (operatorCorpus) {
    info('operator-supplied corpus — no commit-reveal, so commitment and prompt-replay checks do not apply');
  }

  // 1. Commitment
  const noncePath = `${dir}/nonce.txt`;
  if (!operatorCorpus && !existsSync(noncePath)) {
    info('nonce not yet revealed — cycle is still open, skipping replay checks');
    return;
  }
  if (!operatorCorpus) {
    const nonce = readFileSync(noncePath, 'utf8').trim();
    check(sha256(nonce) === commit.nonceSha256, `commitment: SHA-256(nonce) matches commit.json`);
  }

  if (commit.banksSha256) {
    check(sha256File(repoPath('datasets/ai/banks.json')) === commit.banksSha256, 'commitment: banks.json unchanged since cycle open');
  }
  if (commit.templatesSha256) {
    check(
      sha256File(repoPath('datasets/ai/templates.json')) === commit.templatesSha256,
      'commitment: templates.json unchanged since cycle open',
    );
  }

  // 2. Prompt replay
  if (!operatorCorpus) await verifyPromptReplay(cycle, dir);

  // 3. Ground truth
  const samples = readJson<Sample[]>(`${dir}/samples.json`);
  const hybrids = samples.filter((s) => s.class === 'hybrid');

  if (operatorCorpus) {
    // No splice plan to check against, so the weaker available assertion: every
    // hybrid sits on one of the declared ratios, and every ratio is populated.
    const ratios = [...new Set(hybrids.map((s) => s.aiFraction))].sort((a, b) => a - b);
    const declared = [0.25, 0.5, 0.75];
    check(
      ratios.length === declared.length && ratios.every((r, i) => Math.abs(r - declared[i]!) < 1e-9),
      `ground truth: hybrid AI fractions are exactly ${declared.join(' / ')} (found ${ratios.join(' / ')})`,
    );
    check(
      samples.every((s) => (s.class === 'ai') === (s.aiFraction === 1) && (s.aiFraction === 0) === (s.class === 'human' || s.class === 'fp')),
      'ground truth: AI fraction agrees with declared class on every sample',
    );
  } else {
    const hybridSpec = readJson<{ plan: Array<Record<string, string | number>>; ratioTolerance: number }>(
      repoPath('datasets/hybrid/spec.json'),
    );
    const planById = new Map(hybridSpec.plan.map((p) => [p.id as string, p]));
    const offTarget = hybrids.filter((s) => {
      const target = planById.get(s.id)?.aiFractionTarget as number | undefined;
      return target === undefined || Math.abs(s.aiFraction - target) > hybridSpec.ratioTolerance;
    });
    check(offTarget.length === 0, `ground truth: all hybrid AI fractions within ±${hybridSpec.ratioTolerance} of plan`);
  }

  const counts = samples.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }), {});
  check(
    ['ai', 'human', 'hybrid', 'fp'].every((c) => (counts[c] ?? 0) > 0),
    `ground truth: all four classes present (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`,
  );

  const dupes = samples.length - new Set(samples.map((s) => s.id)).size;
  check(dupes === 0, 'ground truth: no duplicate sample ids');

  // 4. Manifest
  const manifest = readJson<{ files: Record<string, string> }>(`${dir}/cycle.json`);
  const onDisk = readdirSync(dir).filter((f) => f !== 'cycle.json' && /\.(json|js|txt)$/.test(f));
  const drifted = Object.entries(manifest.files).filter(([file, hash]) => {
    try {
      return sha256File(`${dir}/${file}`) !== hash;
    } catch {
      return true;
    }
  });
  check(drifted.length === 0, `manifest: ${Object.keys(manifest.files).length} files hash as published`);
  if (drifted.length > 0) for (const [file] of drifted) info(`drifted or missing: ${file}`);

  const untracked = onDisk.filter((f) => !(f in manifest.files));
  check(untracked.length === 0, 'manifest: no untracked files in the cycle directory');
  if (untracked.length > 0) info(`untracked: ${untracked.join(', ')}`);

  // 5. Score replay
  const { scoreCycle } = await import(`${dir}/scoring.js`);
  const results = readJson<Reading[]>(`${dir}/detector-results.json`);
  const registry = readJson<{ detectors: Detector[] }>(repoPath('detectors/registry.json'));
  const published = readJson<{ leaderboard: unknown[] }>(`${dir}/leaderboard.json`);
  const measured = new Set(results.map((r) => r.detector));
  const scoredDetectors = registry.detectors.filter((d) => measured.has(d.slug));
  const replayedScores = scoreCycle({ samples, results, detectors: scoredDetectors });
  check(stable(replayedScores.leaderboard) === stable(published.leaderboard), 'score replay: leaderboard re-derives byte for byte');

  // Coverage: readings should cover every measured detector × sample × run.
  const expected = samples.length * scoredDetectors.length * 2;
  const errorRate = results.filter((r) => r.error).length / Math.max(1, results.length);
  info(`coverage: ${results.length}/${expected} readings, ${(errorRate * 100).toFixed(1)}% unanswered`);
  if (commit.status !== 'published') info(`status: ${commit.status}`);
}

async function main(): Promise<void> {
  const target = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const cyclesDir = repoPath('data', 'cycles');
  const cycles = target
    ? [target]
    : (existsSync(cyclesDir) ? readdirSync(cyclesDir, { withFileTypes: true }) : [])
        // Dot-prefixed directories are scratch space (the smoke test), never
        // published cycles, so a bare `npm run verify` ignores them.
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();

  for (const cycle of cycles) await verifyCycle(cycle);

  console.log('');
  if (cycles.length === 0) {
    info('no published cycles yet — nothing to verify');
  } else if (failures === 0) {
    ok(`all checks passed across ${cycles.length} cycle(s)`);
  } else {
    fail(`${failures} check(s) failed`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
