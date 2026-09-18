# The data, exactly

Two things. Texts, then numbers. Nothing else.

---

## 1. Texts — 70 files for you, 21 built free

Everything goes in as **plain text, 180–280 words**, saved as
`<id>.txt` at the path below. No headings, no markdown, no title line — just the
prose a detector would see.

### A. AI text — 28 files → `datasets/ai/texts/`

Paste each prompt into a chatbot (free ChatGPT / Claude / Gemini is fine — no API
key needed), save the reply. The 28 prompts are in
[`data/cycles/2026-10/prompts.json`](../data/cycles/2026-10/prompts.json),
already resolved and locked.

Three rules:

- **Paste the prompt verbatim.** Don't add "make it sound human" or "vary the
  sentence length". That would benchmark prompt engineering, not detection.
- **Save the reply verbatim**, minus chat framing — drop a leading title,
  "Sure, here's…", and any trailing "Let me know if you'd like changes".
- **Spread across models.** Ideally 7 from each of four different models, so one
  model's quirks don't become the whole result. Record which is which in
  `data/cycles/2026-10/generators.json`. One model works if that's what you have
   — it just becomes a stated limitation of cycle 1.

### B. Human text — 21 files → `datasets/human/texts/`

**Must have been published before 2021.** That is the entire guarantee that it
is human, so a date you can point at matters more than the specific source.

| id | Domain | Suggested source |
|---|---|---|
| `hum-acad-01` `hum-acad-03` | academic | PubMed Central open access |
| `hum-acad-02` | academic | arXiv paper body |
| `hum-blog-01` `hum-blog-02` | blog | Blog Authorship Corpus |
| `hum-blog-03` | blog | Any pre-2021 personal blog via Wayback |
| `hum-email-01` `hum-email-02` | business email | Enron corpus |
| `hum-email-03` | business email | SEC EDGAR correspondence |
| `hum-news-01` `hum-news-02` | journalism | Wikinews (pre-2021 permalink) |
| `hum-news-03` | journalism | Voice of America |
| `hum-tech-01` | technical | NASA NTRS report |
| `hum-tech-02` | technical | NIST Special Publication |
| `hum-tech-03` | technical | PostgreSQL 12 docs |
| `hum-fict-01` `hum-fict-02` | fiction | WritingPrompts corpus |
| `hum-fict-03` | fiction | Standard Ebooks |
| `hum-forum-01` `hum-forum-02` `hum-forum-03` | forum | Stack Exchange posts, pre-2020 |

**Substitutions are fine** as long as the domain matches and the date is
pre-2021 — Stack Exchange posts can be copied straight off the live site, which
is far easier than the bulk dump. Tell me what you swapped and I'll update the
manifest so the record stays accurate.

### C. False-positive text — 21 files → `datasets/false-positive/texts/`

Same pre-2021 rule. This is the corpus that decides the benchmark, because every
flag raised here is a false accusation.

| id | Profile | What it has to be |
|---|---|---|
| `fp-esl-01` `fp-esl-02` `fp-esl-03` | ESL | Written in English by a second-language writer |
| `fp-trans-01` `fp-trans-02` `fp-trans-03` | translated | Written in another language, translated by a **human** |
| `fp-tmpl-01` `fp-tmpl-02` `fp-tmpl-03` | templated | Rigid institutional template — Federal Register, NTSB report, NIH abstract |
| `fp-tech-01` `fp-tech-02` `fp-tech-03` | formulaic | Standards prose — an RFC, a W3C rec, a NIST standard |
| `fp-arch-01` `fp-arch-02` `fp-arch-03` | archival | Pre-1930 formal prose — Gutenberg, Chronicling America |
| `fp-gram-01` `fp-gram-02` `fp-gram-03` | grammar-corrected | **Built for you** from B and the ESL files |
| `fp-short-01` `fp-short-02` `fp-short-03` | short-form | **Built for you** — 60–110 word truncations |

**ESL is the hard one and the one that matters most.** FCE and Lang-8 both need
an application. If you don't want to wait, any pre-2021 archived writing by a
named second-language author works — I'll record the substitution honestly in
the manifest.

### D. Hybrid — 21 files

Nothing to get. I splice these from B and C at exact 25/50/75% ratios.

---

## 2. Numbers — one per text, per tool, per pass

Run `npm run collection-sheet -- --cycle 2026-10` and you get one CSV per
detector with all 91 ids pre-filled:

```csv
sampleId,run1,run2,notes
ai-academic-1,,,
hum-acad-01,,,
```

Type the number the tool displays. That's the whole job.

| Rule | Why |
|---|---|
| **Record as displayed. Never convert.** Winston says "98% human" → type `98`. Originality says 0.07 → type `0.07`. | The importer converts using each vendor's scale. Doing it yourself is how a detector ends up inverted for a whole cycle. |
| **`refused`** when the tool won't score it | A refusal is data. A guess is not. |
| **Blank** = not collected yet | Blanks are skipped, never read as zero. |
| **run1 and run2 on different days** | Back-to-back readings measure nothing. The gap *is* the consistency metric. |
| **Don't look up what a sample is** | The sheet hides it deliberately. Knowing would make you re-check surprising readings and not boring ones. |

Volume: **182 numbers per detector.** About an hour each by hand. Nine detectors
with API keys cost you nothing but the key.

---

## Summary of what to send me

1. **70 `.txt` files** in the three folders above (or fewer — tell me what you
   couldn't get and I'll adjust the manifest rather than leave a gap)
2. **Which model produced which AI sample**, for `generators.json`
3. **The filled CSVs**, whenever they're done — partial is fine, I can score
   what exists and add more later

---

## One disclosure about cycle 1

The commitment and the reveal happened in the same sitting, because you needed
the prompts to start collecting. The commit hash is in git history before the
nonce, but seconds before — so cycle 1's commit–reveal proves less than a normal
cycle's, where the commitment is published days ahead. Cycle 2 gets a real gap.
Noted here rather than left for someone to notice.

Two prompts also read "a undergraduate" and "a operations lead" — an a/an
artifact of template substitution. Left as-is because editing the templates now
would break the commitment hashes, and no model is troubled by it. Fixed in
methodology v2.
