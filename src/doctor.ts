// `lernflow doctor` — environment + repo health check, zero side effects.
// Verifies the pieces the pipeline depends on (Node, python3/genanki, TTS
// backend, .env.local, grammar banks) and prints a pass/warn/fail report.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectTTS } from "./audio.js";
import { loadBankFile } from "./grammar-bank.js";
import { aiConfigFromEnv } from "./translate.js";

export type CheckLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  level: CheckLevel;
  detail: string;
}

function nodeCheck(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) return { name: "node", level: "ok", detail: `v${process.versions.node}` };
  return { name: "node", level: "fail", detail: `v${process.versions.node} — lernflow needs Node >=18` };
}

function envCheck(cwd: string): DoctorCheck {
  const p = join(cwd, ".env.local");
  if (!existsSync(p)) return { name: ".env.local", level: "warn", detail: "not found — run `lernflow init` (only needed for --audio-free AI features)" };
  const cfg = aiConfigFromEnv(cwd);
  const hasKey = cfg.apiKey.length > 0;
  return {
    name: ".env.local",
    level: "ok",
    detail: `AI_BASE_URL=${cfg.baseUrl} model=${cfg.model}${hasKey ? "" : " (no AI_API_KEY set — fine for local/no-auth endpoints)"}`,
  };
}

function pythonCheck(): DoctorCheck {
  const candidates = [process.env.LERNFLOW_PYTHON, "python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].filter(Boolean) as string[];
  for (const p of candidates) {
    const v = spawnSync(p, ["--version"], { encoding: "utf8" });
    if (v.status === 0) {
      const gk = spawnSync(p, ["-c", "import genanki"], { encoding: "utf8" });
      if (gk.status === 0) {
        return { name: "python3 + genanki", level: "ok", detail: `${p} (${(v.stdout || v.stderr).trim()}) — .apkg export available` };
      }
      return { name: "python3 + genanki", level: "warn", detail: `${p} found but genanki missing — pip3 install genanki (needed for --apkg)` };
    }
  }
  return { name: "python3 + genanki", level: "warn", detail: "python3 not found — --apkg export will be skipped" };
}

function ttsCheck(): DoctorCheck {
  const cfg = detectTTS();
  if (!cfg) return { name: "TTS backend", level: "warn", detail: "none found (macOS say, espeak-ng, piper, LERNFLOW_TTS_CMD) — --audio will skip" };
  const backend = cfg.cmd![0] === "__mac__" ? "macOS say" : cfg.cmd![0] === "__piper__" ? "piper" : cfg.cmd!.join(" ");
  return { name: "TTS backend", level: "ok", detail: `${backend} -> .${cfg.ext}` };
}

function banksCheck(cwd: string): DoctorCheck {
  const dir = join(cwd, "data", "banks");
  if (!existsSync(dir)) return { name: "grammar banks", level: "warn", detail: "data/banks/ not found" };
  const files = readdirSync(dir).filter((f) => /\.(ya?ml|json)$/i.test(f));
  if (!files.length) return { name: "grammar banks", level: "warn", detail: "data/banks/ has no .yaml/.json banks" };
  const problems: string[] = [];
  let items = 0;
  for (const f of files) {
    try {
      const bank = loadBankFile(join(dir, f));
      items += bank.categories.reduce((n, c) => n + c.items.length, 0);
    } catch (e) {
      problems.push(`${f}: ${(e as Error).message}`);
    }
  }
  if (problems.length) return { name: "grammar banks", level: "fail", detail: problems.join("; ") };
  return { name: "grammar banks", level: "ok", detail: `${files.length} bank(s), ${items} items` };
}

function dataDirCheck(cwd: string): DoctorCheck {
  const dir = join(cwd, ".lernflow");
  if (!existsSync(dir)) return { name: ".lernflow/ cache", level: "warn", detail: "not created yet — first `build`/`grammar` run will create it" };
  let size = 0;
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else size += (() => { try { return readFileSync(p).length; } catch { return 0; } })();
    }
  };
  walk(dir);
  return { name: ".lernflow/ cache", level: "ok", detail: `${(size / 1024).toFixed(0)} KiB on disk` };
}

export function runDoctor(cwd = "."): DoctorCheck[] {
  return [nodeCheck(), envCheck(cwd), pythonCheck(), ttsCheck(), banksCheck(cwd), dataDirCheck(cwd)];
}

const ICON: Record<CheckLevel, string> = { ok: "✓", warn: "!", fail: "✗" };

export function renderDoctor(checks: DoctorCheck[]): string {
  const lines = checks.map((c) => `  ${ICON[c.level]} ${c.name.padEnd(20)} ${c.detail}`);
  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const summary =
    fails > 0
      ? `${fails} failing check(s) — fix before running build/grammar`
      : warns > 0
        ? `${warns} warning(s) — lernflow will still work, some features may be skipped`
        : "all checks passed";
  return `lernflow doctor\n\n${lines.join("\n")}\n\n${summary}\n`;
}
