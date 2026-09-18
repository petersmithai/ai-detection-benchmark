# Running a cycle

A full cycle is seven commands and roughly a day of wall-clock time, most of it
spent on the three detectors that have to be read by hand.

## 0. Setup

```bash
npm install
cp .env.example .env      # fill in only the keys you hold a licence for
```

Detectors with no key configured record their samples as errors rather than
silently disappearing from the leaderboard. That is deliberate: a row with a 100%
error rate and a zero score is an honest statement that the tool was not
measured, and it is visible. If you are running a partial cycle, remove the
unmeasured detectors from `detectors/registry.json` for that cycle instead, and
say so in the cycle notes.

## 1. Open the cycle — publish the commitment

```bash
npm run commit-cycle -- --cycle 2026-10
```

Draws a 32-byte nonce, writes it to `.cycle-secrets/2026-10.nonce` (git-ignored),
and commits **only its SHA-256** plus hashes of the templates, banks, manifests
and registry. Copies the frozen `scoring.js` and `select-placeholders.js` forward
from the previous cycle.

**Commit and push `data/cycles/2026-10/commit.json` now, before doing anything
else.** The commitment is worthless if it is published at the same time as the
results.

Then write `data/cycles/2026-10/generators.json`, pinning exact model ids:

```json
{
  "generators": [
    { "slug": "gen-a", "provider": "openai", "model": "<exact model id>", "keyEnv": "OPENAI_API_KEY", "maxTokens": 700 },
    { "slug": "gen-b", "provider": "anthropic", "model": "<exact model id>", "keyEnv": "ANTHROPIC_API_KEY", "maxTokens": 700 },
    { "slug": "gen-c", "provider": "google", "model": "<exact model id>", "keyEnv": "GOOGLE_API_KEY", "maxTokens": 700 },
    { "slug": "gen-d", "provider": "openai-compatible", "model": "<exact model id>", "keyEnv": "TOGETHER_API_KEY", "baseUrl": "https://api.together.xyz/v1", "maxTokens": 700 }
  ]
}
```

## 2. Reveal — resolve the prompts

```bash
npm run commit-cycle -- --cycle 2026-10 --reveal
```

Publishes `nonce.txt` and derives `prompts.json`: 7 templates × 4 variants = 28
prompts, generators assigned round-robin so each generator appears in every
domain.

## 3. Generate the AI corpus

```bash
npm run generate-ai -- --cycle 2026-10
```

Writes `datasets/ai/texts/<id>.txt`. Existing files are skipped; `--force`
regenerates. Anything under 120 words is flagged — regenerate rather than accept
it, since a short sample is a length test dressed up as a detection test.

## 4. Fetch the human and false-positive sources

Not automated, and it should not be. Each entry in
`datasets/human/manifest.json` and `datasets/false-positive/manifest.json` names
a source, a URL, a span and a licence. Fetch each one, extract the span as plain
text, and save it to:

```
datasets/human/texts/<id>.txt
datasets/false-positive/texts/<id>.txt
```

Several sources need a registration or a bulk download (the FCE corpus, the
Stack Exchange dumps, Lang-8). Two entries are `languagetool-full` transforms and
need a local LanguageTool server; the rest of the derived entries are built for
you in the next step.

`npm run build-corpus` lists exactly which files are missing and where each one
belongs, so run it early and treat the output as a checklist.

Source texts are never committed. The repository ships pointers, spans and
SHA-256 hashes; you fetch the originals under their own licences and the hashes
prove you fetched the same bytes we scored.

## 5. Build the corpus

```bash
npm run build-corpus -- --cycle 2026-10
```

Normalises every text, applies the derived transforms, splices the 21 hybrids to
their target ratios, and writes `samples.json` — metadata and a hash per sample,
no text. A hybrid that misses its ratio by more than ±0.04 is reported; fix the
source lengths rather than widening the tolerance.

## 6. Collect readings

```bash
npm run run-detectors -- --cycle 2026-10
```

Two passes over every API detector. Every text is hash-checked against
`samples.json` before it is sent, so a corpus that drifted after the cycle was
committed cannot quietly produce numbers. Results are written after each reading,
so an interrupted run resumes rather than re-paying for every call.

**Run the second pass on a different day.** The script will happily do both back
to back, and if you let it, the consistency metric measures nothing. Run
`--runs 1` twice, separated by at least a few hours.

### Manual detectors

QuillBot, Scribbr and BrandWell have no public API. The protocol:

- Two operators work **independently**, without seeing each other's readings.
- Each pastes every sample into the web UI and records the reported AI
  percentage.
- Operator 1's readings are run 1; operator 2's are run 2.
- Where the two disagree by more than 10 points, a third operator reads it and
  the outlier is replaced — record this in the cycle notes.
- A tool that refuses a sample gets `refused`, not a guess.

Record readings in `data/cycles/2026-10/manual/<slug>.csv`:

```csv
sampleId,run,aiProbability,operator,collectedAt
hum-acad-01,1,4,alice,2026-10-04T09:12:00Z
hum-acad-01,2,7,ben,2026-10-04T15:40:00Z
fp-esl-01,1,refused,alice,2026-10-04T09:15:00Z
```

Then:

```bash
npm run import-manual -- --cycle 2026-10
```

It rejects unknown sample ids, duplicate rows, and out-of-range values, and tells
you which readings are still missing.

## 7. Score, verify, publish

```bash
npm run score  -- --cycle 2026-10
npm run verify -- 2026-10
```

`score` writes `leaderboard.json`, updates each detector's history in
`data/detectors/`, and writes the `cycle.json` manifest of file hashes. `verify`
must pass all eight checks before anything is published.

Then update the README table, add a CHANGES.md entry for anything that moved in
the methodology, and commit — including `nonce.txt`, which is what makes the
commitment from step 1 checkable.

## Cost

Roughly 91 samples × 2 passes × 9 API detectors ≈ 1,640 calls per cycle, at
250–300 words each. On the plans named in the registry that has run to well under
$100 per cycle. The manual tools cost time instead: budget about four hours per
operator.
