/**
 * SCORING LOGIC v1 — the canonical copy.
 *
 * Opening a cycle copies this file into that cycle's directory, where it is
 * frozen: a cycle is scored for the rest of its life by the rules that existed
 * when it opened, and the copy is never edited in place. Changing the
 * methodology means adding methodology/v2 and recording what moved in
 * CHANGES.md, so a published number can never change meaning after the fact.
 *
 * Re-running a cycle's copy over its samples.json and detector-results.json must
 * reproduce its leaderboard.json byte for byte. scripts/verify-cycle.ts does
 * exactly that, which is why this file has no I/O, no clock, no randomness and
 * no dependencies: it is a pure function of its inputs, and a stranger must be
 * able to re-run it offline in five years.
 */

export const SCORING_VERSION = '1.0.0';

/** Composite weights, in points. Must sum to 100. */
export const WEIGHTS = Object.freeze({
  aiRecall: 30,
  humanSpecificity: 25,
  fpResistance: 20,
  hybridAccuracy: 15,
  consistency: 10,
});

export const PENALTY_CAPS = Object.freeze({
  error: 6,
  hardFail: 6,
  total: 10,
});

/** A metric below this is a hard fail: the detector is unfit for that class of text. */
const HARD_FAIL_FLOOR = 0.5;

/** Repeat-run drift of this many probability points scores zero on stability. */
const DRIFT_SATURATION = 25;

/** Cross-domain balanced-accuracy spread of this size scores zero on evenness. */
const SPREAD_SATURATION = 0.25;

const round = (n, dp = 2) => {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  // Round half away from zero so the value does not depend on float parity.
  return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON) / f;
};

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Wilson 95% interval for a rate observed over n samples.
 *
 * A corpus of this size cannot resolve small differences, and reporting
 * `aiRecall: 0.9643` without saying so invites readers to treat a one-sample
 * difference as a finding. The interval is reported next to every rate metric
 * and deliberately does not feed the composite: it is there to tell you when
 * two adjacent rows are not actually distinguishable.
 */
function wilson(successes, n, z = 1.96) {
  if (n === 0) return null;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round(clamp01(centre - half), 4), round(clamp01(centre + half), 4)];
}

/**
 * Collapse the repeated runs of one detector on one sample into a single
 * reading, plus the drift between runs.
 */
function collapseRuns(runs) {
  const errored = runs.filter((r) => r.error);
  const ok = runs.filter((r) => !r.error && typeof r.aiProbability === 'number');
  if (ok.length === 0) {
    return { probability: null, drift: null, error: errored[0]?.error ?? 'no-reading' };
  }
  const probs = ok.map((r) => r.aiProbability);
  return {
    probability: mean(probs),
    drift: probs.length < 2 ? 0 : Math.max(...probs) - Math.min(...probs),
    // A sample that errored on one run and answered on another is a partial
    // failure: the reading counts, and the error still counts against stability.
    error: errored.length > 0 ? 'partial' : null,
  };
}

/**
 * @param {object} input
 * @param {Array} input.samples   Ground truth. { id, class, domain, profile?, aiFraction, words }
 * @param {Array} input.results   Raw readings. { detector, sampleId, run, aiProbability, error }
 * @param {Array} input.detectors Registry entries. { slug, name, threshold, granularity, ... }
 * @returns {object} leaderboard payload
 */
export function scoreCycle({ samples, results, detectors }) {
  const sampleById = new Map(samples.map((s) => [s.id, s]));

  // detector -> sampleId -> runs[]
  const byDetector = new Map();
  for (const r of results) {
    if (!sampleById.has(r.sampleId)) {
      throw new Error(`result references unknown sample: ${r.sampleId}`);
    }
    if (!byDetector.has(r.detector)) byDetector.set(r.detector, new Map());
    const bySample = byDetector.get(r.detector);
    if (!bySample.has(r.sampleId)) bySample.set(r.sampleId, []);
    bySample.get(r.sampleId).push(r);
  }

  const rows = detectors.map((detector) => scoreDetector(detector, samples, byDetector.get(detector.slug) ?? new Map()));

  rows.sort(
    (a, b) =>
      b.composite - a.composite ||
      b.metrics.fpResistance - a.metrics.fpResistance ||
      b.metrics.aiRecall - a.metrics.aiRecall ||
      a.slug.localeCompare(b.slug),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return {
    scoringVersion: SCORING_VERSION,
    weights: WEIGHTS,
    sampleCounts: countBy(samples, (s) => s.class),
    leaderboard: rows,
  };
}

function scoreDetector(detector, samples, bySample) {
  const threshold = detector.threshold ?? 50;

  /** @type {Array<{sample: object, probability: number|null, drift: number|null, error: string|null}>} */
  const readings = samples.map((sample) => {
    const runs = bySample.get(sample.id) ?? [];
    if (runs.length === 0) return { sample, probability: null, drift: null, error: 'not-run' };
    return { sample, ...collapseRuns(runs) };
  });

  const scored = readings.filter((r) => r.probability !== null);
  const errorRate = samples.length === 0 ? 0 : (readings.length - scored.length) / readings.length;

  const inClass = (cls) => scored.filter((r) => r.sample.class === cls);
  const flagged = (r) => r.probability >= threshold;
  const flagRate = (rs) => (rs.length === 0 ? null : rs.filter(flagged).length / rs.length);

  const aiSet = inClass('ai');
  const humanSet = inClass('human');
  const fpSet = inClass('fp');
  const hybridSet = inClass('hybrid');

  const aiRecall = flagRate(aiSet) ?? 0;
  const humanFlagRate = flagRate(humanSet) ?? 0;
  const fpFlagRate = flagRate(fpSet) ?? 0;
  const humanSpecificity = 1 - humanFlagRate;
  const fpResistance = 1 - fpFlagRate;

  // Hybrid: how close is the reported AI share to the share we spliced in?
  const hybridErrors = hybridSet.map((r) => r.probability / 100 - r.sample.aiFraction);
  const hybridMae = hybridErrors.length === 0 ? null : mean(hybridErrors.map(Math.abs));
  const hybridAccuracy = hybridMae === null ? 0 : clamp01(1 - hybridMae);

  // Consistency: half repeat-run stability, half evenness across domains.
  const drifts = scored.map((r) => r.drift).filter((d) => typeof d === 'number');
  const meanDrift = drifts.length === 0 ? 0 : mean(drifts);
  const stability = clamp01(1 - meanDrift / DRIFT_SATURATION);

  const domains = [...new Set(samples.map((s) => s.domain))].sort();
  const perDomain = domains
    .map((domain) => {
      const inDomain = scored.filter((r) => r.sample.domain === domain);
      const pos = inDomain.filter((r) => r.sample.class === 'ai');
      const neg = inDomain.filter((r) => r.sample.class === 'human' || r.sample.class === 'fp');
      if (pos.length === 0 || neg.length === 0) return null;
      const balanced = 0.5 * (flagRate(pos) + (1 - flagRate(neg)));
      return { domain, balancedAccuracy: round(balanced, 4), samples: inDomain.length };
    })
    .filter(Boolean);
  const evenness = clamp01(1 - stdev(perDomain.map((d) => d.balancedAccuracy)) / SPREAD_SATURATION);
  const consistency = 0.5 * stability + 0.5 * evenness;

  const metrics = { aiRecall, humanSpecificity, fpResistance, hybridAccuracy, consistency };

  const earned =
    WEIGHTS.aiRecall * aiRecall +
    WEIGHTS.humanSpecificity * humanSpecificity +
    WEIGHTS.fpResistance * fpResistance +
    WEIGHTS.hybridAccuracy * hybridAccuracy +
    WEIGHTS.consistency * consistency;

  const hardFails = ['aiRecall', 'humanSpecificity', 'fpResistance'].filter((k) => metrics[k] < HARD_FAIL_FLOOR);
  const penalties = {
    error: Math.min(PENALTY_CAPS.error, round(12 * errorRate)),
    hardFail: Math.min(PENALTY_CAPS.hardFail, 3 * hardFails.length),
  };
  const penaltyTotal = Math.min(PENALTY_CAPS.total, penalties.error + penalties.hardFail);
  const composite = Math.max(0, earned - penaltyTotal);

  // Diagnostics. These do not feed the composite; they are what a reader
  // actually needs in order to disagree with the composite.
  const positives = [...aiSet, ...hybridSet.filter((r) => r.sample.aiFraction >= 0.5)];
  const negatives = [...humanSet, ...fpSet, ...hybridSet.filter((r) => r.sample.aiFraction < 0.5)];
  const tp = positives.filter(flagged).length;
  const fn = positives.length - tp;
  const fp = negatives.filter(flagged).length;
  const tn = negatives.length - fp;

  return {
    rank: 0,
    slug: detector.slug,
    name: detector.name,
    composite: round(composite),
    metrics: {
      aiRecall: round(aiRecall, 4),
      humanSpecificity: round(humanSpecificity, 4),
      fpResistance: round(fpResistance, 4),
      hybridAccuracy: round(hybridAccuracy, 4),
      consistency: round(consistency, 4),
    },
    points: {
      aiRecall: round(WEIGHTS.aiRecall * aiRecall),
      humanSpecificity: round(WEIGHTS.humanSpecificity * humanSpecificity),
      fpResistance: round(WEIGHTS.fpResistance * fpResistance),
      hybridAccuracy: round(WEIGHTS.hybridAccuracy * hybridAccuracy),
      consistency: round(WEIGHTS.consistency * consistency),
      penalty: -round(penaltyTotal),
    },
    penalties: { ...penalties, total: round(penaltyTotal), hardFailedMetrics: hardFails },
    intervals: {
      // Rate metrics only. Hybrid accuracy and consistency are means, not
      // proportions, so a binomial interval would be the wrong instrument.
      aiRecall: wilson(aiSet.filter(flagged).length, aiSet.length),
      humanSpecificity: wilson(humanSet.length - humanSet.filter(flagged).length, humanSet.length),
      fpResistance: wilson(fpSet.length - fpSet.filter(flagged).length, fpSet.length),
    },
    diagnostics: {
      threshold,
      granularity: detector.granularity ?? 'document',
      sampleCounts: { ai: aiSet.length, human: humanSet.length, fp: fpSet.length, hybrid: hybridSet.length },
      falsePositiveRate: round(negatives.length === 0 ? 0 : fp / negatives.length, 4),
      falseNegativeRate: round(positives.length === 0 ? 0 : fn / positives.length, 4),
      balancedAccuracy: round(
        0.5 * (positives.length ? tp / positives.length : 0) + 0.5 * (negatives.length ? tn / negatives.length : 0),
        4,
      ),
      f1: round(tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn), 4),
      confusion: { tp, fp, tn, fn },
      hybridMeanAbsError: round(hybridMae, 4),
      // Signed: positive means the detector reads hybrids as more machine-made
      // than they are, negative means it under-reads them.
      hybridBias: round(hybridErrors.length ? mean(hybridErrors) : null, 4),
      meanRepeatDrift: round(meanDrift, 3),
      errorRate: round(errorRate, 4),
      perDomain,
      perFalsePositiveProfile: profileBreakdown(fpSet, flagged),
      perHybridRatio: ratioBreakdown(hybridSet),
    },
  };
}

function profileBreakdown(fpSet, flagged) {
  const profiles = [...new Set(fpSet.map((r) => r.sample.profile).filter(Boolean))].sort();
  return profiles.map((profile) => {
    const rs = fpSet.filter((r) => r.sample.profile === profile);
    return {
      profile,
      samples: rs.length,
      falsePositiveRate: round(rs.filter(flagged).length / rs.length, 4),
      meanAiProbability: round(mean(rs.map((r) => r.probability)), 2),
    };
  });
}

/**
 * Splicing at sentence boundaries lands near the planned ratio, not exactly on
 * it, so every hybrid has a slightly different true fraction. Grouping on the
 * raw value would produce one bucket per sample and say nothing; the breakdown
 * is by planned band instead, and reports the true mean of each band so the
 * reported mean can be read against it.
 */
function ratioBreakdown(hybridSet) {
  const band = (f) => Math.round(f * 4) / 4;
  const bands = [...new Set(hybridSet.map((r) => band(r.sample.aiFraction)))].sort((a, b) => a - b);
  return bands.map((targetBand) => {
    const rs = hybridSet.filter((r) => band(r.sample.aiFraction) === targetBand);
    return {
      band: targetBand,
      samples: rs.length,
      trueMeanAiFraction: round(mean(rs.map((r) => r.sample.aiFraction)), 4),
      meanReported: round(mean(rs.map((r) => r.probability)), 2),
      meanAbsError: round(mean(rs.map((r) => Math.abs(r.probability / 100 - r.sample.aiFraction))), 4),
      meanSignedError: round(mean(rs.map((r) => r.probability / 100 - r.sample.aiFraction)), 4),
    };
  });
}

function countBy(xs, keyFn) {
  const out = {};
  for (const x of xs) {
    const k = keyFn(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
