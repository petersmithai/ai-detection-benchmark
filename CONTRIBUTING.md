# Contributing

## Reporting a wrong number

The most valuable contribution. Open an issue with:

- the cycle and the detector,
- the sample id,
- the reading you got, with a date and the plan you were on.

## Proposing a detector

Open an issue with the tool, its pricing page, and its API documentation. The
bar for inclusion is:

1. **Purchasable independently.** If a benchmark reader cannot buy access and
   reproduce the result, it does not go in the registry — this is why Turnitin is
   excluded despite being the most consequential detector in education.
2. **A comparable output.** A numeric AI probability or a documented band, at a
   documented threshold. A traffic light with no number cannot be scored on the
   same axis as the rest.
3. **Stable enough to re-test.** A tool that changes its API between cycles can
   be included, but its history has to record the change.

No-API tools are includable through the manual path, which costs an operator
several hours per cycle — say so in the issue if you are volunteering.

## Vendors

You are welcome here, and there is one rule: no preferential access. Nobody sees
results before publication, nobody receives the corpus in advance, and nothing is
changed on request without a public record of what changed and why.

If you believe a cycle got your product wrong, the useful form of a dispute is a
re-run. Everything you need is in this repository: the prompts, the manifests,
the thresholds, the scoring code. If your re-run disagrees with ours, that is a
finding and it will be published as one.

## Code

```bash
npm install
npm run typecheck
npm run smoke-test      # exercises the full pipeline offline
npm run verify          # must pass all eight checks
```

Two rules that matter more than style:

- **Never edit a published cycle's `scoring.js` or `select-placeholders.js` in
  place.** They are frozen copies, not shared modules. A methodology change adds
  `methodology/vN+1` and an entry in `CHANGES.md`. If a published cycle is
  re-scored under a new version — as 2026-08 was on 2026-09-03 — the cycle's copy
  is replaced wholesale, `commit.json` records the re-scoring, and `CHANGES.md`
  carries both the old and new tables. Never silently.
- **Keep `scoring.js` pure.** No I/O, no clock, no randomness, no dependencies.
  If it cannot be re-run offline by a stranger in five years, verification is
  theatre.
