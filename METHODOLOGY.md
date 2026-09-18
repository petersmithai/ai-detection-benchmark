# Methodology

Everything here is a choice, and every choice could have been made differently.
This document states each one and the reasoning behind it, so that disagreeing
with the leaderboard can be a technical argument rather than a matter of trust.

---

## 1. The question this benchmark asks

> Given a piece of writing, does this detector reach the right conclusion — and
> when it is wrong, who pays?

Most published detector comparisons answer only the first half, on the easiest
possible input: unedited output from one model, prompted plainly. Reported
accuracies of 99% come from that setup, and they do not survive contact with the
documents people actually submit — drafts a person edited, essays written in a
second language, lab reports written to a departmental template.

So the corpus is built around four classes, and the weighting is built around the
asymmetry of the two error types.

## 2. Corpus construction

### 2.1 Human text: provenance by date, not by declaration

Every human sample is drawn from a document published, archived or
corpus-released **before 2021-01-01**.

The alternative — commissioning people to write for the benchmark — fails twice
over. Text written by someone who knows a detector will read it is not ordinary
writing; it is performed writing, and it is performed in the direction the writer
guesses will pass. And there is no way to prove to a reader that a commissioned
sample was not quietly drafted with a model. A timestamp in a public archive
proves what no declaration can.

Sources: Enron email (2001), Blog Authorship Corpus (2004), Stack Exchange dumps,
PubMed Central open access, arXiv, NASA NTRS, NIST SP, PostgreSQL 12 docs,
Wikinews, WritingPrompts (2018), Standard Ebooks. Full list with URLs, spans and
licences: [`datasets/human/manifest.json`](datasets/human/manifest.json).

**Known limitation.** Pre-2021 text is not the same distribution as 2026 human
writing. Register, topic and platform conventions have all moved. This buys
provenance at the cost of recency, and the cost is real: a detector tuned on
contemporary prose may be mildly disadvantaged. There is no way to have both, and
of the two, unfalsifiable provenance is the worse failure.

### 2.2 AI text: plain prompts only

Prompts are what an ordinary user writes. No template contains an instruction to
sound human, vary sentence length, or lower perplexity, and no system prompt is
used. Generators run at their documented default sampling settings.

Adding "write naturally" would benchmark prompt engineering rather than
detection, and would put the result at the mercy of one prompt-writer's skill.
Adversarial text — humanizer output, paraphrase attacks, deliberate perturbation
— is a genuinely important and genuinely different question, and it is
**explicitly out of scope for cycle 1**. See §7.

Exact model ids are pinned per cycle in `generators.json` and recorded in
`cycle.json`. Detectors are retrained against new model generations constantly;
a detection score with no generator provenance ages into meaninglessness within
months.

Model output is stripped of chat framing — a leading title, "Sure, here's…", a
trailing "Let me know if you'd like me to revise". Those are artefacts of the
chat interface, not properties of the prose, and leaving them in would hand every
detector a free signal that has nothing to do with writing. The strip is a single
documented function in `scripts/generate-ai-corpus.ts`.

### 2.3 Hybrid text: exact ground truth by construction

Each hybrid is built from one human and one AI sample in the same domain,
spliced at sentence boundaries under one of three modes:

- **human-draft-ai-expanded** — human open and close, contiguous AI block inserted
- **ai-draft-human-edited** — AI throughout, contiguous human run replacing part
- **alternating** — sentence-level interleave (hardest, least common in the wild)

Because the splice is mechanical, `aiFraction` is a word count, not an estimate.
Sentence-level provenance is recorded per sample, so sentence-granular detectors
can also be scored on *localisation* — not just "how much" but "which parts".

**The seams are not smoothed.** Writing transition sentences would mean
introducing text of unknown provenance into a ground-truth corpus, which defeats
the purpose. This makes the splices visible to a careful human reader. That is
the honest version of the test: a detector with sentence-level output that still
cannot localise a visible seam does not have localisation.

### 2.4 False-positive stress: the corpus that matters most

Seven profiles, three samples each, all human, all under the same pre-2021 rule:

| Profile | Why it is here |
|---------|----------------|
| `esl-nonnative` | The largest documented source of real false accusations |
| `translated` | Human-written, human-translated; reads "flattened" for the same reasons |
| `template-structured` | Institutional templates — five-paragraph essays, incident reports |
| `technical-formulaic` | Standards and specification prose: low burstiness by professional necessity |
| `grammar-corrected` | Does cleaning up your text get you accused? |
| `short-form` | 60–110 words: below most calibration, well inside what tools will score |
| `archival-formal` | Pre-1930 prose: far from contemporary register in a direction that is not "machine" |

Three profiles are derived transforms of listed human sources rather than
separate documents. The transform is deterministic and specified in the manifest;
it edits a human original and never introduces generated text.

## 3. Measurement protocol

- **Two passes, separated in time**, not two back-to-back calls. A detector that
  answers 71 and then 44 on the same paragraph an hour later has told you
  something a single reading hides. The gap between passes feeds the consistency
  metric.
- **Vendor's own threshold**, frozen at cycle open and recorded in the registry.
  Re-tuning each detector's threshold to its own optimum would measure the model;
  using the vendor's threshold measures the product, which is what users meet.
- **One axis.** Winston reports human-likeness, several vendors report 0–1.
  All are normalised to a 0–100 AI probability in one exported function, because
  inverting one detector by accident would silently invert its entire scorecard.
- **Vendor minimums respected.** Where a vendor documents a length floor, samples
  below it are not sent. They still count as unanswered, which is the honest cost
  of that floor.
- **Failures are data.** A timeout, a refusal or a malformed response is recorded
  as a reading with an error, not dropped. A detector that cannot answer has told
  you something about itself.
- **Manual tools.** Three detectors have no public API. Two operators read each
  sample independently in the web UI; both readings are imported as run 1 and
  run 2. For these tools the consistency metric therefore measures
  inter-operator agreement rather than repeat-call stability. That is a real
  difference in what the number means and it is stated on the row rather than
  smoothed over.

## 4. Scoring

```
composite = 30·aiRecall + 25·humanSpecificity + 20·fpResistance
          + 15·hybridAccuracy + 10·consistency − penalties
```

**The 45–30 split between not-accusing and catching is the central judgement in
this benchmark.** The two error types are not symmetric in consequence. A missed
AI essay costs a grade boundary and is recoverable. A false accusation costs a
person a disciplinary process they cannot win, because no evidence exists that
proves you wrote something yourself — the accused cannot produce the absence of a
model. Where the harms are asymmetric, a scoring function that treats the errors
symmetrically is making a claim, not staying neutral.

If you weigh them differently, edit `WEIGHTS` in the cycle's `scoring.js` and
re-run `npm run score`. The whole leaderboard re-derives in under a second. That
is the intended way to disagree.

**Consistency** is half repeat-run stability (mean absolute drift between passes,
saturating at 25 points) and half cross-domain evenness (standard deviation of
per-domain balanced accuracy, saturating at 0.25). A tool that is excellent on
blogs and useless on academic writing scores worse than its average suggests,
because users do not get to pick which domain their document is in.

**Penalties**, capped at 10: unanswered samples at 12× the error rate (max 6),
and hard fails — any of the three rate metrics below 50% — at 3 points each
(max 6). A detector below 50% on a class is not a weak detector for that class;
it is worse than a coin, and the composite should say so.

## 5. What the numbers cannot tell you

- **Small N.** 21–28 samples per class. One sample moves a rate by 3–5 points.
  Wilson 95% intervals are reported next to every rate metric, and adjacent rows
  are frequently not distinguishable. A rank is not a finding; an interval that
  clears another interval is.
- **English only.** Several vendors market multilingual detection. None of it is
  tested here.
- **One threshold per detector.** No ROC curve, no AUC. The benchmark measures
  the product as shipped, which means a detector with a better-separated score
  distribution but a badly chosen default threshold will look worse here than it
  is. The per-sample probabilities are published, so anyone can compute the ROC
  themselves.
- **A point in time.** Detectors are updated silently and often. A cycle
  describes the products in the month it ran, against the generator versions
  pinned in its `cycle.json`. This is why the trend lines in `data/detectors/`
  matter more than any single cycle.
- **Commit–reveal has a specific scope.** It prevents the maintainer choosing
  prompts to suit a result. It does not prevent a vendor tuning against a
  published corpus. Banks are re-drawn each cycle to raise that cost; nothing
  eliminates it.

## 6. Conflicts of interest

No vendor paid for placement, previewed results, or received the corpus in
advance. API access is purchased at list price on the plans named in the
registry. There are no affiliate links in this repository. If that ever changes,
it will be declared here first and in the same commit.

## 7. Roadmap

Deliberately not in cycle 1, and why:

- **Adversarial / humanizer-processed text.** The most commercially important
  question in detection and a benchmark in its own right — it needs its own
  corpus, its own tool list and its own weighting, and folding it into a
  general-accuracy score would blur both.
- **Multilingual.** Requires native-speaker provenance review per language;
  doing it badly would be worse than not doing it.
- **Sentence-level localisation scoring.** The ground truth already exists in
  every hybrid sample's `provenance` array. The metric does not yet, and adding
  a metric mid-line without a cycle of data behind it would be guesswork.
- **Cost per correct decision.** Pricing is in the registry but not scored.
