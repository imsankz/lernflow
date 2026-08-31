#!/usr/bin/env python3
"""Plain-assert tests for export_daps.py + check_apkg.py (no pytest needed).

Run: python3 test_apkg.py
Builds a small deck with real audio, exports it, and verifies both sides:
note/card counts, media embedding, [sound:] references, required fields,
and the 'undefined' string detector.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.join(HERE, "export_daps.py")
CHECK = os.path.join(HERE, "check_apkg.py")

GOOD_ROWS = [
    {"lemma": "das Haus", "gender": "das", "translation": "house",
     "forms": "Häuser", "example": "Das Haus ist groß.", "audio": "haus.m4a", "pos": "noun"},
    {"lemma": "laufen", "gender": "", "translation": "to run",
     "forms": "läuft, lief, ist gelaufen", "example": "Ich laufe schnell.", "audio": "laufen.m4a"},
    {"lemma": "Brot", "gender": "das", "translation": "bread",
     "forms": "", "example": "Das Brot ist frisch."},
]

UNDEF_ROWS = [
    {"lemma": "das Haus", "gender": "das", "translation": "house",
     "forms": "Häuser", "example": "Das Haus ist groß.", "audio": "haus.m4a"},
    {"lemma": "laufen", "gender": "", "translation": "to run",
     "forms": "läuft, lief, ist gelaufen", "example": "Ich laufe schnell.", "audio": "laufen.m4a"},
    {"lemma": "Brot", "gender": "das", "translation": "bread",
     "forms": "", "example": "undefined in example"},
]


def run(cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)


def make_clip(path):
    aiff = path + ".aiff"
    subprocess.run(["say", "-v", "Anna", "-o", aiff, "Hallo Welt"], check=True,
                   capture_output=True)
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", aiff, path], check=True,
                   capture_output=True)
    os.unlink(aiff)


def apkg_notes(apkg):
    import sqlite3
    with zipfile.ZipFile(apkg) as zf:
        tmp = tempfile.mkdtemp()
        db = os.path.join(tmp, "c.anki2")
        with zf.open("collection.anki2") as src, open(db, "wb") as dst:
            dst.write(src.read())
        con = sqlite3.connect(db)
        try:
            notes = con.execute("SELECT flds FROM notes").fetchall()
            cards = con.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        finally:
            con.close()
        shutil.rmtree(tmp, ignore_errors=True)
        # genanki stores media files as numeric entries; decode the media index
        media = set()
        if "media" in zf.namelist():
            mapping = json.loads(zf.read("media").decode("utf-8"))
            media = set(mapping.values())
    return notes, cards, media


def main():
    tmp = tempfile.mkdtemp(prefix="lf-test-")
    rows_path = os.path.join(tmp, "rows.json")
    audio_dir = os.path.join(tmp, "audio")
    os.makedirs(audio_dir)
    with open(rows_path, "w", encoding="utf-8") as f:
        json.dump(GOOD_ROWS, f, ensure_ascii=False)

    # two real clips
    make_clip(os.path.join(audio_dir, "haus.m4a"))
    make_clip(os.path.join(audio_dir, "laufen.m4a"))

    out = os.path.join(tmp, "test.apkg")

    # --- export ---
    r = run([sys.executable, EXPORT, rows_path, out, "--audio-dir", audio_dir, "--deck", "TestDeck"])
    assert r.returncode == 0, r.stderr
    assert os.path.exists(out), "apkg not written"
    stdout = r.stdout
    assert "3 vocab cards" in stdout, stdout
    assert "1 gap cards" in stdout, stdout
    assert "2 media files" in stdout, stdout

    # --- verify inside package ---
    notes, cards, media = apkg_notes(out)
    assert len(notes) == 4, "expected 4 notes (3 vocab + 1 gap), got %d" % len(notes)
    assert cards >= 4, "expected >= 4 cards, got %d" % cards
    assert "haus.m4a" in media and "laufen.m4a" in media, "media files not embedded"
    assert len(media) == 2, "unexpected media count %d" % len(media)
    # audio references present in vocab notes only (gap note for 'das Haus' has none)
    refs = set()
    for (flds,) in notes:
        refs.update(re.findall(r"\[sound:([^\]]+)\]", flds.split("\x1f")[-1]))
    assert refs == {"haus.m4a", "laufen.m4a"}, refs

    # --- check_apkg passes on good deck ---
    r = run([sys.executable, CHECK, out])
    assert r.returncode == 0, "check_apkg should PASS: " + r.stdout + r.stderr
    assert "PASS" in r.stdout, r.stdout
    assert "notes: 4" in r.stdout, r.stdout
    assert "cards:" in r.stdout, r.stdout
    assert "audio refs: 2" in r.stdout, "expected 2 audio refs (vocab notes only), got: " + r.stdout

    # --- check_apkg fails on 'undefined' string deck ---
    undef_path = os.path.join(tmp, "undef-rows.json")
    undef_out = os.path.join(tmp, "undef.apkg")
    with open(undef_path, "w", encoding="utf-8") as f:
        json.dump(UNDEF_ROWS, f)
    run([sys.executable, EXPORT, undef_path, undef_out, "--audio-dir", audio_dir])
    r = run([sys.executable, CHECK, undef_out])
    assert r.returncode == 1, "check_apkg should FAIL on undefined string: " + r.stdout
    assert "undefined" in r.stdout, r.stdout

    # --- no-audio export passes checker too ---
    no_audio_path = os.path.join(tmp, "noaudio-rows.json")
    no_audio_out = os.path.join(tmp, "noaudio.apkg")
    with open(no_audio_path, "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in r_.items() if k != "audio"} for r_ in GOOD_ROWS], f)
    r = run([sys.executable, EXPORT, no_audio_path, no_audio_out])
    assert r.returncode == 0, r.stderr
    r = run([sys.executable, CHECK, no_audio_out])
    assert r.returncode == 0, r.stdout

    shutil.rmtree(tmp, ignore_errors=True)
    print("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
