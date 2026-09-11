import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseCSV, toWordRows, detectDelim } from "./csv.js";
import { parseEntry, cleanExamples } from "./lemma.js";
import { aiConfigFromEnv, Translator } from "./translate.js";
import { buildTSV, writeApkg, type TsvRow } from "./apkg.js";
import { makeQuiz, renderQuiz } from "./quiz.js";
import { auditDeck, type DeckRow } from "./pos.js";
import { detectTTS, tts, audioPath, type AudioConfig } from "./audio.js";
import { loadBankFile, itemCount, allItems } from "./grammar-bank.js";
import {
  loadDrillCache, saveDrillCache, drillsForItem, bankToRows,
  grammarDeckName, DRILL_TAG,
} from "./grammar.js";
import { loadState, saveState, addWords, markInDeck, wordsCli } from "./words.js";
import { runDoctor, renderDoctor } from "./doctor.js";
import { convertAllBanks } from "./banks-to-decks.js";

// Heuristic POS from entry parsing (no AI cost). gender present => Noun;
// forms looking like "…, hat …/ist …" => Verb; else guess from suffixes.
function guessPos(lemma: string, gender: string, forms: string): string {
  if (gender) return "Noun";
  if (/\b(hat|ist)\s/.test(forms)) return "Verb";
  if (/(ieren|ieren,|en,)/.test(forms) || /^[a-zäöüß]+en$/.test(lemma)) return "Verb";
  if (/(lich|ig|bar|sam|haft)$/.test(lemma)) return "Adjective";
  if (/(weise|halts|wegs|dorthin|hierhin)$/.test(lemma)) return "Adverb";
  return "";
}

const HELP = `lernflow — build your own spaced-repetition decks from any wordlist. Zero-cost, BYO data + BYO AI endpoint.

Usage: lernflow <command> [flags]

Commands
  build <file.csv|tsv|txt>   wordlist -> translations cache -> deck (TSV + optional .apkg)
    --col N          headword column, 0-based (default 0)
    --ex N           examples column, 0-based (-1 none, default 1)
    --deck NAME      deck name (default: file basename)
    --out DIR        output dir (default ./out)
    --apkg           also write .apkg (needs python3 + genanki)
    --audio          embed TTS audio (macOS say / espeak-ng / piper / LERNFLOW_TTS_CMD)
    --audio-max N    cap number of generated clips (default 10000)
    --force          skip the audit gate
    --lang LANG      source language label for prompts (default German)
    --target LANG    target language label (default English)
  status                     cache + deck stats for a data dir
  quiz [--n 8] [--seed N]    deterministic daily quiz from deck rows
  grammar <bank.yaml|json>   B1 grammar item-bank -> AI cloze/drill deck (TSV + optional .apkg)
    --deck NAME      deck name (default: "Grammatik <LEVEL>")
    --out DIR        output dir (default ./out)
    --apkg           also write .apkg (needs python3 + genanki)
    --no-ai          skip AI calls, build drills from bank examples (offline, deterministic)
  init                       write .env.local template
  doctor                     check environment: Node, python3+genanki, TTS backend, banks, cache
  banks-to-decks             offline: data/banks/*.yaml -> apps/web/public/decks/*.json (bundled lernweb decks)
    --banks DIR      source dir (default data/banks)
    --out DIR        output dir (default apps/web/public/decks)

Config: .env.local in cwd (AI_BASE_URL, AI_API_KEY, AI_MODEL, LERNFLOW_LANG, ...)
Data/cache live in .lernflow/ (translations.json persists -> incremental runs).
`;

function flag(args: string[], name: string, def?: string): string {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : (def ?? "");
}
function has(args: string[], name: string): boolean { return args.includes("--" + name); }

function dataDir(): string { return ".lernflow"; }

async function build(args: string[]) {
  const file = args.find(a => !a.startsWith("--") && !["build"].includes(a));
  if (!file || !existsSync(file)) { console.error("build: input file not found"); process.exit(1); }
  const col = Number(flag(args, "col", "0"));
  const ex = Number(flag(args, "ex", "1"));
  const deckName = flag(args, "deck", basename(file, extname(file)));
  const outDir = flag(args, "out", "out");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dataDir(), { recursive: true });

  const text = readFileSync(file, "utf8");
  let rows;
  if (/\t/.test(text.split("\n")[0]) && !has(args, "csv")) rows = text.split("\n").map(l => l.split("\t"));
  else rows = parseCSV(text);
  const words = toWordRows(rows, col, ex);
  console.log(`${basename(file)}: ${words.length} entries (${detectDelim(text) === "\t" ? "TSV" : "CSV"})`);

  const parsed = words.map(w => ({ ...parseEntry(w.entry), examples: cleanExamples(w.examples), raw: w.entry }));
  const lemmas = parsed.map(p => p.lemma);

  const cfg = aiConfigFromEnv(".");
  if (flag(args, "lang")) cfg.langName = flag(args, "lang");
  if (flag(args, "target")) cfg.targetLang = flag(args, "target");
  const cacheP = join(dataDir(), `translations-${cfg.langName.toLowerCase()}-${cfg.targetLang.toLowerCase()}.json`);
  const tr = new Translator(cfg, Translator.loadCache(cacheP));
  console.log(`AI: ${cfg.baseUrl} model=${cfg.model} cached=${Object.keys(tr.cache).length}`);
  await tr.ensure(lemmas, (d, t) => console.log(`  translating ${d}/${t}`));
  tr.saveCache(cacheP);

  const tsvRows: TsvRow[] = parsed
    .filter(p => tr.cache[p.lemma])
    .map(p => ({ lemma: p.lemma, gender: p.gender, translation: tr.cache[p.lemma], forms: p.forms, example: p.examples, pos: guessPos(p.lemma, p.gender, p.forms) }));

  // audit gate (fail-fast on errors unless --force)
  if (!has(args, "force")) {
    const issues = auditDeck(tsvRows as DeckRow[]);
    const errs = issues.filter(x => x.level === "error");
    if (errs.length) {
      console.error(`audit: ${errs.length} error(s) (first 5):`);
      errs.slice(0, 5).forEach(x => console.error(`  row ${x.index} ${x.lemma}: ${x.msg}`));
      console.error("fix the input or pass --force to build anyway");
      process.exit(2);
    }
    const warns = issues.filter(x => x.level === "warn");
    if (warns.length) console.log(`audit: ok (${warns.length} warning(s))`);
  }

  // optional TTS audio (--audio): cached in .lernflow/audio, embedded in .apkg
  let audioCfg: AudioConfig | null = null;
  if (has(args, "audio")) {
    audioCfg = detectTTS();
    if (!audioCfg) console.error("  --audio: no TTS backend found (macOS say, espeak-ng, piper, or LERNFLOW_TTS_CMD) — skipping audio");
    else {
      const want = tsvRows.filter(r => r.example || r.lemma).slice(0, Number(flag(args, "audio-max", "10000")));
      console.log(`  audio: ${want.length} clips via ${audioCfg.cmd![0]} (cached misses only)`);
      let made = 0;
      for (const r of want) {
        const text = r.example || r.lemma;
        const p = tts(audioCfg, text, r.lemma);
        if (p) { r.audio = p; made++; }
        if ((made + 1) % 200 === 0) console.log(`    ${made}/${want.length}`);
      }
      console.log(`  audio: ${made} clips ready in ${audioCfg.dir}/`);
    }
  }

  const tsvOut = join(outDir, `${deckName}.tsv`);
  writeFileSync(tsvOut, buildTSV(tsvRows, deckName));
  writeFileSync(join(dataDir(), "rows.json"), JSON.stringify(tsvRows));
  console.log(`wrote ${tsvOut} (${tsvRows.length} rows) — import directly into Anki`);

  // incremental deck-building: words that were queued (pending/new) and now have
  // a built card become in_deck in the word-tracking state (word_tracking.md update concept)
  const state = loadState(dataDir());
  const inDeck = markInDeck(state, tsvRows.map(r => r.lemma));
  if (inDeck.length) {
    saveState(state, dataDir());
    console.log(`words: ${inDeck.length} queued → in_deck (${inDeck.slice(0, 5).join(", ")}${inDeck.length > 5 ? ", …" : ""})`);
  }

  if (has(args, "apkg")) {
    const r = writeApkg(tsvRows, join(outDir, `${deckName}.apkg`), deckName, audioCfg?.dir || "");
    console.log(r.ok ? `wrote ${deckName}.apkg: ${r.message}` : `apkg skipped: ${r.message}`);
  }
}

function status() {
  if (!existsSync(".lernflow")) { console.log("no .lernflow/ yet — run `lernflow build ...`"); return; }
  const dirList = readdirSync(".lernflow").filter(f => f.startsWith("translations-"));
  const total = dirList.reduce((n, f) => n + Object.keys(JSON.parse(readFileSync(join(".lernflow", f), "utf8"))).length, 0);
  console.log(`translations cached: ${total} across ${dirList.length} language pair(s): ${dirList.map(f => f.replace("translations-", "").replace(".json", "")).join(", ") || "-"}`);
  const rowsP = join(".lernflow", "rows.json");
  if (existsSync(rowsP)) console.log(`last deck rows: ${JSON.parse(readFileSync(rowsP, "utf8")).length}`);
}

function quiz(args: string[]) {
  const rowsP = join(dataDir(), "rows.json");
  if (!existsSync(rowsP)) { console.error("quiz: run `lernflow build ...` first (no .lernflow/rows.json)"); process.exit(1); }
  const rows = JSON.parse(readFileSync(rowsP, "utf8")) as TsvRow[];
  const n = Number(flag(args, "n", "8"));
  const seed = Number(flag(args, "seed", String(Math.floor(Date.now() / 86400000))));
  process.stdout.write(renderQuiz(makeQuiz(rows, n, seed)));
}

function init() {
  const p = ".env.local";
  if (existsSync(p)) { console.log(".env.local already exists — not overwriting"); return; }
  writeFileSync(p, `AI_PROVIDER=openai\nAI_BASE_URL=http://127.0.0.1:20128/v1\nAI_API_KEY=\nAI_MODEL=auto/best-free\n# source/target languages used in prompts:\n# LERNFLOW_LANG=German\n# LERNFLOW_TARGET_LANG=English\n`);
  console.log("wrote .env.local — point AI_BASE_URL at your OpenAI-compatible endpoint");
}

async function grammar(args: string[]) {
  const file = args.find(a => !a.startsWith("--") && a !== "grammar");
  if (!file || !existsSync(file)) {
    console.error("grammar: bank file not found (try: lernflow grammar data/banks/b1-telc.yaml --no-ai)");
    process.exit(1);
  }
  const bank = loadBankFile(file);
  const outDir = flag(args, "out", "out");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dataDir(), { recursive: true });
  const noAi = has(args, "no-ai");
  const deckName = flag(args, "deck", grammarDeckName(bank.level));

  console.log(`${basename(file)}: ${bank.categories.length} categories, ${itemCount(bank)} items (${bank.level})`);
  const cache = loadDrillCache(dataDir());
  const cfg = aiConfigFromEnv(".");
  console.log(`AI: ${noAi ? "off (--no-ai)" : cfg.baseUrl + " model=" + cfg.model} cached=${Object.keys(cache).length}`);

  const items = allItems(bank);
  let ai = 0, tmpl = 0;
  for (let i = 0; i < items.length; i++) {
    const { fromAi } = await drillsForItem(items[i], cache, cfg, { noAi });
    if (fromAi) ai++; else tmpl++;
    if ((i + 1) % 25 === 0) console.log(`  drills ${i + 1}/${items.length} (${ai} AI, ${tmpl} template)`);
  }
  saveDrillCache(cache, dataDir());
  console.log(`drills: ${items.length} items ready (${ai} AI-generated, ${tmpl} template fallback)`);

  const rows = bankToRows(bank, cache);
  const tsvOut = join(outDir, `${deckName}.tsv`);
  writeFileSync(tsvOut, buildTSV(rows, deckName, DRILL_TAG));
  writeFileSync(join(dataDir(), "rows.json"), JSON.stringify(rows));
  console.log(`wrote ${tsvOut} (${rows.length} rows, tag ${DRILL_TAG}) — import directly into Anki`);

  if (has(args, "apkg")) {
    const r = writeApkg(rows, join(outDir, `${deckName}.apkg`), deckName, "");
    console.log(r.ok ? `wrote ${deckName}.apkg: ${r.message}` : `apkg skipped: ${r.message}`);
  }
}

const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === "build") await build(args);
else if (cmd === "status") status();
else if (cmd === "quiz") quiz(args);
else if (cmd === "init") init();
else if (cmd === "words") wordsCli(args.slice(1));
else if (cmd === "grammar") await grammar(args);
else if (cmd === "doctor") {
  const checks = runDoctor(".");
  process.stdout.write(renderDoctor(checks));
  if (checks.some((c) => c.level === "fail")) process.exit(1);
} else if (cmd === "banks-to-decks") {
  const banksDir = flag(args, "banks", "data/banks");
  const outDir = flag(args, "out", "apps/web/public/decks");
  const results = convertAllBanks(banksDir, outDir);
  if (!results.length) {
    console.error(`banks-to-decks: no banks found in ${banksDir}`);
    process.exit(1);
  }
  for (const r of results) console.log(`  ${r.spec.deckLabel}: ${r.rows} rows -> ${r.outPath}`);
  console.log(`banks-to-decks: wrote ${results.length} deck(s) to ${outDir}`);
} else console.log(HELP);
