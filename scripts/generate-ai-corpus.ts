/**
 * Generate the AI half of the corpus from the cycle's revealed prompts.
 *
 *   npm run generate-ai -- --cycle 2026-10
 *
 * One rule governs this script: the prompt goes to the model unmodified, with
 * no system prompt, at each generator's documented default sampling settings.
 * The moment you add "write in a natural human voice" you are benchmarking
 * prompt engineering, not detection. Whatever a generator produces when asked
 * plainly is what a detector has to catch.
 *
 * Exact model ids are pinned per cycle in generators.json and recorded in
 * cycle.json, so a future reader knows which model generation the numbers
 * describe. Detectors are retrained against new models constantly; a detection
 * score with no generator provenance is close to meaningless.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fail, heading, info, ok, readJson, repoPath } from './lib/io.js';
import { normalize, wordCount } from './lib/text.js';

interface Generator {
  slug: string;
  provider: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
  model: string;
  keyEnv: string;
  baseUrl?: string;
  maxTokens: number;
}

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
};

async function callOpenAiCompatible(gen: Generator, prompt: string, key: string): Promise<string> {
  const res = await fetch(`${gen.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: gen.model, messages: [{ role: 'user', content: prompt }], max_tokens: gen.maxTokens }),
  });
  if (!res.ok) throw new Error(`${gen.slug}: http ${res.status} ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${gen.slug}: empty completion`);
  return text;
}

async function callAnthropic(gen: Generator, prompt: string, key: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: gen.model, max_tokens: gen.maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`${gen.slug}: http ${res.status} ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = body.content?.map((b) => b.text ?? '').join('');
  if (!text) throw new Error(`${gen.slug}: empty completion`);
  return text;
}

async function callGoogle(gen: Generator, prompt: string, key: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${gen.model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: gen.maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`${gen.slug}: http ${res.status} ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new Error(`${gen.slug}: empty completion`);
  return text;
}

async function generate(gen: Generator, prompt: string): Promise<string> {
  const key = process.env[gen.keyEnv];
  if (!key) throw new Error(`missing ${gen.keyEnv}`);
  switch (gen.provider) {
    case 'anthropic':
      return callAnthropic(gen, prompt, key);
    case 'google':
      return callGoogle(gen, prompt, key);
    default:
      return callOpenAiCompatible(gen, prompt, key);
  }
}

/**
 * Models often wrap a requested text in a title, a preamble or a closing offer
 * to revise. Those are artefacts of the chat interface, not of the writing, and
 * leaving them in would hand every detector a free signal that has nothing to do
 * with the prose. Stripping them is documented here rather than done quietly.
 */
function stripChatFraming(raw: string): string {
  let text = normalize(raw);
  text = text.replace(/^\s*(?:#{1,6} .*|\*\*.*\*\*)\n+/, '');
  text = text.replace(/^(?:Sure|Certainly|Here(?:'s| is)|Of course)[^\n]*\n+/i, '');
  text = text.replace(/\n+(?:Let me know|Would you like|I hope this|Feel free)[^\n]*$/i, '');
  return normalize(text);
}

async function main(): Promise<void> {
  const cycle = arg('cycle');
  const dir = repoPath('data', 'cycles', cycle);
  const prompts = readJson<Array<{ id: string; generator: string; prompt: string; domain: string }>>(`${dir}/prompts.json`);
  const generators = readJson<{ generators: Generator[] }>(`${dir}/generators.json`).generators;
  const bySlug = new Map(generators.map((g) => [g.slug, g]));

  const outDir = repoPath('datasets', 'ai', 'texts');
  mkdirSync(outDir, { recursive: true });

  heading(`Generating AI corpus for cycle ${cycle}`);
  let written = 0;
  let skipped = 0;

  for (const p of prompts) {
    const path = `${outDir}/${p.id}.txt`;
    if (existsSync(path) && !process.argv.includes('--force')) {
      skipped++;
      continue;
    }
    const gen = bySlug.get(p.generator);
    if (!gen) throw new Error(`prompt ${p.id} names unknown generator ${p.generator}`);

    try {
      const text = stripChatFraming(await generate(gen, p.prompt));
      const words = wordCount(text);
      if (words < 120) {
        fail(`${p.id}: ${words} words is below the corpus floor — regenerate or adjust the prompt`);
      }
      writeFileSync(path, `${text}\n`, 'utf8');
      ok(`${p.id} (${gen.model}, ${words}w)`);
      written++;
    } catch (err) {
      fail(`${p.id}: ${(err as Error).message}`);
    }
  }

  info(`${written} generated, ${skipped} already present (pass --force to regenerate)`);
  info(`next: npm run build-corpus -- --cycle ${cycle}`);
}

main().catch((err) => {
  fail((err as Error).message);
  process.exitCode = 1;
});
