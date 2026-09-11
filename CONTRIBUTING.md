# Contributing to LernFlow

LernFlow's goal is simple: **open-source language learning that anyone can extend.**
German is the reference implementation — the most polished wing, with graded grammar
banks (A1→B1), exam guides, and Goethe wordlist decks. Every other language starts from
the same skeleton, and that's where you come in.

## Ways to contribute

| I want to… | Start here |
|---|---|
| **Add a new language wing** | [Adding a language](#adding-a-language-wing) below |
| **Improve the German wing** | `data/banks/`, `docs/guides/`, `apps/web/public/decks/` |
| **Fix a wrong translation / gender / example** | Open an issue with the deck row, or PR the fix directly |
| **Improve the pipeline (CLI/web/macOS)** | `src/`, `apps/web/`, `apps/macos/` — run `npm test` before PRing |
| **Fund the work** | [GitHub Sponsors](https://github.com/sponsors/imsankz) · [Ko-fi](https://ko-fi.com/chasingwhereabouts) |

## Adding a language wing

A language wing is **pure data** — no code changes needed. The pipeline is language-
agnostic (`LERNFLOW_LANG` / `LERNFLOW_TARGET_LANG` label the AI prompts; lemma parsing
is tolerant of languages without articles/gender). A complete wing has three parts, and
a useful PR can ship just one of them:

### 1. Grammar banks — `data/banks/<lang>-<level>.yaml`

The item-bank format is validated by `src/grammar-bank.ts` (`level` + `categories[]`
with unique-`id` `items[]`). Use the German banks as templates:

- `data/banks/a1-grundlagen.yaml` — A1 (sein/haben, articles, modals, separable verbs…)
- `data/banks/a2-aufbau.yaml` — A2 (Perfekt, Dativ, subordinate clauses…)
- `data/banks/b1-telc.yaml` — B1 (Konjunktiv II, Passiv, Relativsätze…)
- `data/banks/b1-redemittel.yaml` — exam phrase bank

Rules:
- **Clean-room only.** Write your own example sentences. Cite grammar *references*
  (e.g. "modeled on standard CEFR A1 syllabus"), never copy exercises from courses,
  textbooks, or apps.
- Every item needs `id` (unique, prefixed — e.g. `fr-a1-etre`), `category`, `term`.
  `forms`, `disambiguationHint`, and 1–3 `examples` make it drillable.
- Validate before PRing: `node bin/lernflow.js grammar data/banks/your-bank.yaml --no-ai`
  must produce a deck with zero errors.

### 2. Study guides — `docs/guides/<lang>-<topic>.md`

The German B1 guides (`b1-grammar-map.md`, `b1-writing-templates.md`,
`b1-sprechen-playbook.md`) show the pattern: tick-box syllabus maps, exam-part
playbooks, timing plans, model answers with why-they-pass checklists. Target one CEFR
level and one real exam (DELF, DELE, JLPT, TOPIK, CILS…).

### 3. Web decks — `apps/web/public/decks/<name>.json`

An array of card objects for the lernweb PWA:

```json
[{ "lemma": "pomme", "gender": "la", "translation": "apple",
   "forms": "", "example": "La pomme est rouge.", "pos": null, "audio": null }]
```

- `gender` can be empty for languages without grammatical gender.
- **Licensing matters most here.** Only submit wordlists you are allowed to
  redistribute (public-domain frequency lists, CC-licensed institutional lists, or
  lists you authored). Name the source and license in your PR and in `CREDITS.md`.

## PR checklist

1. Fork, branch, make your change.
2. `npm run build && npm test` — must pass (data-only PRs: run the `grammar --no-ai`
   validation above instead).
3. For decks/banks: state the **source and license** of every piece of data.
4. Keep PRs focused — one language / one level / one guide per PR reviews fastest.

## Code contributions

- Node ≥ 18, ESM, zero runtime deps beyond `js-yaml`. Keep it that way.
- The CLI must **never hard-require the AI endpoint** — everything needs an offline
  fallback (`--no-ai`, cached translations, template drills).
- New features need a test in `tests/`.

## Questions?

Open a [discussion or issue](https://github.com/imsankz/lernflow/issues). If LernFlow
saved you a subscription, consider [sponsoring](https://github.com/sponsors/imsankz) —
it keeps the whole flow series free.
