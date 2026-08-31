import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface AudioConfig {
  dir: string;          // audio cache dir
  cmd: string[] | null; // argv template: ["say","-v","Anna","-o","{out}","{text}"] style; {text} {out} placeholders
  ext: string;          // final audio extension
}

// Backend detection order: LERNFLOW_TTS_CMD env, macOS say(+afconvert->m4a), espeak-ng, piper.
export function detectTTS(env: NodeJS.ProcessEnv = process.env): AudioConfig | null {
  const dir = ".lernflow/audio";
  if (env.LERNFLOW_TTS_CMD) {
    return { dir, cmd: env.LERNFLOW_TTS_CMD.split(/\s+/), ext: env.LERNFLOW_TTS_EXT || "mp3" };
  }
  if (process.platform === "darwin") {
    try {
      execFileSync("which", ["say"]); execFileSync("which", ["afconvert"]);
      return { dir, cmd: ["__mac__"], ext: "m4a" };
    } catch { /* fall through */ }
  }
  try { execFileSync("which", ["espeak-ng"]); return { dir, cmd: ["espeak-ng", "-v", "de", "-w", "{out}", "{text}"], ext: "wav" }; } catch { /* next */ }
  try { execFileSync("which", ["piper"]); return { dir, cmd: ["__piper__"], ext: "wav" }; } catch { return null; }
}

export function audioPath(cfg: AudioConfig, key: string): string {
  return join(cfg.dir, key.replace(/[\\/:*?"<>|[\]]/g, "_").slice(0, 60) + "." + cfg.ext);
}

// Generate one clip. Returns path or null (skip on failure, never throw).
export function tts(cfg: AudioConfig, text: string, key: string): string | null {
  const out = audioPath(cfg, key);
  if (existsSync(out)) return out;
  mkdirSync(cfg.dir, { recursive: true });
  const safe = text.replace(/[\n\r]+/g, " ").slice(0, 240);
  try {
    if (cfg.cmd![0] === "__mac__") {
      const aiff = out + ".aiff";
      execFileSync("say", ["-v", "Anna", "-o", aiff, safe]);
      execFileSync("afconvert", ["-f", "m4af", "-d", "aac", aiff, out]);
      try { rmSync(aiff); } catch { /* ignore */ }
    } else if (cfg.cmd![0] === "__piper__") {
      execFileSync("bash", ["-c", `echo ${JSON.stringify(safe)} | piper -m ~/piper/$(ls ~/piper | head -1) -f ${out}`], { timeout: 30000, stdio: "ignore" });
    } else {
      const argv = cfg.cmd!.flatMap(a => a === "{out}" ? [out] : a === "{text}" ? [safe] : [a]);
      execFileSync(argv[0], argv.slice(1), { timeout: 30000, stdio: "ignore" });
    }
    return existsSync(out) ? out : null;
  } catch { return null; }
}

// Manifest so genanki knows audio key -> media filename mapping.
export interface AudioManifest { [key: string]: string }
export function loadManifest(cfg: AudioConfig): AudioManifest {
  const p = join(cfg.dir, "manifest.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}
export function saveManifest(cfg: AudioConfig, m: AudioManifest) {
  mkdirSync(cfg.dir, { recursive: true });
  writeFileSync(join(cfg.dir, "manifest.json"), JSON.stringify(m, null, 1));
}
