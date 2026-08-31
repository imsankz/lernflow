export interface Parsed { lemma: string; gender: string; forms: string; }

// Parse a dictionary-style headword entry. Tuned for German (articles, separable verbs)
// but tolerant: other languages just come through with empty gender/forms.
export function parseEntry(entry: string): Parsed {
  const clean = entry.replace(/\s+/g, " ").trim();
  const art = clean.match(/^(der|die|das)\s+(\S+)/i);
  if (art) return { lemma: art[2].replace(/[,-].*$/, ""), gender: art[1].toLowerCase(), forms: afterFirstComma(clean) };
  if (/\(Pl\.?\)/i.test(clean)) return { lemma: clean.split(/[ ,/(]/)[0], gender: "Pl.", forms: afterFirstComma(clean) };
  const m = clean.match(/^([A-Za-zÄÖÜäöüßÀ-ÿ][\w'\-À-ÿ]*)/);
  return { lemma: m ? m[1] : clean.split(",")[0].trim(), gender: "", forms: afterFirstComma(clean) };
}

function afterFirstComma(s: string): string {
  const i = s.indexOf(",");
  return i < 0 ? "" : s.slice(i + 1).replace(/\s+/g, " ").trim();
}

// Strip leading "1. " numbering and join example lines.
export function cleanExamples(ex: string): string {
  return ex.replace(/\s*\n\s*/g, " ").replace(/^\s*\d+\.\s*/, "").trim();
}
