import { gapExample } from "./deck";
import type { Row } from "./deck";

export interface DeckRow extends Row {
  gap: string | null;
}

export function toDeckRows(rows: Row[]): DeckRow[] {
  return rows.map((r) => ({ ...r, gap: gapExample(r.example, r.lemma) ?? null }));
}

export function isGapCard(row: DeckRow): boolean {
  return row.gap !== null;
}

export function buildGap(row: DeckRow, answer: string): string {
  if (row.gap === null) return row.example;
  const filled = row.gap.replace("___", answer.trim() || "___");
  return `${filled} ${row.gap.includes("___") ? "" : ""}`.trim();
}
