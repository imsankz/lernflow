import type { AiConfig } from "./translate.js";

// Reusable strict-JSON prompt builders for AI-powered card enrichment.
// Translation prompts live in translate.ts; this module covers the rest
// (example sentences, grammar drills, Redemittel sets). Local types only —
// intentionally does NOT import grammar.ts/grammar-bank.ts so both agents
// can consume it without coupling.

export interface ExampleItem {
  lemma: string;
  level?: string; // e.g. "A2"
}

// One example sentence per requested word, strict JSON.
export function exampleSentence(item: ExampleItem, cfg: AiConfig): string {
  const level = item.level ?? "A2";
  return (
    `For the ${cfg.langName} headword "${item.lemma}" (learner level ${level}), write ONE natural ` +
    `example sentence and its ${cfg.targetLang} translation. ` +
    "Return ONLY a JSON object with exactly these keys: " +
    `{"sentence": string, "translation": string}. No markdown, no extra text.\n` +
    `Headword: ${item.lemma}`
  );
}

// Drill battery for one lemma: cloze, gap-fill, conjugation, translation.
export interface GrammarDrillItem {
  lemma: string;
  pos?: string; // e.g. "Verb", "Noun"
  level?: string;
}

export interface GrammarDrillResult {
  cloze: string; // sentence with the lemma masked as ___
  question: string; // prompt/instruction for the learner
  answer: string; // correct answer string
  hint?: string;
  explanation?: string;
}

export function grammarDrills(item: GrammarDrillItem, cfg: AiConfig): string {
  const level = item.level ?? "A2";
  const pos = item.pos ?? "";
  return (
    `Generate 3 ${cfg.langName} grammar drills for the ${cfg.langName} word "${item.lemma}" ` +
    `${pos ? `(part of speech: ${pos}) ` : ""}at learner level ${level}. ` +
    "Drill types: (1) cloze — a sentence where the target word is masked as ___, " +
    "(2) a comprehension/transformation question, (3) a production question. " +
    "Return ONLY a JSON array of exactly 3 objects, each with keys " +
    `{"cloze": string, "question": string, "answer": string, "hint"?: string, "explanation"?: string}. ` +
    "No markdown, no surrounding text."
  );
}

// Redemittel (fixed phrases / functional chunks) generation for a topic.
export interface RedemittelItem {
  topic: string; // e.g. "Restaurant", "Small talk"
  count?: number; // default 5
  level?: string;
}

export interface RedemittelSet {
  topic: string;
  phrases: { phrase: string; translation: string; usage?: string }[];
}

export function redemittelSet(item: RedemittelItem, cfg: AiConfig): string {
  const count = item.count ?? 5;
  const level = item.level ?? "B1";
  return (
    `Write ${count} high-frequency ${cfg.langName} Redemittel (fixed phrases / functional chunks) ` +
    `for the topic "${item.topic}" at learner level ${level}. Each must be a real, natural ${cfg.langName} phrase. ` +
    "Return ONLY a JSON object with exactly these keys: " +
    `{"topic": string, "phrases": [{"phrase": string, "translation": string, "usage"?: string}]}. ` +
    "No markdown, no surrounding text."
  );
}

// Shared system preamble so every generated block is a bare strict JSON doc.
export function strictJsonPreamble(): string {
  return "You are a German-learning card generator. Output ONLY valid strict JSON matching the requested shape. Never wrap in code fences, never add commentary.";
}
