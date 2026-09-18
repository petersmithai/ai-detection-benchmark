/**
 * Apply a full grammar-and-style pass to a human text, for the
 * `grammar-corrected` false-positive profile.
 *
 *   npx tsx scripts/transforms/grammar-correct.ts --in <source.txt> --out <dest.txt>
 *
 * The profile asks a narrow question: does cleaning up your writing get you
 * accused? Plenty of people run a grammar checker before submitting, and the
 * checker's suggestions are, by construction, regular — the exact property
 * several detectors treat as evidence of a machine.
 *
 * So this must correct and must not rewrite. It applies LanguageTool's own rule
 * suggestions and nothing else: no paraphrase, no synonym substitution, no
 * sentence restructuring. A rewriting pass would produce text of ambiguous
 * provenance, and the sample would stop being human.
 *
 * Needs a LanguageTool server. Locally:
 *   docker run --rm -p 8010:8010 erikvl87/languagetool
 *   LANGUAGETOOL_URL=http://localhost:8010/v2/check npx tsx scripts/transforms/...
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { normalize } from '../lib/text.js';
import { fail, info, ok } from '../lib/io.js';

const LT_URL = process.env.LANGUAGETOOL_URL ?? 'http://localhost:8010/v2/check';

/**
 * Rule categories that change meaning or voice rather than correctness. A
 * detector should not be credited for catching text that a style engine
 * rewrote — that is a different experiment.
 */
const SKIP_CATEGORIES = new Set(['STYLE', 'REDUNDANCY', 'PLAIN_ENGLISH', 'CREATIVE_WRITING', 'WIKIPEDIA']);

interface Match {
  offset: number;
  length: number;
  replacements: Array<{ value: string }>;
  rule: { id: string; category: { id: string } };
}

const arg = (name: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (!v) throw new Error(`--${name} is required`);
  return v;
};

async function correct(text: string): Promise<{ text: string; applied: number; skipped: number }> {
  const res = await fetch(LT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, language: 'en-US', enabledOnly: 'false' }),
  });
  if (!res.ok) throw new Error(`LanguageTool returned ${res.status} — is the server running at ${LT_URL}?`);

  const { matches } = (await res.json()) as { matches: Match[] };

  let applied = 0;
  let skipped = 0;
  let out = text;

  // Apply back to front so earlier offsets stay valid as the string shifts.
  for (const m of [...matches].sort((a, b) => b.offset - a.offset)) {
    const replacement = m.replacements[0]?.value;
    if (replacement === undefined || SKIP_CATEGORIES.has(m.rule.category.id)) {
      skipped++;
      continue;
    }
    out = out.slice(0, m.offset) + replacement + out.slice(m.offset + m.length);
    applied++;
  }

  return { text: normalize(out), applied, skipped };
}

async function main(): Promise<void> {
  const source = normalize(readFileSync(arg('in'), 'utf8'));
  const { text, applied, skipped } = await correct(source);
  writeFileSync(arg('out'), `${text}\n`, 'utf8');
  ok(`${applied} correction(s) applied, ${skipped} style/meaning suggestion(s) skipped`);
  info(`record the LanguageTool version in the cycle notes — corrections change between releases`);
}

main().catch((err) => {
  fail((err as Error).message);
  process.exitCode = 1;
});
