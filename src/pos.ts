// Strict word-type enum (pattern borrowed from german-learning's word_types.py idea) +
// validation gates for deck rows: POS, gender consistency, translation sanity.

export const WORD_TYPES = [
  "Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction", "Article",
  "Pronoun", "Particle", "Possessive", "Question Word", "Adjective/Adverb",
] as const;
export type WordType = (typeof WORD_TYPES)[number];

export function isValidType(s: string): s is WordType {
  return (WORD_TYPES as readonly string[]).includes(s);
}

export interface DeckRow { lemma: string; gender: string; translation: string; forms?: string; example?: string; pos?: string; }

export interface Issue { level: "error" | "warn"; index: number; lemma: string; msg: string; }

export function auditDeck(rows: DeckRow[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = r.lemma.toLowerCase();
    if (seen.has(key)) issues.push({ level: "warn", index: i, lemma: r.lemma, msg: `duplicate of row ${seen.get(key)}` });
    else seen.set(key, i);
    if (!r.translation?.trim()) issues.push({ level: "error", index: i, lemma: r.lemma, msg: "missing translation" });
    if (r.translation && /```|\{.*\}|<\|/.test(r.translation)) issues.push({ level: "error", index: i, lemma: r.lemma, msg: "garbage translation" });
    if (r.pos && !isValidType(r.pos)) issues.push({ level: "error", index: i, lemma: r.lemma, msg: `invalid POS '${r.pos}'` });
    if (r.gender && !["der", "die", "das", "Pl."].includes(r.gender)) issues.push({ level: "error", index: i, lemma: r.lemma, msg: `invalid gender '${r.gender}'` });
    if (r.lemma.match(/^(der|die|das)\s/) && !r.gender) issues.push({ level: "warn", index: i, lemma: r.lemma, msg: "article inside lemma, gender empty" });
  });
  return issues;
}
