# Credits & data provenance

LernFlow's CLI ships no wordlists — decks you build come from your own files, under
your own licenses. The repository additionally bundles reference data for the German
wing; its provenance:

| Data | Source / authorship | License |
|---|---|---|
| `data/banks/a1-grundlagen.yaml` | Clean-room authored for LernFlow; syllabus scope modeled on the standard CEFR A1 canon (grammar references: Dreyer-Schmitt, Hammer's). All example sentences original. | MIT (repo) |
| `data/banks/a2-aufbau.yaml` | Clean-room authored for LernFlow; CEFR A2 canon, original examples. | MIT (repo) |
| `data/banks/b1-telc.yaml` | Clean-room authored; grammar scope from standard B1 references, no copied exercises. | MIT (repo) |
| `data/banks/b1-redemittel.yaml` | Canonical German exam phrases (standard Prüfungsredemittel — functional language, not creative expression); English glosses authored here. | MIT (repo) |
| `docs/guides/*.md` | Original writing for LernFlow. | MIT (repo) |
| `apps/web/public/decks/goethe-*.json` | Built with the LernFlow pipeline from Goethe-Institut Wortlisten (headword inventories); example sentences and translations produced/curated for this repo. | See note below |
| German Top 3000 wordlists | Frequency rankings: [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (de_50k.txt); Example sentences + translations: [deemp/anki-decks](https://github.com/deemp/anki-decks); CEFR levels + frequencies: [wordhoard](https://github.com/natema/wordhoard) | CC BY-SA 4.0 / MIT |

## Attribution notes

- The frequency rankings are derived from the FrequencyWords project, based on
  the Leipzig Corpora Collection web corpus (CC BY-4.0).
- Example German sentences and English translations come from the
  deemp/anki-decks Anki deck "German 5000 Frequency Words."
- CEFR level estimates (A1–C2) are from the wordhoard dataset, which anchors
  against the Goethe Institute frequency vocabulary.
- All source data is used under its respective open license. See LICENSE
  (MIT) for the tooling in this repository.

**Note on the Goethe decks:** the Goethe-Institut publishes its Wortlisten freely for
exam preparation. If you are the Goethe-Institut or believe any bundled data exceeds
fair use of a word inventory, open an issue and we will remove or rebuild it.

**Contributors:** every language-wing PR must add a row to this table naming its
source and license. See [CONTRIBUTING.md](CONTRIBUTING.md).
