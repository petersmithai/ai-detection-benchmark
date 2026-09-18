/**
 * Text normalisation and splitting. Every corpus text passes through
 * `normalize` before it is hashed or sent to a detector, so a detector is never
 * scored on a difference in line endings or curly quotes.
 */

export function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const paragraphs = (text: string): string[] =>
  normalize(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Sentence split good enough for splicing prose at seams. Deliberately simple
 * and deterministic: it protects a short list of abbreviations and otherwise
 * breaks after terminal punctuation followed by whitespace and a capital.
 */
const ABBREVIATIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'St', 'e.g', 'i.e', 'etc', 'vs', 'Fig', 'No', 'Inc', 'Ltd'];

export function sentences(text: string): string[] {
  const t = normalize(text);
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n') continue;
    if (ch === '\n') {
      const chunk = t.slice(start, i).trim();
      if (chunk) out.push(chunk);
      start = i + 1;
      continue;
    }

    // Swallow a run of closing punctuation: `word."` `word.)`
    let end = i + 1;
    while (end < t.length && `"')]`.includes(t[end] as string)) end++;
    const next = t.slice(end);
    if (next && !/^\s/.test(next)) continue;
    if (next.trim() && !/^\s+["'(\[]?[A-Z0-9]/.test(next)) continue;

    const candidate = t.slice(start, end).trim();
    const lastWord = candidate.replace(/[^A-Za-z.]+$/, '').split(/[\s(]/).pop() ?? '';
    if (ABBREVIATIONS.includes(lastWord.replace(/\.$/, ''))) continue;

    if (candidate) out.push(candidate);
    start = end;
  }

  const tail = t.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export const wordCount = (text: string): number => (normalize(text).match(/\S+/g) ?? []).length;
