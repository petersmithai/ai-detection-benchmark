/**
 * Open and later reveal a cycle.
 *
 *   npm run commit-cycle -- --cycle 2026-10            # open: publish the commitment
 *   npm run commit-cycle -- --cycle 2026-10 --reveal   # reveal: publish the nonce and prompts
 *
 * Opening a cycle draws a random nonce, writes it to .cycle-secrets/ (git
 * ignored) and commits only its SHA-256 alongside hashes of the template and
 * bank files. From that moment the prompt set is fixed but unknown: it is a
 * pure function of a secret that already exists and files whose hashes are
 * public. Revealing publishes the nonce so anyone can re-derive the prompts.
 *
 * The property this buys is narrow and worth stating plainly: it stops the
 * maintainer choosing prompts after seeing how a vendor performs. It does not
 * stop a vendor recognising the corpus after publication, which is why banks
 * are re-drawn every cycle and why per-cycle trend lines in data/detectors/
 * matter more than any single cycle's ranking.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fail, heading, info, ok, readJson, repoPath, sha256, sha256File, writeJson } from './lib/io.js';

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

const FROZEN_SOURCES = ['scoring.js', 'select-placeholders.js'];

/**
 * The methodology version a new cycle freezes by default: the highest vN under
 * methodology/. Pass --methodology to pin an older one deliberately.
 */
function latestMethodology(): string {
  const versions = readdirSync(repoPath('methodology'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error('no methodology/vN directory found');
  return latest;
}

function open(cycle: string): void {
  const dir = repoPath('data', 'cycles', cycle);
  if (existsSync(`${dir}/commit.json`)) throw new Error(`cycle ${cycle} is already open`);
  mkdirSync(dir, { recursive: true });

  const secretsDir = repoPath('.cycle-secrets');
  mkdirSync(secretsDir, { recursive: true });
  const nonce = randomBytes(32).toString('hex');
  writeFileSync(`${secretsDir}/${cycle}.nonce`, `${nonce}\n`, 'utf8');

  const methodology = arg('methodology', latestMethodology());
  for (const file of FROZEN_SOURCES) {
    copyFileSync(repoPath('methodology', methodology, file), `${dir}/${file}`);
  }

  writeJson(`${dir}/commit.json`, {
    cycle,
    status: 'open',
    committedAt: new Date().toISOString(),
    nonceSha256: sha256(nonce),
    templatesSha256: sha256File(repoPath('datasets/ai/templates.json')),
    banksSha256: sha256File(repoPath('datasets/ai/banks.json')),
    humanManifestSha256: sha256File(repoPath('datasets/human/manifest.json')),
    fpManifestSha256: sha256File(repoPath('datasets/false-positive/manifest.json')),
    hybridSpecSha256: sha256File(repoPath('datasets/hybrid/spec.json')),
    registrySha256: sha256File(repoPath('detectors/registry.json')),
    methodologyVersion: methodology,
    frozenLogicSha256: Object.fromEntries(FROZEN_SOURCES.map((f) => [f, sha256File(`${dir}/${f}`)])),
  });

  heading(`Cycle ${cycle} opened`);
  ok(`commitment published: ${sha256(nonce).slice(0, 16)}…`);
  info(`nonce held at .cycle-secrets/${cycle}.nonce — do not commit it until reveal`);
  info(`frozen logic taken from methodology/${methodology}`);
}

async function reveal(cycle: string): Promise<void> {
  const dir = repoPath('data', 'cycles', cycle);
  const commit = readJson<{ nonceSha256: string }>(`${dir}/commit.json`);
  const nonce = readFileSync(repoPath('.cycle-secrets', `${cycle}.nonce`), 'utf8').trim();
  if (sha256(nonce) !== commit.nonceSha256) throw new Error('held nonce does not match the published commitment');

  writeFileSync(`${dir}/nonce.txt`, `${nonce}\n`, 'utf8');

  const { selectPrompts } = await import(`${dir}/select-placeholders.js`);
  const templates = readJson<{ templates: unknown[]; variantsPerTemplate: number }>(repoPath('datasets/ai/templates.json'));
  const banks = readJson<{ banks: Record<string, string[]> }>(repoPath('datasets/ai/banks.json'));
  const generators = readJson<{ generators: Array<{ slug: string }> }>(`${dir}/generators.json`).generators.map((g) => g.slug);

  const prompts = selectPrompts({
    cycleId: cycle,
    nonce,
    templates: templates.templates,
    banks: banks.banks,
    variantsPerTemplate: templates.variantsPerTemplate,
    generators,
  });
  writeJson(`${dir}/prompts.json`, prompts);
  writeJson(`${dir}/commit.json`, { ...commit, status: 'revealed', revealedAt: new Date().toISOString() });

  heading(`Cycle ${cycle} revealed`);
  ok(`${prompts.length} prompts written to prompts.json`);
  info('next: npm run generate-ai -- --cycle ' + cycle);
}

const cycle = arg('cycle');
const task = process.argv.includes('--reveal') ? reveal(cycle) : Promise.resolve(open(cycle));
task.catch((err) => {
  fail((err as Error).message);
  process.exitCode = 1;
});
