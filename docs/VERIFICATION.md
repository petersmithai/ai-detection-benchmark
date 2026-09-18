# Verification

The point of this repository is that you do not have to trust it.

```bash
npm install
npm run verify
```

## What each check proves

### 1. Commitment — `SHA-256(nonce) == commit.json.nonceSha256`

`commit.json` is published, committed and pushed **before** any prompt exists.
`nonce.txt` is published at cycle close. Since the prompt set is a pure function
of the nonce and of files whose hashes are also in `commit.json`, a passing check
means the prompts were fixed before any detector was called.

What this rules out: the maintainer running a cycle, disliking the ranking,
re-drawing prompts and publishing the second attempt.

What it does **not** rule out: a vendor tuning against the corpus after
publication. Nothing in a public benchmark can rule that out. Banks are re-drawn
each cycle to raise the cost, and the per-detector trend lines in
`data/detectors/` are the place where a tool that suddenly excels on a stale
corpus would show up.

### 2. Prompt replay

Re-runs the cycle's own `select-placeholders.js` — the copy inside the cycle
directory, not a shared module — against the revealed nonce, and compares to
`prompts.json` with an exact string comparison of the serialised result.

Selection is HMAC-SHA256 with the nonce as key, rejection-sampled over 32-bit
windows to avoid modulo bias, with deterministic linear probing so the four
variants of one template never collide on the same value. Same nonce, same banks,
same prompts, on any machine.

### 3. Ground truth

- Every hybrid's committed `aiFraction` is within ±0.04 of the ratio planned in
  `datasets/hybrid/spec.json`.
- All four sample classes are present and non-empty.
- No duplicate sample ids.

Hybrid ground truth is a word count over a mechanical splice, so this check is
arithmetic rather than judgement.

### 4. Manifest

`cycle.json` lists a SHA-256 for every file in the cycle directory. The check
re-hashes each one and also fails on any file present in the directory but absent
from the manifest — so quietly adding a file is as visible as quietly editing one.

### 5. Score replay

Re-runs the cycle's own `scoring.js` over `samples.json` and
`detector-results.json`, and compares to the published `leaderboard.json`.

`scoring.js` does no I/O, reads no clock, and uses no randomness. Every rounding
step is explicit and rounds half away from zero, so the output does not depend on
float parity or platform.

## Try to break it

You do not need a published cycle to test this. `npm run smoke-test` builds a
complete cycle offline in `data/cycles/.smoke/` — fabricated input, so none of
its numbers mean anything, but the verification machinery is identical. Tamper
with it:

```bash
npm run smoke-test                    # builds and verifies a scratch cycle
$EDITOR data/cycles/.smoke/leaderboard.json   # change any composite score
npm run verify -- .smoke
#   ✗ manifest: 9 files hash as published
#   ✗ score replay: leaderboard re-derives byte for byte
```

Editing a published number fails two checks independently — the manifest hash
and the score replay — and the same is true of any real cycle.

Editing the underlying *reading* instead defeats the score replay — the
leaderboard would legitimately re-derive from the doctored input — but the
manifest catches it, because `detector-results.json` is hashed too. Change any
reading in that file and `npm run verify` reports:

```
  ✗ manifest: 9 files hash as published
```

To forge a cycle convincingly you would have to re-run `score`, which rewrites
the manifest — and then the git history shows a results file changing after
publication, with no corresponding re-run of the detectors. That is the last line
of defence and it is a social one, not a cryptographic one. It is worth being
clear about where the mathematics stops.

## Verifying the corpus itself

`samples.json` carries a SHA-256 per sample, over the normalised text. Fetch any
source from its manifest entry, extract the listed span, run it through
`scripts/lib/text.ts`'s `normalize`, and hash it. If it matches, you have the
exact bytes that were scored.

`run-detectors` performs this check on every sample before sending it, so a cycle
cannot be run against a drifted corpus even by accident.

## Independent re-scoring

You do not have to accept the weights. The scoring function is one file with no
dependencies:

```bash
$EDITOR data/cycles/<cycle>/scoring.js   # change WEIGHTS
npm run score -- --cycle <cycle>
```

The leaderboard re-derives in under a second. If a different weighting produces a
different order, that is worth publishing — open an issue with your weights and
the resulting table.
