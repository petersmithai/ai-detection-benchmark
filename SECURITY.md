# Security

## Reporting

Open a private security advisory through GitHub's "Report a vulnerability" flow
on this repository. Target response: five working days.

## What counts as a vulnerability here

This repository publishes data, not a service, so the interesting failures are
integrity failures rather than exploitation ones:

- **A way to forge a cycle that passes `npm run verify`.** The highest-severity
  class. If a leaderboard can be edited while all eight checks still pass, the
  verification story is broken and everything published under it is in question.
- **A bias in placeholder selection.** `select-placeholders.js` uses rejection
  sampling to avoid modulo bias. A demonstrated non-uniformity, or any way to
  steer selection without changing the nonce, is a real finding.
- **A defect in `scoring.js` that changes rankings** — a rounding path that
  depends on platform, an ordering that depends on object iteration, anything
  that makes the replay check pass on one machine and fail on another.
- **Credential handling in the runner.** Keys are read from the environment and
  should appear in no output file. A path where one reaches
  `detector-results.json`, a log line, or a committed artefact is a vulnerability.

## Not in scope

- Disagreement with the weights. That is a methodology argument — see
  [CONTRIBUTING.md](CONTRIBUTING.md), and note that you can re-run the scoring
  with your own weights in one command.
- Vulnerabilities in the vendors' own products. Report those to the vendors.
- The fact that a vendor could tune against a published corpus. That is a
  documented and unavoidable limitation of any public benchmark, discussed in
  [METHODOLOGY.md](METHODOLOGY.md) §5.

## Handling of credentials

`.env` and `.cycle-secrets/` are git-ignored. Cycle nonces are held privately
between a cycle opening and its reveal, and published in full at cycle close —
that publication is the point of the scheme, not a leak.
