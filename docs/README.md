# LernFlow — Docs

LernFlow turns any wordlist (CSV/TSV) into an Anki deck you own, with translations from your own AI endpoint and a deterministic daily quiz. No accounts, no streaks, no walled garden — your data stays on your machine. See the repo root `README.md` for setup; this folder is the study-side manual.

## What's here

| File | What it's for |
|---|---|
| `guides/b1-grammar-map.md` | Full B1 grammar syllabus as a tick-box checklist — tenses, modals, Konjunktiv II, Passiv, Nebensätze, word order, and every other topic telc/Goethe actually tests, each with Beispielsätze + the errors that cost points. |
| `guides/b1-writing-templates.md` | telc Schreiben Part 1 (informell) + Part 2 (formell): timing plan, Redemittel, two full Muster with point-by-point why-they-pass checklists. |
| `guides/b1-sprechen-playbook.md` | Mündlich Teil 1–3: typical questions + answer patterns, negotiation phrases, and the 5-point Folie skeleton for the Präsentation. |

Grammar item banks live in `data/banks/` and cover the whole path to B1: `a1-grundlagen.yaml` (sein/haben, articles, modals, separable verbs, W-Fragen…), `a2-aufbau.yaml` (Perfekt, Dativ, Wechselpräpositionen, Nebensätze…), `b1-telc.yaml` (Konjunktiv II, Passiv…), and `b1-redemittel.yaml` (exam phrases). Drill any of them with `lernflow grammar data/banks/<bank>.yaml` (`--no-ai` works offline), or run `lernflow banks-to-decks` to regenerate the bundled `Grammatik A1/A2/B1` + `Redemittel B1` lernweb decks from the banks (offline, deterministic — this is what CI checks stays in sync). Prefer studying in the browser? The [lernweb PWA](https://imsankz.github.io/lernflow/app/) ships the Goethe A1/A2/B1 vocab decks plus the grammar/Redemittel decks, all with FSRS-5 scheduling, offline German TTS (SpeechSynthesis), and full backup export/import in Settings.

The guides target an English speaker preparing telc B1 at ~A2/B1, but the grammar map and Redemittel transfer directly to the Goethe-Zertifikat B1.

## Using decks with the guides

The Goethe B1 Wortliste deck (built from ~2,886 lemmas — see `rows.json`) is raw vocabulary: lemma, gender, translation, example sentences. The guides turn that raw material into exam skills:

- **Drill the grammar map's patterns as cards.** Instead of single words, add cards like `weil + Verb am Ende → Ich bleibe zu Hause, weil …` and test yourself with `lernflow quiz`. Every example sentence in the Wortliste is grammatically correct German — read it aloud and note the verb position.
- **Search your deck for connectors** (`weil, obwohl, damit, trotzdem…`) and turn each into a speaking-template card: one connector per card, with a model sentence from the guides.
- **Gender and endings** are on every noun card; the grammar map's §7–§8 tell you what to do with them.

### Importing decks into Anki

```bash
lernflow build list.tsv --deck "Mein Deutsch" --apkg --audio
# -> out/Mein Deutsch.tsv  (import this directly into Anki)
# -> out/Mein Deutsch.apkg (needs: python3 -m pip install genanki)
```

Headers are included in the TSV for direct Anki import; the `.apkg` is the one-click path.

### Daily quiz

```bash
lernflow quiz --n 8                # translate / reverse / gender / gap-fill from the last deck
lernflow quiz --n 8 --seed 42      # same quiz every time (deterministic) — useful for retesting
```

The quiz is offline and deterministic: same seed → same questions, so you can retake a quiz the next day and measure real retention. Pair it with the grammar map's "tick a topic when you can produce it from memory" rule — quiz results tell you which § to revisit.

### Suggested study loop (30–45 min/day)

1. `lernflow quiz --n 8` — 5 min warm-up; note which § of the grammar map you failed.
2. 15 min grammar: one tick-box section from the map; write 3 example sentences from memory.
3. 15 min exam skill, rotating: Schreiben Muster (copy + adapt one Redemittel block), Sprechen (record Teil 1 answers), or Lesen/Hören with the Wortliste examples read aloud.
4. 5 min: add 5–10 new word cards from `rows.json` topics you hit in step 3 (e.g. all words tagged to travel, or every verb with `mit`).

## Data notes

- LernFlow ships **no wordlists** — decks are built from files you provide (the Goethe B1 Wortliste in `/Users/sankz/german-b1/` is an example source).
- The audit gate (POS validity, gender sanity, duplicate + garbage translation detection) runs on every build; pass `--force` only if you know why a row fails.
