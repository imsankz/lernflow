import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Persistent word-tracking state machine (port of NikKosmo's flashcards
// word_tracking.md + incoming_words.md + failed_words.txt, as JSON).
// State lives in .lernflow/word-state.json: { lemma: WordEntry }.

export const STATUSES = ["new", "pending", "in_deck", "learning", "failed", "quarantined", "done"] as const;
export type WordStatus = (typeof STATUSES)[number];

export interface WordEntry {
  status: WordStatus;
  attempts: number;
  audio?: string;
  lastSeen?: string;
  notes?: string;
}

export type WordState = Record<string, WordEntry>;

export const STATE_FILE = "word-state.json";

export function statePath(dir = ".lernflow"): string {
  return join(dir, STATE_FILE);
}

export function isValidStatus(s: unknown): s is WordStatus {
  return typeof s === "string" && (STATUSES as readonly string[]).includes(s);
}

// Normalize + validate an untrusted state object. Returns null on any schema violation.
export function validateState(raw: unknown): WordState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: WordState = {};
  for (const [lemma, e] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof e !== "object" || e === null) return null;
    const en = e as Record<string, unknown>;
    if (!isValidStatus(en.status)) return null;
    if (typeof en.attempts !== "number" || !Number.isInteger(en.attempts) || en.attempts < 0) return null;
    if (en.audio !== undefined && typeof en.audio !== "string") return null;
    if (en.lastSeen !== undefined && typeof en.lastSeen !== "string") return null;
    if (en.notes !== undefined && typeof en.notes !== "string") return null;
    const entry: WordEntry = { status: en.status, attempts: en.attempts };
    if (typeof en.audio === "string") entry.audio = en.audio;
    if (typeof en.lastSeen === "string") entry.lastSeen = en.lastSeen;
    if (typeof en.notes === "string") entry.notes = en.notes;
    out[lemma] = entry;
  }
  return out;
}

export function loadState(dir = ".lernflow"): WordState {
  const p = statePath(dir);
  if (!existsSync(p)) return {};
  try {
    const valid = validateState(JSON.parse(readFileSync(p, "utf8")));
    if (!valid) throw new Error("invalid schema");
    return valid;
  } catch (e) {
    throw new Error(`words: cannot load ${p}: ${(e as Error).message}`);
  }
}

export function saveState(state: WordState, dir = ".lernflow"): string {
  mkdirSync(dir, { recursive: true });
  const p = statePath(dir);
  writeFileSync(p, JSON.stringify(state, null, 2));
  return p;
}

function nowIso(): string {
  return new Date().toISOString();
}

// incoming_words.md concept: new words land as 'pending' (the queue).
export function addWords(state: WordState, lemmas: string[], note?: string): { added: string[]; existed: string[] } {
  const added: string[] = [];
  const existed: string[] = [];
  for (const raw of lemmas) {
    const lemma = raw.trim();
    if (!lemma) continue;
    if (state[lemma]) {
      existed.push(lemma);
      if (note) state[lemma].notes = note;
      continue;
    }
    const entry: WordEntry = { status: "pending", attempts: 0, lastSeen: nowIso() };
    if (note) entry.notes = note;
    state[lemma] = entry;
    added.push(lemma);
  }
  return { added, existed };
}

// word_tracking.md update script concept: pending -> in_deck once the word is in the deck.
// Only touches statuses that are awaiting the deck (pending/new); in_deck+ states are left alone.
export function markInDeck(state: WordState, lemmas: string[]): string[] {
  const moved: string[] = [];
  for (const l of lemmas) {
    const e = state[l];
    if (e && (e.status === "pending" || e.status === "new")) {
      e.status = "in_deck";
      e.lastSeen = nowIso();
      moved.push(l);
    }
  }
  return moved;
}

export function promote(state: WordState, from: WordStatus, to: WordStatus, lemmas?: string[]): string[] {
  const targets = lemmas && lemmas.length ? lemmas : Object.keys(state);
  const moved: string[] = [];
  for (const l of targets) {
    const e = state[l];
    if (e && e.status === from) {
      e.status = to;
      e.lastSeen = nowIso();
      moved.push(l);
    }
  }
  return moved;
}

// failed_words.txt concept: each fail appends a reason and bumps attempts;
// >=2 attempts auto-quarantines (deliberate quarantine, outranks re-promotion).
export function failWord(state: WordState, lemma: string, reason?: string): WordEntry | null {
  let e = state[lemma];
  if (!e) {
    addWords(state, [lemma]);
    e = state[lemma];
  }
  e.attempts += 1;
  e.lastSeen = nowIso();
  const stamp = reason ? `fail: ${reason}` : `fail #${e.attempts}`;
  e.notes = e.notes ? `${e.notes} | ${stamp}` : stamp;
  e.status = e.attempts >= 2 ? "quarantined" : "failed";
  if (e.status === "quarantined") {
    e.notes = `${e.notes} | auto-quarantined after ${e.attempts} failures`;
  }
  return e;
}

export function quarantine(state: WordState, lemma: string, reason?: string): WordEntry | null {
  const e = state[lemma];
  if (!e) return null;
  e.status = "quarantined";
  e.lastSeen = nowIso();
  if (reason) e.notes = e.notes ? `${e.notes} | quarantined: ${reason}` : `quarantined: ${reason}`;
  return e;
}

export function unquarantine(state: WordState, lemma: string): WordEntry | null {
  const e = state[lemma];
  if (!e) return null;
  e.status = "pending";
  e.lastSeen = nowIso();
  return e;
}

export function stats(state: WordState): Record<WordStatus, number> {
  const out = Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<WordStatus, number>;
  for (const e of Object.values(state)) out[e.status]++;
  return out;
}

export interface WordRow {
  lemma: string;
  entry: WordEntry;
}

export function listWords(state: WordState, status?: WordStatus): WordRow[] {
  return Object.entries(state)
    .filter(([, e]) => !status || e.status === status)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lemma, entry]) => ({ lemma, entry }));
}

export function renderTable(rows: WordRow[]): string {
  const head = ["lemma", "status", "attempts", "lastSeen", "notes"];
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  const widths = [18, 12, 8, 24, 40];
  const cells = (r: WordRow) => [
    r.lemma,
    r.entry.status,
    String(r.entry.attempts),
    r.entry.lastSeen ?? "-",
    r.entry.notes ?? "-",
  ];
  const lines = [head.map((h, i) => pad(h, widths[i])).join(" ").trimEnd()];
  for (const r of rows) lines.push(cells(r).map((c, i) => pad(c, widths[i])).join(" ").trimEnd());
  return lines.join("\n");
}

export function wordsCli(args: string[]): void {
  const sub = args[0];
  const dir = ".lernflow";
  if (!sub || sub === "help") {
    console.log(
      "usage: lernflow words <add|list|promote|fail|quarantine|unquarantine|stats>\n" +
        "  add <word...> [--note X]          queue new words (status pending)\n" +
        "  list [--status S]                 table of tracked words\n" +
        "  promote --from S --to T [words]   move matching words between statuses\n" +
        "  fail <word...> [--reason X]       record failure; 2 fails auto-quarantine\n" +
        "  quarantine <word...> [--reason X] manually quarantine\n" +
        "  unquarantine <word...>            back to pending\n" +
        "  stats                             counts per status"
    );
    return;
  }
  const state = loadState(dir);

  if (sub === "add") {
    const noteIdx = args.indexOf("--note");
    const note = noteIdx >= 0 ? args.slice(noteIdx + 1).join(" ") : undefined;
    const lemmas = args.slice(1).filter((a, i) => !a.startsWith("--") && !(noteIdx >= 0 && i >= noteIdx));
    if (!lemmas.length) { console.error("words add: no words given"); process.exit(1); }
    const { added, existed } = addWords(state, lemmas, note);
    saveState(state, dir);
    console.log(`added ${added.length} (pending): ${added.join(", ") || "-"}`);
    if (existed.length) console.log(`already tracked (left as-is): ${existed.join(", ")}`);
    return;
  }

  if (sub === "list") {
    const si = args.indexOf("--status");
    const status = si >= 0 ? args[si + 1] : undefined;
    if (status !== undefined && !isValidStatus(status)) { console.error(`words list: bad status "${status}" (valid: ${STATUSES.join(", ")})`); process.exit(1); }
    const rows = listWords(state, status);
    console.log(renderTable(rows));
    return;
  }

  if (sub === "promote") {
    const from = args[args.indexOf("--from") + 1];
    const to = args[args.indexOf("--to") + 1];
    if (!isValidStatus(from) || !isValidStatus(to)) { console.error("words promote: --from and --to must be valid statuses"); process.exit(1); }
    if (from === to) { console.error("words promote: --from and --to must differ"); process.exit(1); }
    const lemmas = args.filter(a => !a.startsWith("--") && a !== "promote").filter(a => a !== from && a !== to);
    const moved = promote(state, from, to, lemmas);
    saveState(state, dir);
    console.log(`promoted ${moved.length}: ${from} → ${to} (${moved.join(", ") || "all matching"})`);
    return;
  }

  if (sub === "fail") {
    const ri = args.indexOf("--reason");
    const reason = ri >= 0 ? args[ri + 1] : undefined;
    const lemmas = args.slice(1).filter((a, i) => !a.startsWith("--") && i !== ri && i !== ri + 1);
    if (!lemmas.length) { console.error("words fail: no words given"); process.exit(1); }
    const out = lemmas.map(l => {
      const e = failWord(state, l, reason);
      return `${l}: ${e!.status} (attempts ${e!.attempts})`;
    });
    saveState(state, dir);
    console.log(out.join("\n"));
    return;
  }

  if (sub === "quarantine") {
    const ri = args.indexOf("--reason");
    const reason = ri >= 0 ? args[ri + 1] : undefined;
    const lemmas = args.slice(1).filter((a, i) => !a.startsWith("--") && i !== ri && i !== ri + 1);
    const out = lemmas.map(l => `${l}: ${quarantine(state, l, reason) ? "quarantined" : "not tracked"}`);
    saveState(state, dir);
    console.log(out.join("\n"));
    return;
  }

  if (sub === "unquarantine") {
    const lemmas = args.slice(1).filter(a => !a.startsWith("--"));
    const out = lemmas.map(l => `${l}: ${unquarantine(state, l) ? "pending" : "not tracked"}`);
    saveState(state, dir);
    console.log(out.join("\n"));
    return;
  }

  if (sub === "stats") {
    const s = stats(state);
    const total = Object.values(state).length;
    for (const st of STATUSES) console.log(`${st.padEnd(12)} ${s[st]}`);
    console.log(`total`.padEnd(12) + ` ${total}`);
    return;
  }

  console.error(`words: unknown subcommand "${sub}"`); process.exit(1);
}
