import type { DeckRowStored } from "@/store/storage";

export interface ParsedDeck {
  name: string;
  rows: DeckRowStored[];
  warnings: string[];
}

// lernflow rows.json format: [{ lemma, gender, translation, forms, example, pos?, audio? }]
// lenient: also accepts { entry, examples } (goethe-b1 source style).
export function parseRowsJson(text: string, name?: string): ParsedDeck {
  const raw: unknown = JSON.parse(text);
  const warnings: string[] = [];
  if (!Array.isArray(raw)) throw new Error("rows.json must be a JSON array");
  const rows: DeckRowStored[] = raw
    .map((r, i): DeckRowStored | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const lemma = String(o.lemma ?? o.entry ?? "").trim();
      if (!lemma) {
        warnings.push(`row ${i}: missing lemma — skipped`);
        return null;
      }
      let example = String(o.example ?? o.examples ?? "");
      // multi-sentence examples: keep only the first sentence (cleaner gap cards)
      if (o.examples !== undefined && /\n/.test(example)) {
        example = example.split("\n")[0].trim();
      }
      const gender = String(o.gender ?? "");
      const translation = String(o.translation ?? "");
      const forms = String(o.forms ?? "");
      const pos = o.pos !== undefined ? String(o.pos) : undefined;
      const audio = o.audio !== undefined ? String(o.audio) : undefined;
      const out: DeckRowStored = { lemma, gender, translation, forms, example };
      if (pos) out.pos = pos;
      if (audio) out.audio = audio;
      return out;
    })
    .filter((r): r is DeckRowStored => r !== null);
  const deckName = name ?? "Imported deck";
  return { name: deckName, rows, warnings };
}

// Anki-importable TSV: `#separator:tab` header, columns DE | EN(gender) | example | forms | ... | tags
export function parseAnkiTsv(text: string, name?: string): ParsedDeck {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  let separator: "tab" | "semicolon" = "tab";
  let dataStart = 0;
  const warnings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#separator:")) {
      separator = line.slice("#separator:".length).trim().toLowerCase() === "semicolon" ? "semicolon" : "tab";
      dataStart = i + 1;
    } else if (line.startsWith("#")) {
      dataStart = i + 1;
    } else {
      break;
    }
  }
  const sep = separator === "tab" ? "\t" : ";";
  const rows: DeckRowStored[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim());
    if (cols.length < 2 || cols[0] === "") continue;
    // column 1: "lemma (gender)"
    let lemma = cols[0];
    let gender = "";
    const gm = lemma.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (gm) {
      lemma = gm[1].trim();
      gender = gm[2].trim();
    }
    rows.push({
      lemma,
      gender,
      translation: cols[1] ?? "",
      example: cols[2] ?? "",
      forms: cols[3] ?? "",
    });
  }
  if (rows.length === 0) throw new Error("no data rows found in TSV");
  return { name: name ?? "Anki deck", rows, warnings };
}

export async function parseDeckFile(
  file: File,
  fallbackName?: string,
): Promise<ParsedDeck> {
  const text = await file.text();
  const name = fallbackName ?? file.name.replace(/\.(json|tsv|txt)$/i, "");
  if (file.name.toLowerCase().endsWith(".json")) return parseRowsJson(text, name);
  return parseAnkiTsv(text, name);
}
