/**
 * Assemble a cycle's samples.json from the four corpus manifests.
 *
 *   npm run build-corpus -- --cycle 2026-10
 *
 * Source texts are never committed. This script expects them under
 * datasets/<corpus>/texts/<id>.txt, fetched by whoever runs the cycle from the
 * URLs in the manifests, and tells you exactly which ones are missing if they
 * are not there. What it emits is metadata plus a SHA-256 per sample, which is
 * enough for anyone to check that the text they fetched is the text we scored.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { info, heading, ok, fail, readJson, repoPath, sha256, writeJson } from './lib/io.js';
import { normalize, sentences, wordCount } from './lib/text.js';
import type { Sample } from './lib/types.js';

const HYBRID_TARGET_WORDS = 260;

interface HumanEntry {
  id: string;
  domain: string;
  profile?: string;
  source: string;
  derivedFrom?: string;
  transform?: string;
  [k: string]: unknown;
}

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

const textPath = (corpus: string, id: string) => repoPath('datasets', corpus, 'texts', `${id}.txt`);

function loadText(corpus: string, id: string): string | null {
  try {
    return normalize(readFileSync(textPath(corpus, id), 'utf8'));
  } catch {
    return null;
  }
}

function saveText(corpus: string, id: string, text: string): void {
  mkdirSync(repoPath('datasets', corpus, 'texts'), { recursive: true });
  writeFileSync(textPath(corpus, id), `${text}\n`, 'utf8');
}

/** Take whole sentences up to a word budget, without overshooting badly. */
function takeToBudget(source: string[], budget: number): string[] {
  const taken: string[] = [];
  let words = 0;
  for (const s of source) {
    const w = wordCount(s);
    if (words + w > budget && words >= budget - w / 2) break;
    taken.push(s);
    words += w;
    if (words >= budget) break;
  }
  return taken.length > 0 ? taken : source.slice(0, 1);
}

type Provenance = Array<{ sentence: number; source: 'human' | 'ai' }>;

function splice(
  mode: string,
  humanSents: string[],
  aiSents: string[],
): { text: string; provenance: Provenance; aiFraction: number } {
  let ordered: Array<{ text: string; source: 'human' | 'ai' }>;

  const h = humanSents.map((text) => ({ text, source: 'human' as const }));
  const a = aiSents.map((text) => ({ text, source: 'ai' as const }));

  if (mode === 'human-draft-ai-expanded') {
    const cut = Math.max(1, Math.round(h.length / 3));
    ordered = [...h.slice(0, cut), ...a, ...h.slice(cut)];
  } else if (mode === 'ai-draft-human-edited') {
    const cut = Math.max(1, Math.round(a.length / 3));
    ordered = [...a.slice(0, cut), ...h, ...a.slice(cut)];
  } else if (mode === 'alternating') {
    ordered = [];
    const stride = Math.max(1, Math.round(a.length / Math.max(1, h.length)));
    let ai = 0;
    for (const hs of h) {
      for (let k = 0; k < stride && ai < a.length; k++) ordered.push(a[ai++]!);
      ordered.push(hs);
    }
    while (ai < a.length) ordered.push(a[ai++]!);
  } else {
    throw new Error(`unknown splice mode: ${mode}`);
  }

  const aiWords = ordered.filter((s) => s.source === 'ai').reduce((n, s) => n + wordCount(s.text), 0);
  const totalWords = ordered.reduce((n, s) => n + wordCount(s.text), 0);

  return {
    text: ordered.map((s) => s.text).join(' '),
    provenance: ordered.map((s, i) => ({ sentence: i, source: s.source })),
    aiFraction: totalWords === 0 ? 0 : aiWords / totalWords,
  };
}

function applyTransform(entry: HumanEntry, source: string): string {
  switch (entry.transform) {
    case 'truncate-to-window': {
      const out: string[] = [];
      let words = 0;
      for (const s of sentences(source)) {
        out.push(s);
        words += wordCount(s);
        if (words >= 60) break;
      }
      return out.join(' ');
    }
    case 'languagetool-full':
      throw new Error(
        `${entry.id} needs a LanguageTool pass. Run scripts/transforms/grammar-correct.ts against a local ` +
          `LanguageTool server and drop the result at datasets/false-positive/texts/${entry.id}.txt.`,
      );
    default:
      throw new Error(`unknown transform on ${entry.id}: ${entry.transform}`);
  }
}

function main(): void {
  const cycle = arg('cycle');
  const cycleDir = repoPath('data', 'cycles', cycle);

  const humanManifest = readJson<{ entries: HumanEntry[] }>(repoPath('datasets/human/manifest.json'));
  const fpManifest = readJson<{ entries: HumanEntry[] }>(repoPath('datasets/false-positive/manifest.json'));
  const hybridSpec = readJson<{ plan: Array<Record<string, string | number>>; ratioTolerance: number }>(
    repoPath('datasets/hybrid/spec.json'),
  );
  const prompts = readJson<Array<{ id: string; domain: string; generator: string }>>(`${cycleDir}/prompts.json`);

  const samples: Sample[] = [];
  const missing: string[] = [];
  const texts = new Map<string, string>();

  heading(`Building corpus for cycle ${cycle}`);

  const ingest = (corpus: string, entry: HumanEntry, cls: 'human' | 'fp' | 'ai') => {
    let text = loadText(corpus, entry.id);
    if (!text && entry.source === 'derived') {
      const base = texts.get(entry.derivedFrom as string);
      if (!base) {
        missing.push(`${entry.id} (derived from ${entry.derivedFrom}, which is itself missing)`);
        return;
      }
      try {
        text = normalize(applyTransform(entry, base));
        saveText(corpus, entry.id, text);
      } catch (err) {
        missing.push(`${entry.id}: ${(err as Error).message}`);
        return;
      }
    }
    if (!text) {
      missing.push(`${entry.id} -> ${textPath(corpus, entry.id).replace(repoPath(), '.')}`);
      return;
    }
    texts.set(entry.id, text);
    samples.push({
      id: entry.id,
      class: cls,
      domain: entry.domain ?? 'mixed',
      ...(entry.profile ? { profile: entry.profile } : {}),
      aiFraction: cls === 'ai' ? 1 : 0,
      words: wordCount(text),
      sha256: sha256(text),
      origin: { corpus, source: entry.source, ...(entry.docId ? { docId: entry.docId } : {}) },
    });
  };

  for (const entry of humanManifest.entries) ingest('human', entry, 'human');
  for (const entry of prompts) {
    ingest('ai', { id: entry.id, domain: entry.domain, source: `generator:${entry.generator}` }, 'ai');
  }
  // False positives run last: three of them are transforms of texts loaded above.
  for (const entry of fpManifest.entries) ingest('false-positive', entry, 'fp');

  for (const plan of hybridSpec.plan) {
    const humanText = texts.get(plan.humanSource as string);
    const aiText = texts.get(plan.aiSource as string);
    if (!humanText || !aiText) {
      missing.push(`${plan.id} (needs ${plan.humanSource} + ${plan.aiSource})`);
      continue;
    }
    const target = plan.aiFractionTarget as number;
    const aiBudget = Math.round(target * HYBRID_TARGET_WORDS);
    const humanBudget = HYBRID_TARGET_WORDS - aiBudget;

    const spliced = splice(
      plan.mode as string,
      takeToBudget(sentences(humanText), humanBudget),
      takeToBudget(sentences(aiText), aiBudget),
    );

    const drift = Math.abs(spliced.aiFraction - target);
    if (drift > hybridSpec.ratioTolerance) {
      fail(`${plan.id}: spliced AI fraction ${spliced.aiFraction.toFixed(3)} misses target ${target} by ${drift.toFixed(3)}`);
    }

    saveText('hybrid', plan.id as string, spliced.text);
    samples.push({
      id: plan.id as string,
      class: 'hybrid',
      domain: plan.domain as string,
      // Rounded to 4dp so the committed ground truth is a stable decimal rather
      // than whatever float the splice happened to land on.
      aiFraction: Math.round(spliced.aiFraction * 1e4) / 1e4,
      words: wordCount(spliced.text),
      sha256: sha256(spliced.text),
      provenance: spliced.provenance,
      origin: {
        corpus: 'hybrid',
        mode: plan.mode,
        humanSource: plan.humanSource,
        aiSource: plan.aiSource,
        aiFractionTarget: target,
      },
    });
  }

  if (missing.length > 0) {
    fail(`${missing.length} source text(s) not present locally:`);
    for (const m of missing) info(m);
    console.log(
      '\nFetch each from the URL in its manifest entry, save it as plain text at the path shown, ' +
        'and re-run. Source texts are deliberately not redistributed by this repository.',
    );
    process.exitCode = 1;
    return;
  }

  writeJson(`${cycleDir}/samples.json`, samples);
  ok(`${samples.length} samples -> data/cycles/${cycle}/samples.json`);
  for (const [cls, n] of Object.entries(
    samples.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }), {}),
  )) {
    info(`${cls}: ${n}`);
  }
}

main();
