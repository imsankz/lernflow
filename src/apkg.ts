import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export interface TsvRow {
  lemma: string; gender: string; translation: string; forms: string; example: string; pos?: string; audio?: string;
}

// Anki-importable TSV: DE | EN(gender) | example, #separator:\t header.
export function buildTSV(rows: TsvRow[], deckName: string, tag = "lernflow"): string {
  const esc = (s: string) => s.replace(/[\t\n\r]/g, " ");
  const head = `#separator:tab\n#html:false\n#tags column:6\n#deck:${deckName.replace(/[\t\n]/g, " ")}\n`;
  const body = rows.map(r => {
    const de = r.gender ? `${r.lemma} (${r.gender})` : r.lemma;
    return [esc(de), esc(r.translation), esc(r.example), esc(r.forms), "", esc(tag)].join("\t");
  });
  return head + body.join("\n") + "\n";
}

export function gapExample(example: string, lemma: string): string | null {
  const m = example.match(new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`, "i"));
  if (!m || m.index === undefined) return null;
  return example.slice(0, m.index) + "___" + example.slice(m.index + m[0].length);
}

// Find a python3 that can import genanki: env override, then PATH, then common brew locations.
export function resolvePython(): string {
  const candidates = [process.env.LERNFLOW_PYTHON, "python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].filter(Boolean) as string[];
  for (const p of candidates) {
    const r = spawnSync(p, ["-c", "import genanki"], { encoding: "utf8" });
    if (r.status === 0) return p;
  }
  return "python3";
}

// .apkg via bundled python genanki script (flow-series python-tool-runtime pattern).
export function writeApkg(rows: TsvRow[], outPath: string, deckName: string, audioDir = ""): { ok: boolean; message: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const py = existsSync(join(here, "py", "make_apkg.py")) ? join(here, "py", "make_apkg.py") : join(here, "..", "py", "make_apkg.py");
  if (!existsSync(py)) return { ok: false, message: "make_apkg.py not found next to dist" };
  const data = join(dirname(outPath) || ".", ".lernflow-apkg-input.json");
  mkdirSync(dirname(data), { recursive: true });
  writeFileSync(data, JSON.stringify({ deck: deckName, rows, audio_dir: audioDir }));
  const r = spawnSync(resolvePython(), [py, data, outPath], { encoding: "utf8", timeout: 180000 });
  if (r.status !== 0) {
    const hint = /No module named .genanki/.test(r.stderr || "") ? " — fix: pip3 install genanki" : "";
    return { ok: false, message: `python failed${hint}: ${(r.stderr || r.stdout || "").split("\n").slice(-3).join(" ")}` };
  }
  return { ok: true, message: (r.stdout || "").trim() };
}
