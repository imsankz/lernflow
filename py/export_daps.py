#!/usr/bin/env python3
"""lernflow .daps/APKG exporter with audio preservation.

Standalone: python3 export_daps.py <rows.json> <out.apkg> [--audio-dir DIR] [--deck NAME]

Input rows.json is the same schema lernflow writes (.lernflow/rows.json):
  {"lemma", "gender", "translation", "forms", "example", "audio"(basename|path, optional), "pos"(optional)}

Audio resolution (first hit wins, per row):
  1. row["audio"] as absolute path or relative to --audio-dir / CWD
  2. <--audio-dir>/<sanitized lemma>.<ext>  (the src/audio.ts naming convention)
  3. <--audio-dir>/<sanitized lemma>.<any audio ext>

Audio is embedded as package media and referenced with [sound:<basename>]
on both card sides (native->foreign and foreign->native), so playback works
in Anki without external files.
"""
import argparse
import json
import os
import re
import sys

try:
    import genanki
except ImportError:
    sys.stderr.write("export_daps.py: 'genanki' not installed — run: pip3 install genanki\n")
    sys.exit(2)

CSS = (
    ".card{font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;text-align:center;padding:16px}"
    ".g{color:#888;font-size:14px}.en{color:#1565c0;font-size:17px}"
)

MODEL = genanki.Model(
    1600000001, "LernFlow Basic",
    fields=[{"name": "Term"}, {"name": "Gender"}, {"name": "Forms"},
            {"name": "Translation"}, {"name": "Example"}, {"name": "Audio"}],
    css=CSS,
    templates=[
        {"name": "Native->Foreign", "qfmt": "{{Term}} {{Gender}}\n{{Audio}}",
         "afmt": "{{FrontSide}}<hr id='answer'><b>{{Translation}}</b><div class='en'>{{Forms}}</div>"
                 "{{#Example}}<hr>{{Example}}{{/Example}}"},
        {"name": "Foreign->Native", "qfmt": "{{Translation}}\n{{Audio}}",
         "afmt": "{{FrontSide}}<hr id='answer'><b>{{Term}}</b> {{Gender}}"
                 "{{#Example}}<hr>{{Example}}{{/Example}}"},
    ],
)

GAP = genanki.Model(
    1600000002, "LernFlow Gap",
    fields=[{"name": "Gap"}, {"name": "Sentence"}, {"name": "Term"}, {"name": "Translation"}, {"name": "Audio"}],
    css=CSS + ".card{text-align:left}",
    templates=[{"name": "Gap",
                "qfmt": "{{Gap}}<div class='g'>({{Translation}})</div>\n{{Audio}}",
                "afmt": "{{Sentence}}<hr><b>{{Term}}</b> = {{Translation}}"}],
)

AUDIO_EXTS = {".m4a", ".mp3", ".wav", ".ogg", ".aiff", ".aac", ".flac", ".opus"}


def sanitize(key):
    """Mirror src/audio.ts audioPath(): forbidden chars -> '_', 60-char cap."""
    return re.sub(r'[\\/:*?"<>|\[\]]', "_", key)[:60]


def resolve_audio(row, audio_dir):
    """Return (abs path, basename) for a row's audio, or (None, None)."""
    a = row.get("audio")
    if a:
        p = a
        if not os.path.isabs(p) and audio_dir:
            cand = os.path.join(audio_dir, p)
            if os.path.exists(cand):
                p = cand
        if os.path.exists(p):
            return os.path.abspath(p), os.path.basename(p)
        # path may be a bare name relative to CWD
        if not os.path.isabs(a) and os.path.exists(a):
            return os.path.abspath(a), os.path.basename(a)
    if audio_dir and os.path.isdir(audio_dir):
        stem = sanitize(row.get("lemma", ""))
        if stem:
            cand = os.path.join(audio_dir, stem + ".m4a")
            if os.path.exists(cand):
                return os.path.abspath(cand), os.path.basename(cand)
            # any audio extension
            for f in sorted(os.listdir(audio_dir)):
                if os.path.splitext(f)[0] == stem and os.path.splitext(f)[1].lower() in AUDIO_EXTS:
                    return os.path.join(os.path.abspath(audio_dir), f), f
    return None, None


def build_deck(rows, deck_name, audio_dir):
    deck = genanki.Deck(1700000001, deck_name)
    media = []
    seen = set()
    n = g = audio_rows = 0

    def sound_field(row):
        nonlocal audio_rows
        path, name = resolve_audio(row, audio_dir)
        if not path:
            return ""
        audio_rows += 1
        if name not in seen:
            media.append(path)
            seen.add(name)
        return "[sound:%s]" % name

    for r in rows:
        hw = r.get("lemma") or r.get("entry") or ""
        tr = r.get("translation") or ""
        gen = "(%s)" % r["gender"] if r.get("gender") else ""
        snd = sound_field(r)
        deck.add_note(genanki.Note(model=MODEL, fields=[
            hw, gen, r.get("forms", ""), tr,
            re.sub(r"\s+", " ", r.get("example") or r.get("examples") or "").strip(), snd]))
        n += 1
        ex = r.get("example") or r.get("examples") or ""
        m = re.search(r"\b" + re.escape(hw) + r"\w*\b", ex)
        if m:
            gap = ex[:m.start()] + "___" + ex[m.end():]
            deck.add_note(genanki.Note(model=GAP, fields=[gap, ex, hw, tr, snd]))
            g += 1

    return deck, media, n, g, audio_rows


def main():
    ap = argparse.ArgumentParser(description="Export lernflow rows.json to .daps/APKG with audio.")
    ap.add_argument("rows_json")
    ap.add_argument("out_apkg")
    ap.add_argument("--audio-dir", default="", help="sidecar audio dir (fallback: row.audio)")
    ap.add_argument("--deck", default="LernFlow", help="deck name")
    args = ap.parse_args()

    with open(args.rows_json, encoding="utf-8") as f:
        data = json.load(f)
    rows = data["rows"] if isinstance(data, dict) and "rows" in data else data

    deck, media, n, g, audio_rows = build_deck(rows, args.deck, args.audio_dir)

    pkg = genanki.Package(deck)
    pkg.media_files = media
    pkg.write_to_file(args.out_apkg)
    print("%d vocab cards + %d gap cards = %d notes" % (n, g, n + g))
    print("audio: %d rows with sound, %d media files embedded" % (audio_rows, len(media)))
    print("wrote %s" % args.out_apkg)


if __name__ == "__main__":
    main()
