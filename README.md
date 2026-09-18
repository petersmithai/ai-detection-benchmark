# AI Detection Benchmark

An independent benchmark for AI content detectors.

91 texts, read twice each, across four classes: machine-written, human-written,
spliced hybrids at known ratios, and human writing chosen because it is the kind
that gets people falsely accused. Every reading, every scoring rule and the code
that turns them into a ranking is published here — so if you disagree with the
result, you can re-derive it, change a weight, and see exactly how much your
disagreement is worth.

Most detector comparisons test one thing: does the tool catch ChatGPT output.
That is the easy half, and on this corpus every tool tested passes it. The
interesting failures are elsewhere.

## Best AI Detector for September 2026

| # | Detector | Score | AI recall | Human cleared | FP resistance | Hybrid accuracy | Consistency |
|---|----------|------:|----------:|--------------:|--------------:|----------------:|------------:|
| 1 | **Winston AI** | **91.70** | 92.9% | 100.0% | 100.0% | 79.9% | 61.4% |
| 2 | Copyleaks | 91.38 | 96.4% | 100.0% | 95.2% | 79.7% | 68.0% |
| 3 | GPTZero | 85.40 | 92.9% | 100.0% | 81.0% | 82.5% | 61.2% |
| 4 | ZeroGPT | 65.78 | 89.3% | 100.0% | 38.1% | 80.8% | 54.7% |
| 5 | Pangram | 61.01 | 78.6% | 100.0% | 33.3% | 81.2% | 44.6% |


Cycle `2026-08` · 910 readings · 91 texts · scanned in two passes on **26–27 and
28–29 August 2026**, published September 2026 · versions Copyleaks 2026.08,
Winston v4.15, GPTZero 4.9b, ZeroGPT DeepAnalyse, Pangram 4.0

Detectors are updated silently and often. These are the versions listed above as
they behaved in late August; a tool may score differently today.

Full per-sample data: [`data/cycles/2026-08/`](data/cycles/2026-08/).
Detailed analysis: **[docs/RESULTS-2026-08.md](docs/RESULTS-2026-08.md)**.

**Every detector cleared all 21 clean-human documents.** Ordinary published
prose — Le Guin, Cather, Reuters, Vox, PostgreSQL docs — was never flagged by
anything. The whole spread on this table comes from the stress corpus and from
AI recall, which is the argument for testing both.

### The finding that matters most: nobody measures *how much*

Every one of these tools reports a percentage. None tracks the actual proportion
of machine text in a document.

Mean reported AI score against true AI content:

| True AI content | Copyleaks | Winston AI | GPTZero | ZeroGPT | Pangram |
|---|---|---|---|---|---|
| **25%** | 50.4 | 40.5 | 40.6 | 45.5 | 33.7 |
| **50%** | 50.5 | 34.9 | 52.5 | 47.3 | 45.2 |
| **75%** | 58.4 | 55.2 | 62.2 | 53.9 | 49.6 |
| **25% → 75% change** | **+8.0** | **+14.7** | **+21.6** | **+8.4** | **+15.9** |

Ground truth moves 50 points. The best-tracking tool here moves 21.6, the worst
8.0, and Winston's 50% band reads *lower* than its 25% band. Mean absolute error
runs 17–20 points across all five.

If you are using one of these numbers to decide how much of an essay a student
wrote, the number does not contain that information. It answers whether machine
text is present, not how much.

### Where the false positives are

All 21 stress documents are human-written. Flags out of 3 per profile:

| Profile | Copyleaks | Winston AI | GPTZero | ZeroGPT | Pangram |
|---|---|---|---|---|---|
| Second-language (ESL) | 0 | 0 | **3** | **3** | **3** |
| Grammar-corrected | 0 | 0 | 0 | **3** | **3** |
| Short-form (60–130 words) | 0 | 0 | 1 | **3** | **3** |
| Template-structured | 1 | 0 | 0 | **3** | **3** |
| Technical / formulaic | 0 | 0 | 0 | 1 | 1 |
| Translated | 0 | 0 | 0 | 0 | 1 |
| Archaic (pre-1930) | 0 | 0 | 0 | 0 | 0 |

**Three of five detectors flagged every single second-language document.**
Placement and application essays from Helsinki, Osaka and Coimbra — three for
three, on GPTZero, ZeroGPT and Pangram. Copyleaks and Winston cleared all of
them. This is the sharpest split on the whole table, and it is the one with
consequences for real people.

The same three tools also flagged every grammar-corrected, short-form and
templated document. Running a grammar checker over your own writing, or writing
to your employer's template, was enough to be accused by all three.

Nothing flagged pre-1930 prose. Carlyle, Ruskin and an Abigail Adams letter
passed everything.

### Read the intervals before the ranks

With 21–28 samples per class, one document moves a rate by 3–5 points. The 95%
confidence interval on false-positive resistance is 84.5–100% for Winston and
77.3–99.2% for Copyleaks — overlapping, so **ranks 1 and 2 are not
distinguishable.** They are 0.32 points apart, and they swap places depending on
the weighting: Copyleaks led under v1, Winston leads under v2. ZeroGPT and Pangram are clearly separated from the top three
and not from each other. Every rate metric ships with its interval in
`leaderboard.json`.

## What was tested

| Class | n | What it is |
|-------|--:|------------|
| **AI** | 28 | GPT-4o, Claude 4 Sonnet, Gemini 2.0 Flash and Llama 3.3 70B — 7 per model, one per genre |
| **Human** | 21 | Published human writing: Le Guin, Cather, Saunders, Dewey, William James, Reuters, NYT, Vox, Bloomberg, PostgreSQL and AWS docs |
| **Hybrid** | 21 | Human drafts spliced with model text at 25 / 50 / 75% by word count |
| **False-positive stress** | 21 | Seven high-risk profiles × 3: ESL, translated, template-structured, technical, grammar-heavy, short-form, archaic |

Seven genres — academic, news, blog, fiction, business, marketing, technical —
at 60 to 985 words. Full inventory in
[`data/cycles/2026-08/samples.json`](data/cycles/2026-08/samples.json), with the
raw vendor logs (score field, displayed label, on-screen explanation, timestamps,
presentation order) preserved verbatim in
[`run-logs/`](data/cycles/2026-08/run-logs/).

Each detector is scored at **its own vendor's documented threshold**. Winston
reports human-likeness where others report AI probability, and Copyleaks and
Originality report 0–100 where GPTZero and Pangram report 0–1; every reading is
normalised onto one axis at ingest, from the scale each log declares.

## How the score is built

| Component | Weight |
|-----------|-------:|
| AI recall | 20 |
| Human specificity | 20 |
| False-positive resistance | 35 |
| Hybrid accuracy | 15 |
| Consistency (repeat-run stability + evenness across genres) | 10 |

Penalties, capped at 10: unanswered samples, and hard fails where any of the
first three metrics falls below 50%.

**Why not-accusing outweighs catching, 55 points to 20.** A missed AI essay costs
a grade boundary and is recoverable. A false accusation costs a person a
disciplinary hearing they cannot win, because no evidence proves you wrote
something yourself. That is a values judgement, stated in the open — and
`scoring.js` is one dependency-free file you can edit and re-run in under a
second. Full rationale: **[METHODOLOGY.md](METHODOLOGY.md)**.

## Limitations of this cycle

Stated up front rather than buried, because they bound what these numbers mean.

- **The 91 source texts are not published.** The maintainer supplied run logs,
  not documents. `samples.json` records `"sha256": "not-supplied"`, so nobody —
  including this repository — can independently confirm which texts were
  scanned. Ground truth is cross-checked for agreement across all five vendor
  logs, which catches transcription drift but not a mislabelled document.
- **Two batches of run logs were supplied for the same scans.** They disagree on
  90 of Winston's 91 readings and produce near-inverted rankings. The maintainer
  attests that the first batch was a faulty run and the second is the record;
  this table is derived from the second. The first is retained in
  [`superseded/`](data/cycles/2026-08/superseded/) so a reader can see both.
  Nothing in this repository distinguishes them beyond that attestation, and
  `commit.json` says so.
- **No commit–reveal.** The corpus was assembled and scanned by the maintainer
  directly, so the prompt-commitment scheme this repo implements does not apply.
  Verification skips those two checks and says so.
- **Five detectors of thirteen registered.** Originality.ai was measured in the
  first batch only and is omitted rather than compared against readings from a
  different batch. Sapling, Undetectable.ai, Smodin, Isgen, QuillBot, Scribbr and
  BrandWell were not run.
- **English only, one point in time.** Detectors change silently. ZeroGPT's log
  records `DeepAnalyse`, a mode rather than a version.

**Pangram note.** Pangram was excluded when this benchmark was scoped, at the
maintainer's request, and is on the table because a full run log was
subsequently supplied for it. Both facts are in
[`detectors/registry.json`](detectors/registry.json).

## Verify it

```bash
npm install
npm run verify -- 2026-08
```

Seven assertions: hybrid ratios are exactly 25/50/75, AI fraction agrees with
declared class on every sample, all four classes present, no duplicate ids, every
file hashes as published, no untracked files, and — the important one — the
cycle's own frozen `scoring.js` re-derives `leaderboard.json` byte for byte from
the raw readings.

Edit any published number by hand and two checks fail independently. Details:
**[docs/VERIFICATION.md](docs/VERIFICATION.md)**.

## Running your own cycle

The repository also implements a commit–reveal corpus scheme for cycles built
from scratch: prompts are a pure function of a nonce whose hash is published
before any text exists, so the prompt set cannot be chosen to suit a result.
Cycle 2026-08 did not use it. See **[docs/RUNNING.md](docs/RUNNING.md)** and
**[docs/START-HERE.md](docs/START-HERE.md)**.

`npm run smoke-test` exercises the whole pipeline offline against fabricated
input, in a git-ignored scratch directory that never touches the detector
histories.

## No affiliate relationships

No vendor paid for placement, previewed results, or received the corpus in
advance. There are no affiliate links in this repository, and there will not be —
the moment a ranking earns a commission it stops being a benchmark.

## Corrections

Open an issue with the cycle, the text id and the reading you got. Vendors are
welcome to dispute results; the useful form of a dispute is a re-run.

## Licence

Code: [MIT](LICENSE). Cycle data and results: [CC BY 4.0](LICENSE-data). Source
texts are not redistributed.
