import { createEmptyCard, fsrs, type Card, type CardInput, type Grade, type RecordLogItem } from "ts-fsrs";

// FSRS-5 with default parameters — same algorithm the native lernapp uses.
export function newFSRS() {
  return fsrs();
}

export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

export function nextCard(card: CardInput | Card, grade: Grade, now: Date = new Date()): RecordLogItem {
  return newFSRS().next(card, now, grade);
}

export function previewAll(card: CardInput | Card, now: Date = new Date()) {
  const f = newFSRS();
  return { 1: f.next(card, now, 1), 2: f.next(card, now, 2), 3: f.next(card, now, 3), 4: f.next(card, now, 4) } as Record<number, RecordLogItem>;
}

export type { Card, CardInput, Grade };
