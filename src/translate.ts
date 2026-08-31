import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface AiConfig {
  baseUrl: string;   // OpenAI-compatible, e.g. http://192.168.0.254:20128/v1
  apiKey: string;
  model: string;     // e.g. auto/best-free
  batch: number;     // lemmas per request
  maxCallsPerRun: number;
  langName: string;  // human label used in the prompt, e.g. "German"
  targetLang: string; // e.g. "English"
}

export function aiConfigFromEnv(dataDir: string): AiConfig {
  const env = loadEnvLocal(dataDir);
  return {
    baseUrl: (env.AI_BASE_URL || process.env.AI_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, ""),
    apiKey: env.AI_API_KEY || process.env.AI_API_KEY || "",
    model: env.AI_MODEL || process.env.AI_MODEL || "auto/best-free",
    batch: Number(env.LERNFLOW_BATCH || 40),
    maxCallsPerRun: Number(env.LERNFLOW_MAX_CALLS || 200),
    langName: env.LERNFLOW_LANG || "German",
    targetLang: env.LERNFLOW_TARGET_LANG || "English",
  };
}

function loadEnvLocal(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const p = join(dir, ".env.local");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
      if (m) out[m[1]] = m[2].trim();
    }
  }
  return out;
}

// Parse OpenAI-style JSON OR SSE (data: {...}) — OmniRoute returns SSE even with stream:false.
export function extractContent(body: string): string | null {
  try {
    const j = JSON.parse(body);
    const c = j?.choices?.[0]?.message?.content;
    if (typeof c === "string") return c;
  } catch { /* fall through */ }
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (s.startsWith("data:") && !s.includes("[DONE]")) {
      try {
        const d = JSON.parse(s.slice(5).trim());
        const c = d?.choices?.[0]?.message?.content;
        if (typeof c === "string" && c) return c;
      } catch { /* ignore chunk */ }
    }
  }
  return null;
}

export function parseJsonObj(text: string): Record<string, string> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v.trim();
    return out;
  } catch { return null; }
}

export async function translateBatch(lemmas: string[], cfg: AiConfig, signal?: AbortSignal): Promise<Record<string, string>> {
  const prompt =
    `Translate these ${cfg.langName} headwords to their primary ${cfg.targetLang} meaning for a learner. ` +
    "Return ONLY a JSON object mapping each input exactly to its translation (1-4 words). No markdown, no notes.\n\n" +
    JSON.stringify(lemmas);
  const res = await fetch(cfg.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, stream: false, temperature: 0.1, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
    signal,
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const content = extractContent(await res.text());
  if (!content) throw new Error("AI response had no content");
  const got = parseJsonObj(content);
  if (!got) throw new Error("AI response not JSON-mappable");
  return got;
}

// Cached translator: JSON cache {lemma: translation}. Missing ones go to the AI in batches.
// Graceful: AI unreachable -> leaves gaps, prints notice, never throws for whole-run failure.
export class Translator {
  calls = 0;
  constructor(private cfg: AiConfig, public cache: Record<string, string>) {}

  static loadCache(p: string): Record<string, string> {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  }
  saveCache(p: string) { writeFileSync(p, JSON.stringify(this.cache)); }

  async ensure(lemmas: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const todo = [...new Set(lemmas)].filter(l => !this.cache[l]);
    if (!todo.length) return;
    for (let i = 0; i < todo.length && this.calls < this.cfg.maxCallsPerRun; i += this.cfg.batch) {
      const chunk = todo.slice(i, i + this.cfg.batch);
      try {
        const got = await translateBatch(chunk, this.cfg);
        for (const k of chunk) if (got[k]) this.cache[k] = got[k];
        this.calls++;
      } catch (e) {
        console.error(`  ! batch at ${i} failed: ${(e as Error).message} (continuing)`);
        this.calls++; // failed calls count too — budget guard
      }
      onProgress?.(Math.min(i + this.cfg.batch, todo.length), todo.length);
    }
    const stillMissing = todo.filter(l => !this.cache[l]).length;
    if (stillMissing) console.error(`  note: ${stillMissing} lemmas untranslated (AI budget/availability) — cards without translation are skipped in output`);
  }
}
