// Grammar drill generator: AI cloze/translation drills per item (cached in
// .lernflow/grammar-drills.json) with an offline template fallback so the
// pipeline never dies. Prompt/parse pattern mirrors translate.ts (SSE-tolerant).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { aiConfigFromEnv, extractContent, parseJsonObj, type AiConfig } from "./translate.js";
import { gapExample, buildTSV, type TsvRow } from "./apkg.js";
import type { GrammarItem, GrammarBank } from "./grammar-bank.js";

export interface DrillResult {
  cloze: string;      // sentence with the target masked as ___
  question: string;   // learner prompt
  answer: string;     // correct answer
  hint?: string;
  explanation?: string;
}

export interface DrillSet {
  cloze: DrillResult[];
  translation: string; // EN -> DE translation prompt for the item
}

export type DrillCache = Record<string, DrillSet>;
export const DRILL_CACHE_FILE = "grammar-drills.json";
export const DRILL_TAG = "Grammatik";
export const GAP = "___";

export function drillCachePath(dir = ".lernflow"): string {
  return join(dir, DRILL_CACHE_FILE);
}

export function loadDrillCache(dir = ".lernflow"): DrillCache {
  const p = drillCachePath(dir);
  if (!existsSync(p)) return {};
  try {
    const o = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
    return o as DrillCache;
  } catch { return {}; }
}

export function saveDrillCache(cache: DrillCache, dir = ".lernflow"): string {
  mkdirSync(dir, { recursive: true });
  const p = drillCachePath(dir);
  writeFileSync(p, JSON.stringify(cache));
  return p;
}

// Strip "(+Akk)"/"(+Dat)"/etc. so "(+Akk)" is never the cloze answer.
export function plainTerm(item: GrammarItem): string {
  return item.term.replace(/\s*\([^)]*\)/g, "").trim();
}

// One chat call per item; strict JSON {cloze:[...], translation:"..."}.
function drillPrompt(item: GrammarItem, cfg: AiConfig): string {
  const term = plainTerm(item);
  const pos = item.pos ? ` (part of speech: ${item.pos})` : "";
  const forms = item.forms ? `\nCorrect forms: ${item.forms}` : "";
  const dis = item.disambiguationHint ? `\nMeaning/usage: ${item.disambiguationHint}` : "";
  const ex = item.examples?.length ? `\nAuthentic examples:\n${item.examples.map(e => `  - ${e}`).join("\n")}` : "";
  return (
    `You are a telc/Goethe B1 ${cfg.langName} exam trainer. For the ${cfg.langName} grammar item ` +
    `"${term}"${pos} at level B1, generate 3-5 Lückensatz (cloze) drills where the learner must ` +
    `inflect or use the target item, plus one ${cfg.targetLang}-to-${cfg.langName} translation prompt.` +
    forms + dis + ex +
    `\nReturn ONLY a JSON object with exactly these keys: ` +
    `{"cloze": [{"cloze": string (sentence with the target masked as ___ and a short hint in parentheses), ` +
    `"question": string (instruction), "answer": string (exact correct answer), ` +
    `"hint"?: string, "explanation"?: string}], "translation": string (an English sentence the learner must translate, using the target item)}. ` +
    `Every cloze must contain ___ exactly once and the answer must be exactly what fits the gap. ` +
    `No markdown, no code fences, no commentary.`
  );
}

// AI call for one item. Lenient parse (parseJsonObj strips stray prose).
// Never throws on AI failure — callers fall back to templates.
export async function generateDrills(item: GrammarItem, cfg?: AiConfig): Promise<DrillSet | null> {
  const c = cfg ?? aiConfigFromEnv(".");
  let res: Response;
  try {
    res = await fetch(c.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify({
        model: c.model, stream: false, temperature: 0.3, max_tokens: 1024,
        messages: [
          { role: "system", content: "You are a German B1 grammar drill writer. Output ONLY strict JSON matching the requested shape." },
          { role: "user", content: drillPrompt(item, c) },
        ],
      }),
    });
  } catch { return null; }
  if (!res.ok) return null;
  let content: string | null = null;
  try { content = extractContent(await res.text()); } catch { return null; }
  if (!content) return null;
  const got = parseJsonObj(content);
  if (!got) return null;
  const raw = (got as Record<string, unknown>).cloze;
  const cloze: DrillResult[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (typeof r !== "object" || r === null) continue;
      const rr = r as Record<string, unknown>;
      if (typeof rr.cloze !== "string" || typeof rr.question !== "string" || typeof rr.answer !== "string") continue;
      const d: DrillResult = { cloze: rr.cloze, question: rr.question, answer: rr.answer };
      if (typeof rr.hint === "string") d.hint = rr.hint;
      if (typeof rr.explanation === "string") d.explanation = rr.explanation;
      if (d.cloze.includes(GAP) && d.answer.trim()) cloze.push(d);
    }
  }
  const translation = typeof got.translation === "string" ? got.translation.trim() : "";
  if (!cloze.length && !translation) return null;
  return { cloze: cloze.slice(0, 5), translation };
}

// Offline template drills: gap-mask the item term in its examples, or build a
// substitution frame from the term itself. Zero AI, never fails.
export function templateDrills(item: GrammarItem): DrillSet {
  const term = plainTerm(item);
  const note = item.forms || item.disambiguationHint || `Verwenden Sie: ${term}`;
  const cloze: DrillResult[] = [];
  for (const ex of item.examples ?? []) {
    const gap = gapExample(ex, term);
    if (gap) {
      cloze.push({ cloze: gap, question: `Ergänzen Sie: ${gap} (${term})`, answer: term, explanation: note });
    } else {
      // term not present in the example: mask the first word so the learner
      // reconstructs the sentence (substitution drill around the target item)
      const m = ex.match(/\S+/);
      const first = m ? m[0] : "";
      cloze.push({
        cloze: first ? ex.replace(first, GAP) : ex,
        question: `Ergänzen Sie das erste Wort: ${first ? ex.replace(first, GAP) : ex} (${term})`,
        answer: first || term,
        explanation: note,
      });
    }
  }
  if (!cloze.length) {
    cloze.push({
      cloze: `${term} ${GAP} ${term}.`,
      question: `Bilden Sie einen Satz mit: ${term}`,
      answer: term,
      explanation: note,
    });
  }
  return {
    cloze: cloze.slice(0, 4),
    translation: `Übersetzen Sie auf Deutsch mit "${term}": ${item.disambiguationHint ?? term}`,
  };
}

// One cached DrillSet per item id: cache hit -> use; else AI -> fallback.
// Cache is written through so later runs are offline.
export async function drillsForItem(
  item: GrammarItem,
  cache: DrillCache,
  cfg: AiConfig,
  opts: { noAi?: boolean } = {},
): Promise<{ set: DrillSet; fromAi: boolean }> {
  if (cache[item.id]) return { set: cache[item.id], fromAi: false };
  if (!opts.noAi) {
    const ai = await generateDrills(item, cfg);
    if (ai) {
      cache[item.id] = ai;
      return { set: ai, fromAi: true };
    }
  }
  const t = templateDrills(item);
  cache[item.id] = t;
  return { set: t, fromAi: false };
}

export interface GrammarDeckRow extends TsvRow {
  gap: string; // masked sentence for the gap card
}

// Deck rows compatible with buildTSV/writeApkg; gap cards use drill sentences.
export function bankToRows(bank: GrammarBank, cache: DrillCache): GrammarDeckRow[] {
  const rows: GrammarDeckRow[] = [];
  for (const cat of bank.categories) {
    for (const item of cat.items) {
      const set = cache[item.id];
      if (!set) continue;
      const term = plainTerm(item);
      const label = item.term;
      const back = set.translation ? `${label} — ${set.translation}` : label;
      const firstCloze = set.cloze[0]?.cloze ?? `${term} (${cat.name})`;
      const gap = set.cloze.length ? set.cloze[0].cloze : firstCloze;
      const example = item.examples?.[0] ?? firstCloze;
      const forms = [item.forms, item.disambiguationHint].filter(Boolean).join(" | ");
      rows.push({
        lemma: label,
        gender: "",
        translation: back,
        forms,
        example,
        pos: item.pos,
        gap,
      });
    }
  }
  return rows;
}

export function grammarDeckName(level: string): string {
  return `Grammatik ${level}`;
}
