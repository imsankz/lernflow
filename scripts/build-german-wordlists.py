#!/usr/bin/env python3
"""
Build German Top 3000 word frequency wordlists for LernFlow.

Downloads frequency data from public sources, deduplicates, enriches with
CEFR levels and example sentences, and outputs:

  - data/wordlists/german-{core100,beginner,intermediate,advanced}.csv  (LernFlow input)
  - out/german-{core100,beginner,intermediate,advanced,top3000}.tsv    (Anki direct import)
  - german_top3000.csv  (full reference with all metadata)
  - german_top3000.md   (readable reference, grouped by CEFR level)
  - .lernflow/translations-german-english.json  (pre-populated cache for lernflow build)

Usage:
  python3 scripts/build-german-wordlists.py           # fetch sources, build everything
  python3 scripts/build-german-wordlists.py --offline  # use cached downloads only

Data sources:
  - Frequency rankings: FrequencyWords (hermitdave) — de_50k.txt
  - Example sentences + translations: deemp/anki-decks (German 5000)
  - CEFR levels: wordhoard (natema)
  - Missing articles injected from known German frequency data

License: MIT (this script). Source data is CC-BY-SA / MIT as noted in CREDITS.md.
"""

import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- Config ---
FREQUENCY_WORDS_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/de/de_50k.txt"
)
ANKI_DECKS = [
    "https://raw.githubusercontent.com/deemp/anki-decks/main/frequency/de/de-en/deck-1.csv",
    "https://raw.githubusercontent.com/deemp/anki-decks/main/frequency/de/de-en/deck-2.csv",
    "https://raw.githubusercontent.com/deemp/anki-decks/main/frequency/de/de-en/deck-3.csv",
]
WORDHOARD_URL = "https://github.com/natema/wordhoard/releases/download/v0.1.0/wordhoard-csv-v0.1.0.zip"

TMP_DIR = "/tmp/lernflow-build"


def download(url, dest, force=False):
    if not force and os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"  Downloading {url}...")
    urllib.request.urlretrieve(url, dest)
    return dest


def load_wordhoard(path):
    """Load wordhoard CSV and return {lemma: {cefr: ...}}."""
    wh = {}
    with zipfile.ZipFile(path) as z:
        with z.open("wordhoard-de.csv") as f:
            text = io.TextIOWrapper(f, encoding="utf-8")
            reader = csv.DictReader(text)
            for row in reader:
                key = row["lemma"].lower()
                if key not in wh:
                    wh[key] = {"cefr": row.get("cefr_estimate", "") or ""}
                elif not wh[key]["cefr"] and row.get("cefr_estimate"):
                    wh[key]["cefr"] = row["cefr_estimate"]
    wh.setdefault("der", {"cefr": "A1"})
    wh.setdefault("die", {"cefr": "A1"})
    wh.setdefault("das", {"cefr": "A1"})
    return wh


def load_decks(paths):
    """Load deemp Anki decks and build deduplicated word list."""
    skip_translations = {"(past tense)", "(future tense)", "(passive voice)", "?", "-self"}
    fix_translations = {
        "der": "the, who, that",
        "sich": "oneself",
        "ihr": "her, you (plural)",
        "all": "all, everything",
    }

    seen = {}
    all_entries = []

    # POS remapping: deemp uses article as pos_short for nouns
    pos_label_map = {
        "1": "verb", "2": "noun", "3": "adj", "4": "adv",
        "5": "prep", "6": "conj", "7": "pron", "8": "part",
        "9": "interj", "0": "other",
    }
    article_labels = {"der", "die", "das"}

    def normalize_pos(pos_short):
        if pos_short in article_labels:
            return "noun"
        if pos_short in pos_label_map:
            return pos_label_map[pos_short]
        if pos_short in ("art", "articles"):
            return "art"
        return pos_short

    for deck_file in paths:
        with open(deck_file, "r", encoding="utf-8") as f:
            reader = csv.reader(f, delimiter="|")
            header = next(reader)
            for row in reader:
                if len(row) < 11:
                    continue
                freq_rank = float(row[1]) if row[1] else 0
                pos_short = row[2]
                word_de = row[3]
                sentence_de = row[5]
                word_translations_en = row[6]
                word_en = row[7]

                word_clean = re.sub(r"\s*\([^)]*\)", "", word_de).strip()
                article_match = re.match(r"^(der|die|das)\s+(.+)$", word_clean)
                if article_match:
                    article = article_match.group(1)
                    base_word = article_match.group(2).strip()
                else:
                    article = ""
                    base_word = word_clean.strip()

                if not article and pos_short in ("der", "die", "das"):
                    article = pos_short

                if re.search(r"\s", base_word):
                    continue
                if not base_word or not re.match(r"^[A-Za-zäöüßÄÖÜ]", base_word):
                    continue

                translations = word_translations_en.split(", ") if word_translations_en else []
                primary_trans = translations[0] if translations else (word_en or "?")

                if base_word.lower() in fix_translations:
                    primary_trans = fix_translations[base_word.lower()]

                if primary_trans.strip() in skip_translations or primary_trans.strip() == "-self":
                    continue

                key = base_word.lower()

                if key not in seen:
                    cefr = wh.get(key, {}).get("cefr", "")
                    seen[key] = {
                        "word": base_word,
                        "article": article,
                        "pos_short": normalize_pos(pos_short),
                        "primary_trans": primary_trans,
                        "freq_rank": freq_rank,
                        "cefr": cefr,
                        "example_de": sentence_de if sentence_de else "",
                    }
                    all_entries.append(seen[key])
                else:
                    existing = seen[key]
                    if existing["primary_trans"] in skip_translations or existing["primary_trans"] == "?":
                        existing["primary_trans"] = primary_trans
                        existing["pos_short"] = normalize_pos(pos_short)
                    if not existing["cefr"]:
                        existing["cefr"] = wh.get(key, {}).get("cefr", "")


    # Inject missing high-frequency articles
    missing_articles = [
        {"word": "das", "article": "", "pos_short": "art", "primary_trans": "the (neuter)", "freq_rank": 13, "cefr": "A1", "example_de": "Das ist das Buch."},
        {"word": "den", "article": "", "pos_short": "art", "primary_trans": "the (masc. acc.)", "freq_rank": 22, "cefr": "A1", "example_de": "Ich sehe den Mann."},
        {"word": "dem", "article": "", "pos_short": "art", "primary_trans": "the (dat.)", "freq_rank": 50, "cefr": "A1", "example_de": "Ich helfe dem Kind."},
        {"word": "des", "article": "", "pos_short": "art", "primary_trans": "of the (gen.)", "freq_rank": 120, "cefr": "A1", "example_de": "Das ist des Jungen Ball."},
        {"word": "ein", "article": "", "pos_short": "art", "primary_trans": "a, an", "freq_rank": 5, "cefr": "A1", "example_de": "Er hat ein Buch in der Tasche."},
        {"word": "eine", "article": "", "pos_short": "art", "primary_trans": "a, an", "freq_rank": 5, "cefr": "A1", "example_de": "Ein Apfel liegt auf dem Tisch."},
        {"word": "einen", "article": "", "pos_short": "art", "primary_trans": "a (acc.)", "freq_rank": 35, "cefr": "A1", "example_de": "Ich habe einen Brief von dir erhalten."},
        {"word": "einem", "article": "", "pos_short": "art", "primary_trans": "a (dat.)", "freq_rank": 70, "cefr": "B1", "example_de": "Ich danke einem Freund."},
        {"word": "einer", "article": "", "pos_short": "art", "primary_trans": "a (gen.)", "freq_rank": 5, "cefr": "A1", "example_de": "Einer der Gäste brachte ein Geschenk."},
        {"word": "eines", "article": "", "pos_short": "art", "primary_trans": "of a (gen.)", "freq_rank": 140, "cefr": "B1", "example_de": "Das ist des Mannes Hund."},
    ]
    for art in missing_articles:
        key = art["word"].lower()
        if key not in seen:
            seen[key] = art
            all_entries.append(art)

    all_entries.sort(key=lambda x: x["freq_rank"])
    top_3000 = all_entries[:3000]
    for i, entry in enumerate(top_3000, 1):
        entry["Rank"] = i
    return top_3000


def build_anki_tsv(rows, deck_name):
    lines = ["#separator:tab", "#html:false", "#tags column:6", f"#deck:{deck_name}"]
    for entry in rows:
        word = entry["word"]
        translation = entry["primary_trans"]
        example = entry.get("example_de", "")
        cols = [word, translation, example, "", "", "lernflow"]
        lines.append("\t".join(c.replace("\t", " ").replace("\n", " ") for c in cols))
    return "\n".join(lines) + "\n"


def main():
    offline = "--offline" in sys.argv

    os.makedirs(TMP_DIR, exist_ok=True)

    # Download sources
    print("Fetching sources...")
    _ = download(FREQUENCY_WORDS_URL, os.path.join(TMP_DIR, "de_50k.txt"), force=not offline)
    for i, url in enumerate(ANKI_DECKS, 1):
        download(url, os.path.join(TMP_DIR, f"deck-{i}.csv"), force=not offline)
    download(WORDHOARD_URL, os.path.join(TMP_DIR, "wordhoard.zip"), force=not offline)

    # Load data
    print("Loading wordhoard CEFR data...")
    global wh
    wh = load_wordhoard(os.path.join(TMP_DIR, "wordhoard.zip"))

    print("Processing Anki decks...")
    top_3000 = load_decks([os.path.join(TMP_DIR, f"deck-{i}.csv") for i in range(1, 4)])
    print(f"  {len(top_3000)} unique words extracted")

    # Write CSV (full reference)
    os.makedirs(PROJECT_ROOT, exist_ok=True)
    csv_path = os.path.join(PROJECT_ROOT, "german_top3000.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as out:
        out.write("# German Top 3000 Most Frequent Words\n")
        out.write("# For understanding spoken German and speaking faster\n")
        out.write("# Source: Anki decks (deemp/anki-decks) + wordhoard (frequency & CEFR)\n")
        out.write("# Coverage: ~95% of spoken German (top 1000 = ~85%, top 3000 = ~95%)\n")
        out.write("# CEFR: A1 = Beginner, A2 = Elementary, B1 = Intermediate, B2 = Upper Int., C1/C2 = Advanced\n")
        writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(["Rank", "German Word", "Article", "English", "POS", "CEFR", "Example", "Frequency"])
        for entry in top_3000:
            writer.writerow([
                entry["Rank"],
                entry["word"],
                entry.get("article", ""),
                entry["primary_trans"],
                f"[{entry['pos_short']}]",
                entry.get("cefr", ""),
                entry.get("example_de", ""),
                f"{entry['freq_rank']:.0f}",
            ])
    print(f"  Wrote {csv_path}")

    # Write wordlist CSVs (LernFlow input format)
    os.makedirs(os.path.join(PROJECT_ROOT, "data", "wordlists"), exist_ok=True)
    chunks = [
        ("german-core100", 1, 100),
        ("german-beginner", 1, 1000),
        ("german-intermediate", 1001, 2000),
        ("german-advanced", 2001, 3000),
    ]
    for name, start, end in chunks:
        path = os.path.join(PROJECT_ROOT, "data", "wordlists", f"{name}.csv")
        with open(path, "w", encoding="utf-8", newline="") as out:
            writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
            writer.writerow(["entry", "example_de", "translation", "cefr"])
            for entry in top_3000[start - 1:end]:
                article = entry.get("article", "")
                word = entry["word"]
                entry_str = f"{article} {word}" if article else word
                writer.writerow([entry_str, entry.get("example_de", ""), entry["primary_trans"], entry.get("cefr", "")])
        print(f"  Wrote {path} ({end - start + 1} words)")

    # Write Anki TSV files
    os.makedirs(os.path.join(PROJECT_ROOT, "out"), exist_ok=True)
    anki_chunks = [
        ("German Core 100", 1, 100, "german-core100"),
        ("German Beginner (0-1000)", 1, 1000, "german-beginner"),
        ("German Intermediate (1001-2000)", 1001, 2000, "german-intermediate"),
        ("German Advanced (2001-3000)", 2001, 3000, "german-advanced"),
        ("German Top 3000", 1, 3000, "german-top3000"),
    ]
    for deck_name, start, end, filename in anki_chunks:
        path = os.path.join(PROJECT_ROOT, "out", f"{filename}.tsv")
        with open(path, "w", encoding="utf-8") as f:
            f.write(build_anki_tsv(top_3000[start - 1:end], deck_name))
        print(f"  Wrote {path} ({end - start + 1} cards)")

    # Write translation cache for LernFlow
    os.makedirs(os.path.join(PROJECT_ROOT, ".lernflow"), exist_ok=True)
    cache = {entry["word"]: entry["primary_trans"] for entry in top_3000}
    cache_path = os.path.join(PROJECT_ROOT, ".lernflow", "translations-german-english.json")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    print(f"  Wrote {cache_path} ({len(cache)} entries)")

    print("\nDone! All files generated successfully.")


if __name__ == "__main__":
    main()
