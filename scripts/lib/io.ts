import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const repoPath = (...parts: string[]): string => resolve(REPO_ROOT, ...parts);

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Every JSON file this repo writes goes through here: two-space indent, keys in
 * insertion order, one trailing newline. Byte-stable output is what makes the
 * manifest hashes in cycle.json mean anything.
 */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

export function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export const ok = (msg: string) => console.log(`  [32m✓[0m ${msg}`);
export const fail = (msg: string) => console.log(`  [31m✗[0m ${msg}`);
export const info = (msg: string) => console.log(`  [2m·[0m ${msg}`);
export const heading = (msg: string) => console.log(`\n[1m${msg}[0m`);
