# Disputed input

`revised-summary-2026-09-03.csv` is a per-detector summary the maintainer
supplied on 2026-09-03, described as correcting an error in the earlier
analysis. It is kept here as a record. It is **not** used to produce any
published number, for three reasons.

**1. It is a summary, not readings.** This repository's central claim is that
the leaderboard re-derives from raw per-sample readings, and that
`npm run verify` fails if any published figure was edited by hand. Substituting
pre-computed rates would remove exactly that property: nothing downstream could
be checked against anything.

**2. It disagrees with the run logs, irreconcilably.** Comparing against
`../run-logs/`:

| Detector | Recall (logs → revision) | Human specificity | Stress FPR |
|---|---|---|---|
| Pangram | 100.0% → 78.6% | 100.0% → 66.7% | 0.0% → 66.7% |
| Winston AI | 96.4% → 92.9% | 100.0% → 100.0% | 23.8% → 0.0% |
| Copyleaks | 85.7% → 96.4% | 95.2% → 97.6% | 23.8% → 4.8% |
| GPTZero | 92.9% → 92.9% | 100.0% → 90.5% | 4.8% → 19.1% |
| Originality.ai | 96.4% → 92.9% | 95.2% → 92.9% | 14.3% → 14.3% |

A different decision threshold cannot explain this. Sweeping every threshold
from 1 to 99 over the committed Pangram readings, the closest reachable point to
the revision's (78.6% recall, 66.7% specificity) is (100%, 71.4%) — and at that
threshold the stress false-positive rate is 90.5%, not 66.7%. Moving a threshold
trades recall against specificity; it cannot lower both at once, which is what
the revision requires.

**3. Four of its nine detectors have no run log here.** Scribbr, ZeroGPT,
Sapling and QuillBot appear in the summary with full statistics, but no raw
readings for them were ever supplied.

## Two figures that cannot mean what they say at this sample size

Recorded because they would mislead a reader who took them at face value, and
because they are worth fixing in whatever pipeline produced them.

- **`tpr_at_fpr_0.1pct`, `tpr_at_fpr_0.5pct` and `tpr_at_fpr_1pct` are identical
  for every detector in the file, and could not be otherwise.** The corpus has
  42 human-class documents. The smallest false-positive rate distinguishable
  from zero is 1/42 ≈ 2.4%. Operating points at 0.1%, 0.5% and 1% FPR are all
  the same point — the one where nothing is flagged — so these columns carry one
  number between them, not three.
- **`fpr_esl` is computed over three documents.** It can only take the values
  0.00, 0.33, 0.67 or 1.00, and one document moves it by 33 points. A reported
  `fpr_esl` of 1.0 means three documents were flagged, not that the detector
  fails on second-language writing generally.

## What would resolve this

Corrected **raw run logs** in the same long format as `../run-logs/` — one row
per text per pass, carrying each vendor's own score field. Everything
re-derives from those automatically, and the audit works again. If instead the
correction is a change to the decision thresholds or to the scoring rules, name
the change and it can be applied to the existing readings, which is a smaller
and fully checkable edit.
