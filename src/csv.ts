// Minimal CSV reader: quoted fields, \n inside quotes, , or ; or tab delimiter.
export interface WordRow { entry: string; examples: string; }

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  const d = detectDelim(text);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === d) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.trim())).filter(r => r.some(f => f));
}

export function detectDelim(text: string): string {
  const l1 = (text.split("\n")[0] || "");
  const counts: Record<string, number> = { ",": (l1.match(/,/g) || []).length, ";": (l1.match(/;/g) || []).length, "\t": (l1.match(/\t/g) || []).length };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}

// Map a parsed CSV into word rows. col=0-based term column, ex=examples column (-1 = none).
// Skips header lines that don't look like entries (non-alphanumeric-start heuristics kept lenient).
export function toWordRows(rows: string[][], col = 0, ex = 1): WordRow[] {
  const out: WordRow[] = [];
  for (const r of rows) {
    const entry = (r[col] || "").trim();
    if (!entry) continue;
    if (/[A-Za-zÄÖÜäöüß]/.test(entry) === false) continue;
    // header heuristic: row where field0 is ALL CAPS-ish label or contains 'wort'/'word'/'entry' and row1 also label-like
    if (/^(entry|word|lemma|wort|vokabel|term)$/i.test(entry)) continue;
    out.push({ entry, examples: ex >= 0 ? (r[ex] || "").trim() : "" });
  }
  return out;
}

export function tsvEscape(s: string): string {
  return s.replace(/\t/g, " ").replace(/\n/g, "<br>");
}
