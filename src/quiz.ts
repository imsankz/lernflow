import type { TsvRow } from "./apkg.js";
import { gapExample } from "./apkg.js";

// Deterministic daily quiz — no AI, works offline, pairs with the TSV deck.
const KINDS = ["de_en", "en_de", "gender", "gap"] as const;
export type Kind = (typeof KINDS)[number];

export interface Question { kind: Kind; q: string; a: string; }

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeQuiz(rows: TsvRow[], n = 8, seed = 1): Question[] {
  const rnd = mulberry32(seed);
  const pool = rows.slice();
  const out: Question[] = [];
  for (let i = 0; pool.length && out.length < n; i++) {
    const r = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const kind = KINDS[i % 4];
    if (kind === "de_en") {
      out.push({ kind, q: `Übersetzen: ${r.lemma}${r.gender ? ` (${r.gender})` : ""}`, a: r.translation });
    } else if (kind === "en_de") {
      out.push({ kind, q: `Wie heißt '${r.translation}' auf Deutsch?`, a: r.lemma + (r.gender ? ` (${r.gender})` : "") });
    } else if (kind === "gender" && r.gender) {
      out.push({ kind, q: `Welcher Artikel? ___ ${r.lemma}`, a: r.gender });
    } else {
      const gap = r.example ? gapExample(r.example, r.lemma) : null;
      if (gap) out.push({ kind: "gap", q: gap, a: r.lemma });
      else out.push({ kind: "de_en", q: `Bilden Sie einen Satz mit: ${r.lemma}`, a: r.example || r.translation });
    }
  }
  return out;
}

export function renderQuiz(qs: Question[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`# LernFlow quiz — ${date}`, ""];
  qs.forEach((q, i) => lines.push(`${i + 1}. ${q.q}`));
  lines.push("", "## Antworten", "");
  qs.forEach((q, i) => lines.push(`${i + 1}. ${q.a}`));
  return lines.join("\n") + "\n";
}
