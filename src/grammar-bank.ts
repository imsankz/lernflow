// Grammar item-bank loader: YAML/JSON banks -> validated GrammarBank.
// Modeled on NikKosmo/german-learning's exam_items.yaml item mechanism.
// B1 bank ships at data/banks/b1-telc.yaml; --no-ai runs offline from examples.

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { load as yamlLoad } from "js-yaml";

export interface GrammarItem {
  id: string;
  category: string;
  term: string;
  pos?: string;
  disambiguationHint?: string;
  forms?: string;
  examples?: string[];
}

export interface GrammarCategory {
  name: string;
  description?: string;
  items: GrammarItem[];
}

export type Level = "A1" | "A2" | "B1" | "B2";

export interface GrammarBank {
  level: Level;
  categories: GrammarCategory[];
}

export const LEVELS: readonly Level[] = ["A1", "A2", "B1", "B2"];

export function isLevel(x: unknown): x is Level {
  return typeof x === "string" && (LEVELS as readonly string[]).includes(x);
}

// picky normalization of the untrusted shape: strings must be strings,
// ids unique, items in categories; anything else is dropped.
export function validateBank(raw: unknown): GrammarBank | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isLevel(o.level)) return null;
  if (!Array.isArray(o.categories)) return null;
  const categories: GrammarCategory[] = [];
  const ids = new Set<string>();
  let ok = true;
  for (const c of o.categories) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) { ok = false; continue; }
    const cc = c as Record<string, unknown>;
    if (typeof cc.name !== "string" || !cc.name.trim()) { ok = false; continue; }
    if (!Array.isArray(cc.items)) { ok = false; continue; }
    const items: GrammarItem[] = [];
    for (const it of cc.items) {
      if (typeof it !== "object" || it === null || Array.isArray(it)) { ok = false; continue; }
      const ii = it as Record<string, unknown>;
      if (typeof ii.id !== "string" || !ii.id.trim()) { ok = false; continue; }
      if (typeof ii.term !== "string" || !ii.term.trim()) { ok = false; continue; }
      if (typeof ii.category !== "string") { ok = false; continue; }
      if (ids.has(ii.id)) { ok = false; continue; }
      ids.add(ii.id);
      const item: GrammarItem = { id: ii.id, category: ii.category, term: ii.term.trim() };
      if (typeof ii.pos === "string") item.pos = ii.pos;
      if (typeof ii.disambiguationHint === "string") item.disambiguationHint = ii.disambiguationHint;
      if (typeof ii.forms === "string") item.forms = ii.forms;
      if (typeof ii.examples === "string" && ii.examples.trim()) item.examples = [ii.examples.trim()];
      else if (Array.isArray(ii.examples)) {
        const ex = ii.examples.filter((e): e is string => typeof e === "string" && !!e.trim()).map(e => e.trim());
        if (ex.length) item.examples = ex;
      }
      items.push(item);
    }
    if (items.length) {
      categories.push({ name: cc.name.trim(), items, ...(typeof cc.description === "string" ? { description: cc.description } : {}) });
    }
  }
  return ok ? { level: o.level, categories } : null;
}

// YAML source banks; JSON banks are accepted too (validateBank shape identical).
export function loadBankFile(path: string): GrammarBank {
  if (!existsSync(path)) throw new Error(`bank not found: ${path}`);
  const text = readFileSync(path, "utf8");
  const ext = extname(path).toLowerCase();
  let raw: unknown;
  if (ext === ".json") {
    try { raw = JSON.parse(text); } catch { throw new Error(`bank ${path}: invalid JSON`); }
  } else if (ext === ".yaml" || ext === ".yml") {
    try { raw = yamlLoad(text); } catch (e) { throw new Error(`bank ${path}: invalid YAML: ${(e as Error).message}`); }
  } else {
    throw new Error(`bank ${path}: unsupported extension (use .yaml/.yml/.json)`);
  }
  const bank = validateBank(raw);
  if (!bank) throw new Error(`bank ${path}: schema violation (level + categories[].name/items[].id/term required, ids unique)`);
  return bank;
}

export function allItems(bank: GrammarBank): GrammarItem[] {
  return bank.categories.flatMap(c => c.items);
}

export function itemCount(bank: GrammarBank): number {
  return allItems(bank).length;
}
