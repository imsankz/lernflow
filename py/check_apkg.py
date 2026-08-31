#!/usr/bin/env python3
"""lernflow .apkg integrity checker (CI/regression gate).

Usage: python3 check_apkg.py <file.apkg>

Unzips the package, opens the collection sqlite, and verifies:
  - notes and cards counts are sane and non-zero
  - every [sound:] reference has a matching media file (audio embedding)
  - required fields per model are non-empty (Term/Translation for Basic,
    Gap/Sentence/Term/Translation for Gap)
  - no field value contains the literal string "undefined" (bad JS serialization)

Exits 0 on PASS, 1 on FAIL. Prints a short report either way.
"""
import argparse
import os
import re
import sqlite3
import sys
import tempfile
import zipfile

REQUIRED_FIELDS = {
    "LernFlow Basic": ["Term", "Translation"],
    "LernFlow Gap": ["Gap", "Sentence", "Term", "Translation"],
}


def open_db(apkg):
    zf = zipfile.ZipFile(apkg)
    # genanki stores media as numeric entries + a 'media' JSON index
    media = set()
    if "media" in zf.namelist():
        try:
            media = set(__import__("json").loads(zf.read("media").decode("utf-8")).values())
        except Exception:
            media = set()
    tmpdir = tempfile.mkdtemp(prefix="lf-check-")
    db_path = os.path.join(tmpdir, "collection.anki2")
    with zf.open("collection.anki2") as src, open(db_path, "wb") as dst:
        dst.write(src.read())
    return sqlite3.connect(db_path), media


def model_field_names(con):
    """mid -> ordered field names, parsed from col.models JSON (genanki schema)."""
    out = {}
    row = con.execute("SELECT models FROM col").fetchone()
    if not row:
        return out
    try:
        models = __import__("json").loads(row[0])
    except Exception:
        return out
    for mid, spec in models.items():
        try:
            out[int(mid)] = [f.get("name", "") for f in spec.get("flds", [])]
        except Exception:
            continue
    return out


def sound_refs(text):
    return set(re.findall(r"\[sound:([^\]]+)\]", text))


def check(apkg):
    problems = []
    stats = {"notes": 0, "cards": 0, "media": 0, "audio_refs": 0,
             "audio_missing": 0, "empty_required": 0, "undefined_strings": 0}

    con, media = open_db(apkg)
    stats["media"] = len(media)
    try:
        stats["notes"] = con.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        stats["cards"] = con.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        if stats["notes"] <= 0:
            problems.append("no notes in collection")
        if stats["cards"] <= 0:
            problems.append("no cards in collection")
        if stats["cards"] < stats["notes"]:
            problems.append("cards(%d) < notes(%d) — expected >= 1 card per note"
                            % (stats["cards"], stats["notes"]))

        field_names = model_field_names(con)
        for mid, flds in con.execute("SELECT mid, flds FROM notes"):
            fields = flds.split("\x1f")
            text = "\x1f".join(fields)
            if "undefined" in text:
                stats["undefined_strings"] += 1
                problems.append("note %d contains literal 'undefined'" % mid)
            refs = sound_refs(fields[-1]) if fields else set()
            stats["audio_refs"] += len(refs)
            for ref in refs:
                if ref not in media:
                    stats["audio_missing"] += 1
                    problems.append("missing media for [sound:%s]" % ref)
            names = field_names.get(mid, [])
            for req in REQUIRED_FIELDS.get(_model_name(con, mid), []):
                try:
                    idx = names.index(req)
                except ValueError:
                    continue
                if idx < len(fields) and not fields[idx].strip():
                    stats["empty_required"] += 1
                    problems.append("note %d: empty required field '%s'" % (mid, req))
    finally:
        con.close()

    return stats, problems


def _model_name(con, mid):
    row = con.execute("SELECT models FROM col").fetchone()
    if not row:
        return ""
    try:
        models = __import__("json").loads(row[0])
        spec = models.get(str(mid)) or models.get(mid)
        return spec.get("name", "") if spec else ""
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser(description="Verify lernflow .apkg integrity.")
    ap.add_argument("apkg")
    args = ap.parse_args()
    if not os.path.exists(args.apkg):
        print("FAIL: %s not found" % args.apkg)
        sys.exit(1)

    stats, problems = check(args.apkg)
    print("notes: %d   cards: %d   media: %d   audio refs: %d" % (
        stats["notes"], stats["cards"], stats["media"], stats["audio_refs"]))
    print("audio missing: %d   empty required fields: %d   'undefined' strings: %d" % (
        stats["audio_missing"], stats["empty_required"], stats["undefined_strings"]))

    if problems:
        print("FAIL:")
        for p in problems[:25]:
            print("  - " + p)
        if len(problems) > 25:
            print("  ... and %d more" % (len(problems) - 25))
        sys.exit(1)
    print("PASS")


if __name__ == "__main__":
    main()
