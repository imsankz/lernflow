// `lernflow banks-to-decks` — convert data/banks/*.yaml grammar item-banks into
// bundled lernweb JSON decks (apps/web/public/decks/*.json), offline/deterministic
// (uses templateDrills, no AI calls) so it can run in CI on every push.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { loadBankFile, allItems, type GrammarBank } from "./grammar-bank.js";
import { templateDrills, plainTerm, GAP } from "./grammar.js";

export interface WebDeckRow {
  lemma: string;
  gender: string;
  translation: string;
  forms: string;
  example: string;
  pos: string | null;
  gap: string | null;
  audio: string | null;
}

// Deterministic, AI-free conversion: one row per bank item using the first
// offline template cloze as the gap sentence (same fallback `grammar --no-ai` uses).
export function bankToWebRows(bank: GrammarBank): WebDeckRow[] {
  const rows: WebDeckRow[] = [];
  for (const item of allItems(bank)) {
    const drills = templateDrills(item);
    const term = plainTerm(item);
    const cloze = drills.cloze[0];
    const gap = cloze?.cloze?.includes(GAP) ? cloze.cloze : null;
    const example = item.examples?.[0] ?? cloze?.cloze ?? term;
    rows.push({
      lemma: item.term,
      gender: "",
      translation: drills.translation ? `${item.term} — ${drills.translation}` : item.term,
      forms: [item.forms, item.disambiguationHint].filter(Boolean).join(" | "),
      example,
      pos: item.pos ?? "Redemittel",
      gap,
      audio: null,
    });
  }
  return rows;
}

export interface BankToDeckSpec {
  file: string;   // relative to banksDir
  outName: string; // output file basename (without .json)
  deckLabel: string; // human label for BUNDLED UI lists
}

// Default mapping: the 4 banks lernflow ships -> Grammatik A1/A2/B1 + Redemittel B1.
export const DEFAULT_BANK_SPECS: BankToDeckSpec[] = [
  { file: "a1-grundlagen.yaml", outName: "grammatik-a1", deckLabel: "Grammatik A1" },
  { file: "a2-aufbau.yaml", outName: "grammatik-a2", deckLabel: "Grammatik A2" },
  { file: "b1-telc.yaml", outName: "grammatik-b1", deckLabel: "Grammatik B1" },
  { file: "b1-redemittel.yaml", outName: "redemittel-b1", deckLabel: "Redemittel B1" },
];

export interface ConvertResult {
  spec: BankToDeckSpec;
  rows: number;
  outPath: string;
}

export function convertBanks(
  banksDir: string,
  outDir: string,
  specs: BankToDeckSpec[] = DEFAULT_BANK_SPECS,
): ConvertResult[] {
  mkdirSync(outDir, { recursive: true });
  const results: ConvertResult[] = [];
  for (const spec of specs) {
    const p = join(banksDir, spec.file);
    if (!existsSync(p)) continue;
    const bank = loadBankFile(p);
    const rows = bankToWebRows(bank);
    const outPath = join(outDir, `${spec.outName}.json`);
    writeFileSync(outPath, JSON.stringify(rows));
    results.push({ spec, rows: rows.length, outPath });
  }
  return results;
}

// Convert every bank found in banksDir, not just the known specs (useful for
// community-contributed language wings that add new bank files).
export function convertAllBanks(banksDir: string, outDir: string): ConvertResult[] {
  if (!existsSync(banksDir)) return [];
  const known = new Set(DEFAULT_BANK_SPECS.map((s) => s.file));
  const extra: BankToDeckSpec[] = readdirSync(banksDir)
    .filter((f) => /\.(ya?ml|json)$/i.test(f) && !known.has(f))
    .map((f) => {
      const base = basename(f, extname(f));
      return { file: f, outName: base, deckLabel: base };
    });
  return convertBanks(banksDir, outDir, [...DEFAULT_BANK_SPECS, ...extra]);
}
