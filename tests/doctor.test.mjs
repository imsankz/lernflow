import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../dist/doctor.js";
import { convertBanks, bankToWebRows, DEFAULT_BANK_SPECS } from "../dist/banks-to-decks.js";
import { loadBankFile } from "../dist/grammar-bank.js";

test("doctor: node check always passes on supported runtime", () => {
  const checks = runDoctor(".");
  const node = checks.find((c) => c.name === "node");
  assert.equal(node.level, "ok");
});

test("doctor: reports on grammar banks in a fresh dir with no banks", () => {
  const dir = mkdtempSync(join(tmpdir(), "lernflow-doctor-"));
  const checks = runDoctor(dir);
  const banks = checks.find((c) => c.name === "grammar banks");
  assert.equal(banks.level, "warn");
  rmSync(dir, { recursive: true, force: true });
});

test("doctor: fails loudly on a malformed bank file", () => {
  const dir = mkdtempSync(join(tmpdir(), "lernflow-doctor-"));
  mkdirSync(join(dir, "data", "banks"), { recursive: true });
  writeFileSync(join(dir, "data", "banks", "bad.yaml"), "level: A1\ncategories: not-an-array\n");
  const checks = runDoctor(dir);
  const banks = checks.find((c) => c.name === "grammar banks");
  assert.equal(banks.level, "fail");
  rmSync(dir, { recursive: true, force: true });
});

test("banks-to-decks: real B1 telc bank converts to deterministic web rows", () => {
  const bank = loadBankFile("data/banks/b1-telc.yaml");
  const rowsA = bankToWebRows(bank);
  const rowsB = bankToWebRows(bank);
  assert.ok(rowsA.length > 0);
  assert.deepEqual(rowsA, rowsB); // deterministic, no AI/randomness
  for (const r of rowsA) {
    assert.ok(r.lemma);
    assert.ok(r.translation.length > 0);
  }
});

test("banks-to-decks: convertBanks writes one JSON file per known bank", () => {
  const outDir = mkdtempSync(join(tmpdir(), "lernflow-decks-"));
  const results = convertBanks("data/banks", outDir, DEFAULT_BANK_SPECS);
  assert.equal(results.length, 4);
  for (const r of results) {
    const rows = JSON.parse(readFileSync(r.outPath, "utf8"));
    assert.equal(rows.length, r.rows);
    assert.ok(rows.length > 0);
  }
  rmSync(outDir, { recursive: true, force: true });
});

test("banks-to-decks: skips specs whose bank file doesn't exist", () => {
  const outDir = mkdtempSync(join(tmpdir(), "lernflow-decks-"));
  const results = convertBanks("data/banks", outDir, [{ file: "nope.yaml", outName: "nope", deckLabel: "Nope" }]);
  assert.equal(results.length, 0);
  rmSync(outDir, { recursive: true, force: true });
});
