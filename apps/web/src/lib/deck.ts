export interface Row {
  lemma: string;
  gender: string;
  translation: string;
  forms: string;
  example: string;
  pos?: string;
  audio?: string;
}

export interface DeckMeta {
  name: string;
  rows: Row[];
}

// Anki-importable TSV: DE | EN(gender) | example, #separator:tab header.
export function buildTSV(rows: Row[], deckName: string, tag = "lernflow"): string {
  const esc = (s: string) => s.replace(/[\t\n\r]/g, " ");
  const head = `#separator:tab\n#html:false\n#tags column:6\n#deck:${deckName.replace(/[\t\n]/g, " ")}\n`;
  const body = rows.map((r) => {
    const de = r.gender ? `${r.lemma} (${r.gender})` : r.lemma;
    return [esc(de), esc(r.translation), esc(r.example), esc(r.forms), "", esc(tag)].join("\t");
  });
  return head + body.join("\n") + "\n";
}

export function gapExample(example: string, lemma: string): string | null {
  const m = example.match(new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`, "i"));
  if (!m || m.index === undefined) return null;
  return example.slice(0, m.index) + "___" + example.slice(m.index + m[0].length);
}
