# Datasets

Four corpora, 91 samples per cycle.

```
human/manifest.json            21 samples · 7 domains · pre-2021 published writing
ai/templates.json + banks.json 28 samples · 7 domains × 4 generators
hybrid/spec.json               21 samples · 7 domains × 3 ratios
false-positive/manifest.json   21 samples · 7 high-risk profiles
```

## Source texts are not in this repository

Committed here: pointers, spans, licences and SHA-256 hashes.
Not committed: the texts themselves (`datasets/*/texts/`, git-ignored).

Two reasons. Redistributing corpora under a patchwork of research-use and
share-alike licences would be a licensing mess with no upside. And a hash is a
better guarantee than a copy: fetch the source yourself, extract the listed span,
normalise it, and if the hash matches you have the exact bytes that were scored —
which you cannot know from a file we hand you.

`npm run build-corpus -- --cycle <cycle>` prints exactly which files are missing
and where each belongs.

## Human — provenance by date

Every entry is from a document published, archived or corpus-released **before
2021-01-01**. Nothing was written for this benchmark. See
[METHODOLOGY.md §2.1](../METHODOLOGY.md) for why commissioned "human" text is
not a workable alternative.

Domains: academic, blog, business-email, journalism, technical-doc, fiction,
forum — three samples each, 180–320 words.

## AI — plain prompts, pinned generators

`templates.json` holds 7 templates with `{{PLACEHOLDER}}` slots; `banks.json`
holds the values. A cycle's nonce resolves them into 28 prompts via the cycle's
frozen `select-placeholders.js`, so the prompt set is fixed before it is known.

No template instructs a model to sound human, and no system prompt is used.
Exact model ids are pinned per cycle in that cycle's `generators.json`.


## Hybrid — exact ground truth

Built by splicing one human and one AI sample from the same domain at sentence
boundaries, in three modes (`human-draft-ai-expanded`, `ai-draft-human-edited`,
`alternating`) across three ratios (25 / 50 / 75%).

`aiFraction` is a word count over a mechanical splice, not an estimate. Every
sample also carries a sentence-level `provenance` array, so sentence-granular
detectors can be scored on localisation once that metric lands.

Seams are not smoothed — writing transitions would put text of unknown
provenance into a ground-truth corpus.

## False-positive stress — the corpus that matters most

Seven profiles, three samples each, all human, same pre-2021 rule:
`esl-nonnative`, `translated`, `template-structured`, `technical-formulaic`,
`grammar-corrected`, `short-form`, `archival-formal`.

Three entries are deterministic transforms of listed human sources rather than
separate documents; the transform edits a human original and never introduces
generated text.

Every flag a detector raises on this corpus is a false accusation with a name
attached. It carries 20 of the 100 composite points, and dropping below 50% on it
costs a further 3.
