# Cycle 2026-08 — detailed results

Five detectors, 91 texts, two passes two days apart. 910 readings, six
unanswered (0.7%).

Everything here derives from
[`detector-results.json`](../data/cycles/2026-08/detector-results.json) via
[`scoring.js`](../data/cycles/2026-08/scoring.js). `npm run verify -- 2026-08`
re-derives the leaderboard from the raw readings and fails if a single byte was
edited by hand.

---

## Composite

| # | Detector | Version | Score | Recall | Human | FP-resist | Hybrid | Consist |
|---|---|---|------:|-------:|------:|----------:|-------:|--------:|
| 1 | Winston AI | v4.15 | **91.70** | 92.9% | 100.0% | 100.0% | 79.9% | 61.4% |
| 2 | Copyleaks | 2026.08 | **91.38** | 96.4% | 100.0% | 95.2% | 79.7% | 68.0% |
| 3 | GPTZero | 4.9b | **85.40** | 92.9% | 100.0% | 81.0% | 82.5% | 61.2% |
| 4 | ZeroGPT | DeepAnalyse | **65.78** | 89.3% | 100.0% | 38.1% | 80.8% | 54.7% |
| 5 | Pangram | 4.0 | **61.01** | 78.6% | 100.0% | 33.3% | 81.2% | 44.6% |

Scored under methodology v2 — weights 20 / 20 / 35 / 15 / 10, revised on
2026-09-03 after this cycle had already been scored and published under v1
(30 / 25 / 20 / 15 / 10). [CHANGES.md](../CHANGES.md) carries both tables and
the reasoning.

ZeroGPT and Pangram each take a 3-point hard-fail penalty for false-positive
resistance below 50%. No other penalties.

### Confidence intervals (Wilson, 95%)

| Detector | AI recall | FP resistance |
|---|---|---|
| Copyleaks | 82.3 – 99.4% | 77.3 – 99.2% |
| Winston AI | 77.3 – 98.0% | 84.5 – 100% |
| GPTZero | 77.3 – 98.0% | 60.0 – 92.3% |
| ZeroGPT | 72.8 – 96.3% | 20.8 – 59.1% |
| Pangram | 60.5 – 89.8% | 17.2 – 54.6% |

**Ranks 1 and 2 are not distinguishable** — 0.32 points apart with overlapping
intervals on both metrics, and they exchange places under the two weightings
(Copyleaks led under v1, Winston leads under v2). Ranks 4 and 5 are not distinguishable from each
other either. The real result is a three-way top group and a two-way bottom
group, not a strict ordering.

**Every detector cleared all 21 clean-human documents.** Human specificity is
100% across the board, so it contributes 25 identical points to every row and
does no separating work. Everything below comes from the other four components.

---

## 1. Hybrid detection: the shared failure

Mean reported AI percentage against true AI content by word count:

| True | Copyleaks | Winston AI | GPTZero | ZeroGPT | Pangram |
|---|---|---|---|---|---|
| 25% | 50.4 | 40.5 | 40.6 | 45.5 | 33.7 |
| 50% | 50.5 | 34.9 | 52.5 | 47.3 | 45.2 |
| 75% | 58.4 | 55.2 | 62.2 | 53.9 | 49.6 |
| **25% → 75%** | **+8.0** | **+14.7** | **+21.6** | **+8.4** | **+15.9** |

Ground truth moves 50 points across those rows. The best-tracking detector moves
21.6 of them; the worst moves 8.0. Winston's 50% band reads *below* its 25%
band — non-monotonic on a quantity that is monotonic by construction.

| Detector | Mean absolute error | Signed bias |
|---|---:|---:|
| GPTZero | 17.5 pts | +1.8 |
| Pangram | 18.8 pts | −7.2 |
| ZeroGPT | 19.3 pts | −1.1 |
| Winston AI | 20.1 pts | −6.5 |
| Copyleaks | 20.3 pts | +3.1 |

Read bias alongside the range: a detector that always answers "50%" has near-zero
bias and no information. Copyleaks is close to that on the first two bands.

**What this means practically.** These percentages support a binary question —
*is there machine text here* — and do not support a proportional one. Any process
that reads "62% AI" as "62% of this document was written by a model" is reading
something the number does not contain. It is the one failure every tool on this
table shares, and no tool scores above 83% on it.

---

## 2. False positives

All 21 stress documents are human-written. Flags out of 3 per profile:

| Profile | Copyleaks | Winston | GPTZero | ZeroGPT | Pangram | Total |
|---|---|---|---|---|---|---|
| Second-language (ESL) | 0 | 0 | **3** | **3** | **3** | **9/15** |
| Grammar-corrected | 0 | 0 | 0 | **3** | **3** | 6/15 |
| Short-form | 0 | 0 | 1 | **3** | **3** | 7/15 |
| Template-structured | 1 | 0 | 0 | **3** | **3** | 7/15 |
| Technical / formulaic | 0 | 0 | 0 | 1 | 1 | 2/15 |
| Translated | 0 | 0 | 0 | 0 | 1 | 1/15 |
| Archaic (pre-1930) | 0 | 0 | 0 | 0 | 0 | 0/15 |

### Second-language writing is the sharpest split on this benchmark

**GPTZero, ZeroGPT and Pangram each flagged all three ESL documents. Copyleaks
and Winston cleared all three.** Not a gradient — a clean partition.

The documents are a University of Helsinki placement essay, a TOEFL-style
independent essay collected with the writer's consent in Osaka, and an Erasmus
application statement from Coimbra. All human, all written in English by
second-language writers.

Three documents per detector is far too few to characterise a tool's behaviour
toward second-language writers in general — one document is 33 points. What it
does establish is that this failure mode is not universal: two of five detectors
handled the same three documents without incident, so it is a property of
particular systems rather than an unavoidable limit of detection.

### The same three tools fail the same way elsewhere

ZeroGPT and Pangram also flagged every grammar-corrected, short-form and
template-structured document. Between them: running a grammar checker over your
own prose, writing something short, or writing to your employer's template was
each sufficient to be accused, three times out of three.

Copyleaks and Winston were near-clean across the whole stress corpus — one flag
between them, on a template-structured document.

Nothing flagged pre-1930 prose. Carlyle, Ruskin and an Abigail Adams letter
transcription passed all five.

### Confusion matrices

Positive = AI or hybrid ≥50% AI. Negative = human, stress, or hybrid <50%.

| Detector | TP | FP | TN | FN | FPR | F1 |
|---|---:|---:|---:|---:|---:|---:|
| Winston AI | 31 | 2 | 47 | 11 | 4.1% | 0.827 |
| Copyleaks | 35 | 5 | 44 | 7 | 10.2% | 0.854 |
| GPTZero | 36 | 7 | 42 | 6 | 14.3% | 0.847 |
| Pangram | 29 | 15 | 34 | 13 | 30.6% | 0.674 |
| ZeroGPT | 32 | 17 | 32 | 10 | 34.7% | 0.703 |

Winston is the most conservative tool here — fewest false positives, most missed
positives. GPTZero is the most aggressive of the top three. ZeroGPT flags
roughly one negative document in three.

---

## 3. Consistency

Same text, same detector, two days apart. Mean absolute drift:

| Detector | Mean drift | Consistency score |
|---|---:|---:|
| Copyleaks | 11.2 pts | 68.0% |
| Winston AI | 10.5 pts | 61.4% |
| GPTZero | 10.0 pts | 61.2% |
| ZeroGPT | 11.1 pts | 54.7% |
| Pangram | 20.1 pts | 44.6% |

Four of the five drift by a similar 10–11 points between passes, so the spread in
the consistency score comes mostly from its other half: evenness across genres.
Copyleaks scores highest despite drifting slightly more than Winston or GPTZero,
because it is the most uniform across the seven genres.

**Pangram drifted 20.1 points between passes** — roughly double everything else.
For a tool used in decisions about individuals, a document that reads one way on
one day and another two days later is a problem prior to any accuracy question.

### Evenness across genres (balanced accuracy)

| Detector | Weakest genre | Score there |
|---|---|---:|
| Copyleaks | fiction | 0.875 |
| Winston AI | fiction | 0.750 |
| GPTZero | fiction | 0.750 |
| ZeroGPT | fiction | 0.625 |
| Pangram | fiction | 0.625 |

**Creative fiction is the weakest genre for all five detectors**, without
exception. Literary prose — Le Guin, Cather, Saunders on the human side; model
short-story openings on the other — is where every tool on this table is least
reliable. That is a cleaner cross-detector pattern than anything in the
composite ranking.

---

## 4. Errors

Six unanswered scans of 910. Every detector answered at least 180 of 182, so no
detector took an error penalty.

| Detector | Text | Pass |
|---|---|---|
| Copyleaks | C033 | 1 |
| GPTZero | C087 | 1 |
| Pangram | C019 | 2 |
| Winston AI | C047 | 2 |
| ZeroGPT | C086, C087 | — |

C087 went unanswered by both GPTZero and ZeroGPT — the two refusals landing on
the same document, which is what a length floor doing its job looks like.

---

## Caveats

- **The source texts are not published.** Ground truth comes from the
  maintainer's logs, cross-checked for agreement across all five files. That
  catches transcription drift, not a mislabelled document.
- **Two batches of run logs were supplied for the same scans**, disagreeing on
  90 of Winston's 91 readings and producing near-inverted rankings. This cycle
  uses the second; the first is in
  [`superseded/`](../data/cycles/2026-08/superseded/). The maintainer attests
  the first was a faulty run. Nothing else in this repository distinguishes
  them.
- **n = 21–28 per class, 3 per stress profile.** One document is worth 3–5
  points on a class rate and 33 points on a profile rate. Profile-level results
  indicate direction, not magnitude.
- **No commit–reveal**, so the anti-cherry-picking property this repository
  implements for generated corpora does not apply here.
- **Originality.ai omitted** — measured in the first batch only.
- **English only**, single point in time, versions as recorded above.
