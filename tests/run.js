import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, toWordRows, detectDelim } from "../dist/csv.js";
import { parseEntry, cleanExamples } from "../dist/lemma.js";
import { extractContent, parseJsonObj } from "../dist/translate.js";
import { buildTSV, gapExample } from "../dist/apkg.js";
import { makeQuiz, renderQuiz } from "../dist/quiz.js";
import { auditDeck, isValidType } from "../dist/pos.js";

test("csv: quoted fields with embedded newline + delimiter", () => {
  const rows = parseCSV('a,"1. one\n2. two",c\nb;still b;d\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], "1. one\n2. two");
});
test("csv: semicolon detection", () => {
  assert.equal(detectDelim("a;b;c\n1;2;3"), ";");
});
test("wordrows: header skipped, blank skipped", () => {
  const w = toWordRows([["Wort", "Beispiel"], ["das Haus", "Das Haus ist groß."], ["", ""]]);
  assert.equal(w.length, 1);
  assert.equal(w[0].entry, "das Haus");
});
test("lemma: noun with article + gender", () => {
  const p = parseEntry("die Beziehung, -en");
  assert.deepEqual([p.lemma, p.gender], ["Beziehung", "die"]);
});
test("lemma: separable verb keeps forms", () => {
  const p = parseEntry("abbiegen, biegt ab, bog ab, ist abgebogen");
  assert.equal(p.lemma, "abbiegen");
  assert.match(p.forms, /bog ab/);
});
test("lemma: plural marker", () => {
  assert.equal(parseEntry("Abgase (Pl.)").gender, "Pl.");
});
test("examples: strip leading numbering", () => {
  assert.equal(cleanExamples("1. Hallo\n   2. Tschüss"), "Hallo 2. Tschüss");
});
test("SSE parsing: data: lines with stream:false quirk", () => {
  const sse = 'data: {"choices":[{"message":{"content":"{\\"a\\":\\"x\\"}"}}]}\n\ndata: [DONE]\n';
  assert.equal(extractContent(sse), '{"a":"x"}');
  assert.deepEqual(parseJsonObj(extractContent(sse)), { a: "x" });
});
test("plain JSON parsing", () => {
  const j = JSON.stringify({ choices: [{ message: { content: "hi" } }] });
  assert.equal(extractContent(j), "hi");
});
test("tsv: header + escaping", () => {
  const t = buildTSV([{ lemma: "Haus", gender: "das", translation: "house", forms: "", example: "a\tb\nc" }], "D");
  assert.match(t, /^#separator:tab/);
  assert.match(t, /Haus \(das\)\thouse\ta b c/);
  assert.equal(t.split("\n")[4], ["Haus (das)", "house", "a b c", "", "", "lernflow"].join("\t"));
});
test("gap: masks lemma in example", () => {
  const g = gapExample("Das Haus ist schön.", "Haus");
  assert.equal(g, "Das ___ ist schön.");
  assert.equal(gapExample("keins da", "Haus"), null);
});
test("audit: catches garbage translation", () => {
  const rows = [
    { lemma: "Haus", gender: "das", translation: "house", forms: "", example: "" },
    { lemma: "haus", gender: "", translation: "```json", forms: "", example: "" },
  ];
  const errs = auditDeck(rows).filter(x => x.level === "error");
  assert.ok(errs.some(e => /garbage/.test(e.msg)));
});
test("pos: valid types only", () => {
  assert.ok(isValidType("Noun"));
  assert.ok(!isValidType("noun"));
});
test("quiz: deterministic by seed, 8 questions", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    lemma: "wort" + i, gender: i % 3 === 0 ? "das" : "", translation: "word" + i, forms: "",
    example: `Das wort${i} ist hier.`,
  }));
  const a = makeQuiz(rows, 8, 42), b = makeQuiz(rows, 8, 42);
  assert.deepEqual(a.map(q => q.q), b.map(q => q.q));
  assert.equal(a.length, 8);
  assert.match(renderQuiz(a), /## Antworten/);
});
