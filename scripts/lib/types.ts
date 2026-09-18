export type SampleClass = 'ai' | 'human' | 'hybrid' | 'fp';

export interface Sample {
  id: string;
  class: SampleClass;
  domain: string;
  /** Only set on false-positive samples. */
  profile?: string;
  /** Ground truth share of the text contributed by a generator, 0..1. */
  aiFraction: number;
  words: number;
  sha256: string;
  /** Sentence-level provenance, present on hybrids for localisation scoring. */
  provenance?: Array<{ sentence: number; source: 'human' | 'ai' }>;
  origin: Record<string, unknown>;
}

export interface DetectorApiConfig {
  endpoint: string;
  method: string;
  auth: 'bearer' | 'header' | 'body';
  authHeader?: string;
  keyEnv: string;
  loginEndpoint?: string;
  bodyTemplate: Record<string, unknown>;
  scorePath: string;
  /** How the vendor expresses its number, normalised to ai-0-100 by the adapter. */
  scoreScale: 'ai-0-1' | 'ai-0-100' | 'human-0-100' | 'human-0-1';
  sentencePath?: string;
}

export interface Detector {
  slug: string;
  name: string;
  vendor: string;
  url: string;
  access: 'api' | 'manual';
  api: DetectorApiConfig | null;
  threshold: number;
  granularity: 'document' | 'sentence';
  minWords: number;
  plan: string;
  notes: string | null;
}

export interface Reading {
  detector: string;
  sampleId: string;
  run: number;
  /** Normalised to a 0-100 AI probability regardless of the vendor's own axis. */
  aiProbability: number | null;
  error: string | null;
  latencyMs: number | null;
  collectedAt?: string;
  /** Operator remark from a hand-collection sheet, kept in the cycle record. */
  notes?: string;
}
