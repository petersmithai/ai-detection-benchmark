# Cycles

One directory per published cycle, named for the month it ran (`2026-10`).
Cycle 1 is in collection; this directory fills as cycles close.

Each cycle directory is self-contained and, once published, immutable:

| File | What it is |
|------|------------|
| `commit.json` | The commitment. Published **before** any prompt exists: `SHA-256(nonce)` plus hashes of the templates, banks, manifests and registry. |
| `nonce.txt` | The nonce, published at cycle close. Anyone can now re-derive the prompts. |
| `generators.json` | Exact provider model ids used to produce the AI corpus. |
| `prompts.json` | The 28 resolved prompts, derived from the nonce. |
| `samples.json` | Ground truth: class, domain, AI fraction, word count and SHA-256 per sample. No text — sources are not redistributed. |
| `detector-results.json` | Every raw reading: detector, sample, run, AI probability, error, latency. |
| `scoring.js` | The scoring logic **frozen at cycle open**, copied from `methodology/vN`. |
| `select-placeholders.js` | The prompt-selection logic, frozen the same way. |
| `leaderboard.json` | The derived result. Reproducible from the four files above. |
| `cycle.json` | SHA-256 of every file in the directory. |
| `manual/*.csv` | Raw readings for the three detectors with no public API. |

A cycle is scored for the rest of its life by the copies of `scoring.js` and
`select-placeholders.js` inside it, never by the current `methodology/`. That is
what makes a published number mean the same thing in five years as it did on the
day it was published.

`npm run verify` re-derives the leaderboard from the frozen logic and checks
every hash. Directories starting with a dot (`.smoke`) are scratch space from
`npm run smoke-test`, are git-ignored, and are never published cycles.
