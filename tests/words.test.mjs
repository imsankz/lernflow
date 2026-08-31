// Standalone tests for the words state machine + ai-templates.
// Run: node tests/words.test.mjs  (exits nonzero on failure)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadState, saveState, addWords, markInDeck, promote, failWord,
  quarantine, unquarantine, stats, listWords, renderTable, validateState,
  statePath, STATUSES, isValidStatus,
} from "../dist/words.js";
import { exampleSentence, grammarDrills, redemittelSet, strictJsonPreamble } from "../dist/ai-templates.js";

const results = { pass: 0, fail: 0 };
const fails = [];
function t(name, fn) {
  try {
    fn();
    results.pass++;
    console.log(`ok - ${name}`);
  } catch (e) {
    results.fail++;
    fails.push({ name, e });
    console.error(`FAIL - ${name}\n  ${e.message}`);
  }
}

function freshDir() {
  const d = mkdtempSync(join(tmpdir(), "lernflow-words-"));
  return d;
}

t("schema: valid state round-trips", () => {
  const state = { Haus: { status: "in_deck", attempts: 0, audio: "Haus.mp3", lastSeen: "2026-01-01T00:00:00.000Z" } };
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
});

t("schema: rejects bad status", () => {
  assert.equal(validateState({ x: { status: "banana", attempts: 0 } }), null);
  assert.equal(validateState({ x: { status: "pending", attempts: "0" } }), null);
  assert.equal(validateState({ x: { status: "pending", attempts: -1 } }), null);
  assert.equal(validateState({ x: { status: "pending", attempts: 0.5 } }), null);
  assert.equal(validateState([]), null);
});

t("statuses: all valid, isValidStatus round-trip", () => {
  for (const s of STATUSES) assert.ok(isValidStatus(s));
  assert.ok(!isValidStatus("foo"));
});

t("add: new word -> pending; re-add leaves status", () => {
  const st = {};
  const r = addWords(st, ["Haus", "  ", "gehen"]);
  assert.deepEqual(r.added, ["Haus", "gehen"]);
  assert.equal(st.Haus.status, "pending");
  assert.equal(st.Haus.attempts, 0);
  const r2 = addWords(st, ["Haus"], "note!");
  assert.deepEqual(r2.existed, ["Haus"]);
  assert.equal(st.Haus.status, "pending");
  assert.equal(st.Haus.notes, "note!");
});

t("add: note attaches on new word", () => {
  const st = {};
  addWords(st, ["Blut"], "medical");
  assert.equal(st.Blut.notes, "medical");
});

t("markInDeck: pending -> in_deck, other statuses untouched", () => {
  const st = {};
  addWords(st, ["Haus", "gehen"]);
  st.gehen.status = "learning";
  const moved = markInDeck(st, ["Haus", "gehen", "missing"]);
  assert.deepEqual(moved, ["Haus"]);
  assert.equal(st.Haus.status, "in_deck");
  assert.equal(st.gehen.status, "learning");
  assert.equal(st.missing, undefined);
});

t("markInDeck: new -> in_deck also moves", () => {
  const st = { alt: { status: "new", attempts: 0 } };
  assert.deepEqual(markInDeck(st, ["alt"]), ["alt"]);
  assert.equal(st.alt.status, "in_deck");
});

t("promote: --from/--to semantics, subset only", () => {
  const st = {};
  addWords(st, ["a", "b", "c"]);
  st.c.status = "in_deck";
  const moved = promote(st, "pending", "in_deck", ["a", "c"]);
  assert.deepEqual(moved, ["a"]);
  assert.equal(st.a.status, "in_deck");
  assert.equal(st.b.status, "pending");
  const all = promote(st, "pending", "learning");
  assert.deepEqual(all, ["b"]);
  assert.equal(st.b.status, "learning");
});

t("fail: first fail -> failed + attempts 1", () => {
  const st = {};
  addWords(st, ["Spiel"]);
  const e = failWord(st, "Spiel", "wrong translation");
  assert.equal(e.status, "failed");
  assert.equal(e.attempts, 1);
  assert.match(e.notes, /wrong translation/);
});

t("fail: twice -> quarantined with reason", () => {
  const st = {};
  addWords(st, ["kein"]);
  failWord(st, "kein", "POS wrong");
  const e = failWord(st, "kein", "still wrong");
  assert.equal(e.status, "quarantined");
  assert.equal(e.attempts, 2);
  assert.match(e.notes, /auto-quarantined after 2 failures/);
  assert.match(e.notes, /still wrong/);
});

t("fail: unknown word auto-creates as failed", () => {
  const st = {};
  const e = failWord(st, "fremd", "bad card");
  assert.equal(e.status, "failed");
  assert.equal(e.attempts, 1);
  assert.ok(st.fremd);
});

t("quarantine/unquarantine: manual cycle", () => {
  const st = {};
  addWords(st, ["Grund"]);
  const q = quarantine(st, "Grund", "validator said unnatural");
  assert.equal(q.status, "quarantined");
  assert.match(q.notes, /validator said unnatural/);
  const u = unquarantine(st, "Grund");
  assert.equal(u.status, "pending");
  assert.equal(st.Grund.attempts, 0);
  // attempts survive quarantine cycle (failure history kept)
  failWord(st, "Grund");
  quarantine(st, "Grund");
  assert.equal(st.Grund.attempts, 1);
  unquarantine(st, "Grund");
  assert.equal(st.Grund.status, "pending");
  assert.equal(st.Grund.attempts, 1);
});

t("quarantine: untracked word -> null", () => {
  assert.equal(quarantine({}, "nope"), null);
  assert.equal(unquarantine({}, "nope"), null);
});

t("stats: counts per status", () => {
  const st = {};
  addWords(st, ["a", "b", "c"]);
  failWord(st, "c");
  quarantine(st, "b");
  st.a.status = "in_deck";
  const s = stats(st);
  assert.deepEqual(
    { ...s },
    { new: 0, pending: 0, in_deck: 1, learning: 0, failed: 1, quarantined: 1, done: 0 },
  );
});

t("stats: empty state is all zeros", () => {
  const s = stats({});
  assert.ok(Object.values(s).every(v => v === 0));
});

t("list: filter by status, sorted by lemma", () => {
  const st = {};
  addWords(st, ["Zebra", "Apfel", "Maus"]);
  quarantine(st, "Maus");
  const rows = listWords(st, "quarantined");
  assert.deepEqual(rows.map(r => r.lemma), ["Maus"]);
  const all = listWords(st);
  assert.deepEqual(all.map(r => r.lemma), ["Apfel", "Maus", "Zebra"]);
});

t("renderTable: header present, rows line up", () => {
  const st = {};
  addWords(st, ["Haus"]);
  const out = renderTable(listWords(st));
  assert.match(out, /lemma\s+status\s+attempts/);
  assert.match(out, /Haus\s+pending\s+0/);
});

t("persistence: save + load round-trip in temp dir", () => {
  const d = freshDir();
  try {
    const st = {};
    addWords(st, ["Haus"], "round-trip");
    const p = saveState(st, d);
    assert.equal(p, join(d, "word-state.json"));
    assert.ok(existsSync(p));
    const loaded = loadState(d);
    assert.deepEqual(loaded, st);
    assert.equal(statePath(d), join(d, "word-state.json"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

t("persistence: missing state file -> empty state", () => {
  const d = freshDir();
  try {
    assert.deepEqual(loadState(d), {});
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

t("persistence: corrupt state file throws", () => {
  const d = freshDir();
  try {
    const p = join(d, "word-state.json");
    writeFileSync(p, "{not json");
    assert.throws(() => loadState(d), /cannot load/);
    writeFileSync(p, JSON.stringify({ x: { status: "bogus", attempts: 0 } }));
    assert.throws(() => loadState(d), /cannot load/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ---- ai-templates ----
const cfg = { langName: "German", targetLang: "English" };

t("templates: exampleSentence strict shape", () => {
  const p = exampleSentence({ lemma: "Haus", level: "A2" }, cfg);
  assert.match(p, /"sentence": string/);
  assert.match(p, /"translation": string/);
  assert.match(p, /Haus/);
});

t("templates: grammarDrills 3-item array shape", () => {
  const p = grammarDrills({ lemma: "gehen", pos: "Verb", level: "B1" }, cfg);
  assert.match(p, /"cloze": string/);
  assert.match(p, /"question": string/);
  assert.match(p, /"answer": string/);
  assert.match(p, /exactly 3/);
  assert.match(p, /gehen/);
});

t("templates: redemittelSet shape + count", () => {
  const p = redemittelSet({ topic: "Restaurant", count: 4, level: "B1" }, cfg);
  assert.match(p, /"phrases"/);
  assert.match(p, /"phrase": string/);
  assert.match(p, /Restaurant/);
  assert.match(p, /4/);
});

t("templates: default counts", () => {
  assert.match(redemittelSet({ topic: "Small talk" }, cfg), /Write 5/);
  assert.match(exampleSentence({ lemma: "laufen" }, cfg), /A2/);
});

t("templates: preamble forbids fences", () => {
  const pre = strictJsonPreamble();
  assert.match(pre, /strict JSON/);
  assert.match(pre, /Never wrap in code fences/);
});

// ---- summary ----
console.log(`\n${results.pass} passed, ${results.fail} failed`);
if (results.fail > 0) {
  for (const f of fails) console.error(`  - ${f.name}: ${f.e.message}`);
  process.exit(1);
}
process.exit(0);
