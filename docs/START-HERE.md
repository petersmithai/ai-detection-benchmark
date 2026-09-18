# Start here — what you need to run cycle 1

The code is finished. What is missing is the two things no script can produce:
**source texts** and **detector readings**. This is the shortest honest path to
both.

---

## The three things you need

### 1. Money — $0 or about $40

| | Tools | Cost |
|---|---|---|
| **Free path** | ZeroGPT, Sapling, Copyleaks, QuillBot, Scribbr, BrandWell | $0 |
| **Recommended** | the six above **+ Winston AI + Originality.ai** | ~$40 for one month, then cancel |

Winston and Originality have no free tier that covers 45,500 words. Your
benchmark is built around Winston being the headline — a detection benchmark
without Winston is a strange benchmark — so the $40 is the difference between
cycle 1 being the thing you wanted and cycle 1 being a partial.

GPTZero gives 10,000 free words/month, which is about 40 samples. Either spread
it across three months or pay $14.99 for one month.

### 2. Six downloads — the part only you can do

Five of the corpus sources need an account or a bulk download. Everything else
I can fetch.

| Source | What it's for | How to get it | Gate |
|---|---|---|---|
| [Enron email corpus](https://www.cs.cmu.edu/~enron/) | 3 human business emails | 423MB tarball, direct | None, just big |
| [Blog Authorship Corpus](https://u.cs.biu.ac.il/~koppel/BlogCorpus.htm) | 2 human blog posts | ~300MB zip, direct | None, just big |
| [Europarl v7](https://www.statmt.org/europarl/) | 1 translated sample | Direct download | None, just big |
| [WritingPrompts](https://www.kaggle.com/datasets/ratthachat/writing-prompts) | 2 human fiction | Kaggle | **Free account** |
| [FCE learner corpus](https://ilexir.co.uk/datasets/index.html) | 2 ESL samples | Request form | **Form + wait** |
| [Lang-8](https://sites.google.com/site/naistlang8corpora/) | 1 ESL sample | Application | **Application + wait** |

You need only a handful of documents out of each. Extract the ones named in
`datasets/human/manifest.json` and `datasets/false-positive/manifest.json`, save
as plain text to the path each entry names, done.

**The FCE and Lang-8 gates are the annoying ones**, and they cover the
false-positive profile that matters most — second-language writers, the largest
documented source of real false accusations. Two options:

- **Wait for them.** Most rigorous. Adds days to weeks.
- **Substitute.** I swap in pre-2021 ESL writing archived on university writing
  centre pages via the Wayback Machine — real, dated, fetchable, and documented
  in the manifest as a substitution. Less rigorous than FCE, honest about it,
  and unblocks cycle 1 today.

My recommendation: substitute for cycle 1, apply for FCE in the background, swap
it in for cycle 2 and note the change in `CHANGES.md`.

### 3. Time — about 5 hours of pasting

Per detector collected by hand: 91 samples × 2 passes = 182 paste-and-read
operations, roughly 60 minutes.

**The two passes must be on different days.** Two readings taken back to back
measure nothing; the gap between them is the entire consistency metric.

If 5 hours is too much: **cut detectors, not samples.** 91 samples × 4 tools
beats 40 samples × 12 tools every time. Sample count is what makes any number
mean anything, and a corpus you shrank cannot be un-shrunk later. A detector you
skip is just a column you add in cycle 2.

---

## The steps, and who does each

| # | Step | Who | Command |
|--:|------|-----|---------|
| 1 | Open cycle, publish the commitment | me | `npm run commit-cycle -- --cycle 2026-10` |
| 2 | Get one generator API key (OpenAI, Anthropic or Google) | **you** | put in `.env` |
| 3 | Reveal nonce, resolve the 28 prompts | me | `npm run commit-cycle -- --cycle 2026-10 --reveal` |
| 4 | Generate the 28 AI samples | me | `npm run generate-ai -- --cycle 2026-10` |
| 5 | Fetch ~15 directly available human sources | me | — |
| 6 | Download the 6 gated sources above | **you** | — |
| 7 | Build corpus + splice the 21 hybrids | me | `npm run build-corpus -- --cycle 2026-10` |
| 8 | Sign up for detectors | **you** | keys in `.env` |
| 9 | Collect from API detectors | me | `npm run run-detectors -- --cycle 2026-10` |
| 10 | Generate collection sheets | me | `npm run collection-sheet -- --cycle 2026-10` |
| 11 | Paste and record — pass 1 | **you** | fill `run1` column |
| 12 | Wait a day, repeat — pass 2 | **you** | fill `run2` column |
| 13 | Import, score, verify, publish | me | `npm run import-manual` → `score` → `verify` |

Steps 2, 6, 8, 11 and 12 are yours. Everything else I do.

---

## Collecting readings: the only rules

Sheets land in `data/cycles/2026-10/manual/<detector>.csv`, one per detector,
every sample id pre-filled:

```csv
sampleId,run1,run2,notes
ai-academic-1,,,
hum-acad-01,,,
```

1. **Record the number the tool shows you. Never convert it.** Winston displays
   a *human* score — if it says 98% human, type `98`. The importer inverts it.
   Originality shows 0–1, so type `0.07`. Doing this arithmetic yourself is how
   a detector ends up inverted for an entire cycle.
2. **`refused`** if the tool won't score a sample. Never guess a number.
3. **Blank** means not yet collected. Blanks are skipped, not read as zero.
4. **The sheets hide which samples are AI.** That is deliberate — if you could
   see it, you would re-check surprising readings and not boring ones, which
   biases exactly what this benchmark measures. Work through them blind.
5. **Different days for run1 and run2.** For a tool with no API, ideally two
   different people.

---

## What you can start on right now

1. Kaggle account, FCE request form, Lang-8 application — the ones with waits.
2. Decide: $0 for six tools, or ~$40 for eight including Winston.
3. Get one generator API key so the AI corpus can be built.

Tell me when you have the generator key and I will run steps 1, 3, 4 and 5 in
one go — that produces the AI corpus and most of the human corpus, and puts the
collection sheets in your hands.
