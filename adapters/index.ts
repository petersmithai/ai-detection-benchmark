/**
 * One generic adapter, configured per detector from detectors/registry.json.
 *
 * Twelve bespoke client files would be twelve places for a scoring bug to hide.
 * The vendors differ in three ways that actually matter — where the number
 * lives in the response, which axis it is on, and how the key is presented —
 * and all three are declarative. Anything a vendor does that this cannot
 * express belongs in `QUIRKS` below, in the open, next to the reason.
 */

import type { Detector, DetectorApiConfig, Reading } from '../scripts/lib/types.js';

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Vendor-specific behaviour that a config field cannot describe. */
const QUIRKS: Record<string, { preflight?: (d: Detector) => Promise<Record<string, string>> }> = {
  copyleaks: {
    // Copyleaks trades an API key for a short-lived bearer token rather than
    // accepting the key directly. Cached for the life of the process.
    preflight: async (d) => {
      const cfg = d.api as DetectorApiConfig;
      const email = requireEnv('COPYLEAKS_EMAIL', d.slug);
      const key = requireEnv(cfg.keyEnv, d.slug);
      const res = await fetch(cfg.loginEndpoint as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, key }),
      });
      if (!res.ok) throw new AdapterError(`copyleaks login failed: ${res.status}`, res.status >= 500);
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token) throw new AdapterError('copyleaks login returned no token', false);
      return { authorization: `Bearer ${body.access_token}` };
    },
  },
};

const preflightCache = new Map<string, Promise<Record<string, string>>>();

function requireEnv(name: string, slug: string): string {
  const value = process.env[name];
  if (!value) throw new AdapterError(`missing ${name} for ${slug}; see .env.example`, false);
  return value;
}

/** Read `a.b.0.c` out of an arbitrary JSON response. */
function pluck(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || node === undefined) return undefined;
    return (node as Record<string, unknown>)[key];
  }, source);
}

/**
 * Put every vendor on one axis: 0 = certainly human, 100 = certainly machine.
 * Winston reports the opposite axis, several report 0-1, and getting this
 * backwards for one detector would silently invert its whole scorecard — so it
 * is one function, exported, and covered by a test.
 */
export function toAiProbability(raw: number, scale: DetectorApiConfig['scoreScale']): number {
  if (!Number.isFinite(raw)) throw new AdapterError(`non-numeric score: ${raw}`, false);
  switch (scale) {
    case 'ai-0-1':
      return clampPct(raw * 100);
    case 'ai-0-100':
      return clampPct(raw);
    case 'human-0-1':
      return clampPct(100 - raw * 100);
    case 'human-0-100':
      return clampPct(100 - raw);
  }
}

/**
 * Clamp to 0-100 and round to 2dp. The rounding matters: scaling a vendor's 0.07
 * by 100 yields 7.000000000000001 in binary floating point, and that artefact
 * would be committed to detector-results.json and hashed into the cycle
 * manifest. No detector reports meaningful precision past two decimals anyway.
 */
const clampPct = (n: number): number => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;

function buildBody(template: Record<string, unknown>, text: string, key: string): unknown {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return node.replace('{{TEXT}}', text).replace('{{KEY}}', key);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return walk(template);
}

export interface ProbeOptions {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Send one sample to one detector and return a normalised reading.
 * Never throws: a failure is a recorded reading with an `error`, because a
 * detector that cannot answer has told us something about itself.
 */
export async function probe(
  detector: Detector,
  sample: { id: string; text: string; words: number },
  run: number,
  options: ProbeOptions = {},
): Promise<Reading> {
  const base: Reading = {
    detector: detector.slug,
    sampleId: sample.id,
    run,
    aiProbability: null,
    error: null,
    latencyMs: null,
    collectedAt: new Date().toISOString(),
  };

  if (detector.access === 'manual' || !detector.api) {
    return { ...base, error: 'manual-collection-required' };
  }
  if (sample.words < detector.minWords) {
    // Not a fault: the vendor documents a floor and we respect it. It still
    // counts as an unanswered sample, which is the honest cost of that floor.
    return { ...base, error: `below-vendor-minimum(${detector.minWords}w)` };
  }

  const cfg = detector.api;
  const { timeoutMs = 60_000, retries = 2 } = options;
  const started = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const key = requireEnv(cfg.keyEnv, detector.slug);
      const headers: Record<string, string> = { 'content-type': 'application/json' };

      const quirk = QUIRKS[detector.slug];
      if (quirk?.preflight) {
        if (!preflightCache.has(detector.slug)) preflightCache.set(detector.slug, quirk.preflight(detector));
        Object.assign(headers, await preflightCache.get(detector.slug));
      } else if (cfg.auth === 'bearer') {
        headers.authorization = `Bearer ${key}`;
      } else if (cfg.auth === 'header') {
        headers[cfg.authHeader ?? 'x-api-key'] = key;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(cfg.endpoint, {
          method: cfg.method,
          headers,
          body: JSON.stringify(buildBody(cfg.bodyTemplate, sample.text, key)),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 429 || res.status >= 500) {
        throw new AdapterError(`http ${res.status}`, true);
      }
      if (!res.ok) {
        throw new AdapterError(`http ${res.status}: ${(await res.text()).slice(0, 200)}`, false);
      }

      const payload = await res.json();
      const raw = pluck(payload, cfg.scorePath);
      if (typeof raw !== 'number') {
        throw new AdapterError(`no score at '${cfg.scorePath}' in response`, false);
      }

      return {
        ...base,
        aiProbability: toAiProbability(raw, cfg.scoreScale),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      const retryable = err instanceof AdapterError ? err.retryable : true;
      const last = attempt === retries;
      if (!retryable || last) {
        return { ...base, error: (err as Error).message.slice(0, 200), latencyMs: Date.now() - started };
      }
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }

  return { ...base, error: 'unreachable' };
}
