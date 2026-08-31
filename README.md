# LernFlow 🧠 — your wordlists, your deck, your machine

Build **Anki decks from any wordlist** with translations from **your own AI endpoint**.
Zero cost. Zero accounts. Zero cloud. Your data never leaves your LAN unless you point
`AI_BASE_URL` at someone else's API.

**LernFlow is not a course app.** No streaks, no leagues, no fixed curriculum, no
hosted content. Duolingo sells you a closed loop; LernFlow is the open one: bring your
own vocabulary (Goethe Wortlisten, textbook PDFs you own, subtitles, your SRS notes),
and it becomes a deck you own forever, in standard Anki formats.

```
any wordlist CSV/TSV ──▶ learn lemma/gender/forms ──▶ AI translate (cached) ──▶ deck.tsv + deck.apkg
                                                                     └────────▶ daily quiz (deterministic, offline)
```

## Quick start

```bash
npm install -g lernflow
cd ~/study/german
lernflow init                      # writes .env.local — point it at Ollama/OpenAI/OmniRoute/whatever
echo 'der Apfel,Der Apfel ist rot.' > list.tsv   # or any CSV: term[,examples]
lernflow build list.tsv --deck "Mein Deutsch" --apkg --audio   # + TTS clips on every card
lernflow quiz --n 8                # daily self-test in your terminal
```

Import `out/Mein Deutsch.tsv` into Anki directly (all headers included) or use the
`.apkg` (needs `python3 -m pip install genanki`). `--audio` uses whatever TTS you have:
macOS `say` (+ afconvert→m4a), `espeak-ng`, `piper`, or any `LERNFLOW_TTS_CMD` you name.

## What it checks before shipping a deck

Every build runs an **audit gate** (POS validity, gender sanity, duplicate + garbage
translation detection) and fails fast with row numbers — no silent junk in your deck
(`--force` to override). POS is heuristic (article→Noun, `hat/ist` forms→Verb,
suffix rules); `pos` values follow a strict enum.

## Commands

| Command | What |
|---|---|
| `build <file>` | wordlist → translations (cached in `.lernflow/`) → audit → `out/<deck>.tsv` (+`--apkg`, `--audio`) |
| `grammar <bank.yaml>` | grammar/Redemittel item bank → AI cloze drill deck (offline `--no-ai` fallback); banks in `data/banks/` |
| `words add/list/fail/quarantine/stats` | word-tracking state machine — pending → in_deck, 2 fails → quarantine |
| `quiz [--n 8] [--seed N]` | deterministic daily quiz (translate / reverse / gender / gap) from the last deck |
| `status` | cache + deck stats |
| `init` | write `.env.local` template |

## Why this exists (positioning)

Spaced repetition works. Apps around it mostly lock your vocabulary into their walled
gardens and teach *their* wordlist. Anki is the open engine but you still need the raw
material: lemma, gender, forms, translations, examples. That extraction + translation
pipeline is busywork — so this is a **pipeline, not an app**: `ffmpeg` for wordlists.
Runs entirely on free/local AI (any OpenAI-compatible endpoint), caches every
translation so re-runs cost nothing, and degrades gracefully when the endpoint is down.

## Config (.env.local or environment)

| Var | Default | Notes |
|---|---|---|
| `AI_BASE_URL` | `http://127.0.0.1:20128/v1` | any OpenAI-compatible `/chat/completions` |
| `AI_MODEL` | `auto/best-free` | e.g. `llama3`, `gpt-4o-mini`, `auto/best-free` (OmniRoute) |
| `AI_API_KEY` | empty | local endpoints need none |
| `LERNFLOW_LANG` / `LERNFLOW_TARGET_LANG` | German / English | prompt labels — works for any pair |
| `LERNFLOW_BATCH` / `LERNFLOW_MAX_CALLS` | 40 / 200 | per-run AI budget guard |

## Library use

```ts
import { parseEntry } from "lernflow/lemma";
import { Translator } from "lernflow/translate";
```

## License & data

MIT for the tool. LernFlow **ships no wordlists**: everything you build comes from your
files. Example decks' sources and licenses are yours to track (see `CREDITS.md` pattern).

Part of the flow series: [SeoFlow](https://github.com/imsankz/seoflow) ·
[SECflow](https://github.com/imsankz/secflow) ·
[BacklinkFlow](https://github.com/imsankz/backlinkflow)
