#!/usr/bin/env python3
"""lernflow .apkg writer (genanki). Usage: make_apkg.py <input.json> <out.apkg>
Input JSON: {"deck": name, "rows": [{lemma,gender,translation,forms,example,audio}], "audio_dir": dir}
audio (if present) is embedded as media and referenced with [sound:] on both sides."""
import json, re, sys, os
import genanki

data = json.load(open(sys.argv[1]))
out = sys.argv[2]
deck_name = data.get("deck", "LernFlow")
rows = data["rows"]
audio_dir = data.get("audio_dir") or ""

CSS = (".card{font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;text-align:center;padding:16px}"
       ".g{color:#888;font-size:14px}.en{color:#1565c0;font-size:17px}")

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

DECK = genanki.Deck(1700000001, deck_name)
media_files = []
seen_media = set()

def sound_field(r):
    a = r.get("audio")
    if not a:
        return ""
    fn = os.path.basename(a)
    if audio_dir and os.path.exists(os.path.join(audio_dir, fn)):
        if fn not in seen_media:
            media_files.append(os.path.join(audio_dir, fn))
            seen_media.add(fn)
        return f"[sound:{fn}]"
    return ""

n = g = 0
for r in rows:
    hw, tr = r["lemma"], r["translation"]
    gen = f"({r['gender']})" if r.get("gender") else ""
    snd = sound_field(r)
    DECK.add_note(genanki.Note(model=MODEL, fields=[
        hw, gen, r.get("forms", ""), tr,
        re.sub(r"\s+", " ", r.get("example", "")).strip(), snd]))
    n += 1
    ex = r.get("example", "")
    m = re.search(r"\b" + re.escape(hw) + r"\w*\b", ex)
    if m:
        gap = ex[:m.start()] + "___" + ex[m.end():]
        DECK.add_note(genanki.Note(model=GAP, fields=[gap, ex, hw, tr, snd]))
        g += 1

pkg = genanki.Package(DECK)
pkg.media_files = media_files
pkg.write_to_file(out)
print(f"{n} vocab cards + {g} gap cards" + (f", {len(media_files)} audio clips" if media_files else ""))
