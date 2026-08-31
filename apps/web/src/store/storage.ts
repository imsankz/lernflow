import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";

const CARD_PREFIX = "lernweb:card:";
const META_KEY = "lernweb:deckMeta";
const SETTINGS_KEY = "lernweb:settings";
const LOG_KEY = "lernweb:log";
const STREAK_KEY = "lernweb:streak";

const DECK_KEY = (deckId: string) => `lernweb:deck:${deckId}`;

export interface DeckRowStored {
  lemma: string;
  gender: string;
  translation: string;
  forms: string;
  example: string;
  pos?: string;
  audio?: string;
}

export interface DeckMeta {
  id: string;
  name: string;
  importedAt: number;
  rowCount: number;
}

export interface CardStored {
  id: string; // `${deckId}:${rowIndex}`
  deckId: string;
  rowIndex: number;
  due: number; // epoch ms
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number; // 0 new, 1 learning, 2 review, 3 relearning
  lastReview?: number;
}

export interface Settings {
  dailyGoal: number;
  examDate?: string; // yyyy-mm-dd
  openaiBase?: string;
  openaiKey?: string;
  openaiModel?: string;
}

export interface ReviewLogEntry {
  t: number;
  deckId: string;
  cardId: string;
  rating: number;
  due: number;
}

export interface StreakInfo {
  activeDays: string[]; // yyyy-mm-dd
  current: number;
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 40,
};

export const META_KEY_STR = META_KEY;
export const CARD_PREFIX_STR = CARD_PREFIX;
export const STREAK_KEY_STR = STREAK_KEY;

async function allKeys(): Promise<string[]> {
  return idbKeys<string>();
}

function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadDecks(): Promise<DeckMeta[]> {
  const k = await allKeys();
  const metas: DeckMeta[] = [];
  for (const key of k) {
    if (!key.startsWith(META_KEY)) continue;
    const meta = await idbGet<DeckMeta>(key);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => a.importedAt - b.importedAt);
}

export async function importDeck(
  name: string,
  rows: DeckRowStored[],
  now: Date = new Date(),
): Promise<DeckMeta> {
  const id = makeId();
  const meta: DeckMeta = { id, name, importedAt: now.getTime(), rowCount: rows.length };
  await idbSet(DECK_KEY(id), rows);
  await idbSet(`${META_KEY}:${id}`, meta);
  // eagerly create a new card per row (due now, so they're reviewable immediately)
  const due = now.getTime();
  const cards: CardStored[] = rows.map((_, i) => ({
    id: `${id}:${i}`,
    deckId: id,
    rowIndex: i,
    due,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 0,
  }));
  for (let i = 0; i < cards.length; i += 100) {
    await Promise.all(cards.slice(i, i + 100).map((c) => idbSet(CARD_PREFIX + c.id, c)));
  }
  return meta;
}

export async function getDeckRows(deckId: string): Promise<DeckRowStored[] | undefined> {
  return idbGet<DeckRowStored[]>(DECK_KEY(deckId));
}

export async function deleteDeck(deckId: string): Promise<void> {
  const k = await allKeys();
  for (const key of k) {
    if (key === DECK_KEY(deckId) || key === `${META_KEY}:${deckId}` || key.startsWith(CARD_PREFIX + deckId + ":")) {
      await idbDel(key);
    }
  }
}

export async function loadCard(cardId: string): Promise<CardStored | undefined> {
  return idbGet<CardStored>(CARD_PREFIX + cardId);
}

export async function saveCard(card: CardStored): Promise<void> {
  await idbSet(CARD_PREFIX + card.id, card);
}

export async function loadCards(deckIds: string[]): Promise<CardStored[]> {
  const k = await allKeys();
  const out: CardStored[] = [];
  for (const key of k) {
    if (!key.startsWith(CARD_PREFIX)) continue;
    const card = await idbGet<CardStored>(key);
    if (card && deckIds.includes(card.deckId)) out.push(card);
  }
  return out;
}

export async function countCards(deckId: string): Promise<number> {
  const k = await allKeys();
  let n = 0;
  for (const key of k) if (key.startsWith(CARD_PREFIX + deckId + ":")) n++;
  return n;
}

export async function appendLog(entry: ReviewLogEntry): Promise<void> {
  const cur = (await idbGet<ReviewLogEntry[]>(LOG_KEY)) ?? [];
  cur.push(entry);
  await idbSet(LOG_KEY, cur);
}

export async function loadLog(): Promise<ReviewLogEntry[]> {
  return (await idbGet<ReviewLogEntry[]>(LOG_KEY)) ?? [];
}

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await idbGet<Settings>(SETTINGS_KEY)) ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await idbSet(SETTINGS_KEY, s);
}

export async function loadStreak(): Promise<StreakInfo> {
  const s = (await idbGet<StreakInfo>(STREAK_KEY)) ?? { activeDays: [], current: 0 };
  return s;
}

export async function saveStreak(s: StreakInfo): Promise<void> {
  await idbSet(STREAK_KEY, s);
}
