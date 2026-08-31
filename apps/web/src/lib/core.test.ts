import { describe, expect, it } from "vitest";

import { gapExample, buildTSV } from "./deck";
import { calcStreak, dayIndex, daysBetween, daysUntil, formatDay, fromDayIndex, addDays } from "./dates";
import { toDeckRows, isGapCard, buildGap } from "./gap";
import { parseAnkiTsv, parseRowsJson } from "./parse";
import { nextCard, previewAll } from "./fsrs";

describe("scheduling mapping (FSRS-5 via ts-fsrs)", () => {
  it("Again on a new card keeps it due within minutes (learning state)", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const empty = nextCard(
      { due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0 },
      1,
      now,
    );
    const mins = (empty.card.due.getTime() - now.getTime()) / 60_000;
    expect(mins).toBeGreaterThan(0);
    expect(mins).toBeLessThanOrEqual(10);
    expect(empty.card.state).toBe(1); // learning
    expect(empty.card.reps).toBe(1);
  });

  it("Easy on a new card schedules days ahead in review state", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const easy = nextCard(
      { due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0 },
      4,
      now,
    );
    const days = (easy.card.due.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(3);
    expect(easy.card.state).toBe(2); // review
  });

  it("previewAll returns all four grades and intervals are monotonic", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const base = { due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0 };
    const p = previewAll(base, now);
    const t1 = p[1].card.due.getTime();
    const t2 = p[2].card.due.getTime();
    const t3 = p[3].card.due.getTime();
    const t4 = p[4].card.due.getTime();
    expect(t1 <= t2).toBe(true);
    expect(t2 <= t3).toBe(true);
    expect(t3 <= t4).toBe(true);
    expect(p[4].card.state).toBe(2);
  });

  it("repeated Good ratings grow stability", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const base = { due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0 };
    const first = nextCard(base, 3, now);
    const second = nextCard(first.card, 3, new Date(first.card.due.getTime() + 86_400_000));
    expect(second.card.stability).toBeGreaterThan(first.card.stability);
    expect(second.card.reps).toBe(2);
  });
});

describe("deck parsing", () => {
  it("parses rows.json rows into cards with gap detection", () => {
    const rows = [
      { lemma: "abbiegen", gender: "", translation: "to turn", forms: "bog ab", example: "An der nächsten Kreuzung müssen Sie links abbiegen." },
      { lemma: "ab", gender: "", translation: "from", forms: "", example: "Die Fahrt kostet ab Hamburg 200 Euro." },
    ];
    const deck = toDeckRows(rows);
    expect(deck).toHaveLength(2);
    expect(deck[0].gap).toContain("___");
    expect(deck[0].gap!.startsWith("An der nächsten Kreuzung müssen Sie links ")).toBe(true);
    expect(isGapCard(deck[0])).toBe(true);
    // "ab" is a whole word in this sentence → gap card
    expect(deck[1].gap).toContain("___");
  });

  it("gap detection extends to inflected forms (lemma-prefix matching)", () => {
    expect(gapExample("Der Baum hat viele Äste.", "Baum")).toContain("___");
    // prefix extension matches inflected/longer forms by design
    expect(gapExample("Der Baum hat viele Äste.", "Ba")).toContain("___");
    expect(gapExample("Die Bäume stehen im Wald.", "Bäume")).toContain("___");
    expect(gapExample("Ich habe ein Buch.", "Buch")).toContain("___");
  });

  it("buildGap fills the blank with the answer", () => {
    const rows = toDeckRows([{ lemma: "könnte", gender: "", translation: "could", forms: "", example: "Könnten Sie mir bitte helfen?" }]);
    expect(buildGap(rows[0], "könnten")).toContain("könnten");
    expect(buildGap(rows[0], "")).toContain("___");
  });

  it("parses Anki TSV with #separator:tab header", () => {
    const tsv = `#separator:tab\n#html:false\n#tags column:6\n#deck:test\nabbiegen (V)\tto turn\texample here\tforms here\t\ttag`;
    const parsed = parseAnkiTsv(tsv, "Test");
    expect(parsed.name).toBe("Test");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lemma).toBe("abbiegen");
    expect(parsed.rows[0].gender).toBe("V");
    expect(parsed.rows[0].translation).toBe("to turn");
    expect(parsed.rows[0].example).toBe("example here");
  });

  it("parses lernflow rows.json leniently (entry/examples fallback)", () => {
    const json = JSON.stringify([
      { entry: "die Abbildung, -en", lemma: "Abbildung", gender: "die", examples: "Auf der Abbildung sehen Sie das Gerät.\nZweiter Satz." },
    ]);
    const parsed = parseRowsJson(json, "Goethe B1");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lemma).toBe("Abbildung");
    expect(parsed.rows[0].gender).toBe("die");
    expect(parsed.rows[0].example).toBe("Auf der Abbildung sehen Sie das Gerät.");
  });

  it("skips rows without a lemma and reports warnings", () => {
    const parsed = parseRowsJson(JSON.stringify([{ lemma: "", example: "x" }, { lemma: "gut", example: "y" }]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.warnings.length).toBe(1);
  });

  it("builds Anki-importable TSV", () => {
    const tsv = buildTSV([{ lemma: "gut", gender: "", translation: "good", forms: "", example: "Das ist gut." }], "B1");
    expect(tsv).toContain("#separator:tab");
    expect(tsv).toContain("gut\tgood\tDas ist gut.");
  });
});

describe("gap detection edge cases", () => {
  it("handles umlauts and case-insensitive matches", () => {
    expect(gapExample("Die Männer arbeiten.", "Männer")).toContain("___");
    expect(gapExample("Die männer arbeiten.", "Männer")).toContain("___");
  });
});

describe("streak calculation", () => {
  const end = new Date(2026, 8, 10); // Sept 10 2026 local

  it("counts consecutive days", () => {
    const active = new Set(["2026-09-10", "2026-09-09", "2026-09-08"]);
    expect(calcStreak(active, end)).toBe(3);
  });

  it("does not break the streak when today has no activity", () => {
    const active = new Set(["2026-09-09", "2026-09-08"]);
    expect(calcStreak(active, end)).toBe(2);
  });

  it("returns 0 with no activity", () => {
    expect(calcStreak(new Set(), end)).toBe(0);
  });

  it("gaps reset the streak", () => {
    const active = new Set(["2026-09-10", "2026-09-08", "2026-09-07"]);
    expect(calcStreak(active, end)).toBe(1);
  });

  it("day math stays consistent", () => {
    const d = new Date(2026, 8, 1);
    expect(formatDay(d)).toBe("2026-09-01");
    expect(fromDayIndex(dayIndex(d)).getDate()).toBe(1);
    expect(daysBetween(d, addDays(d, 3))).toBe(3);
    expect(daysUntil("2026-09-05", d)).toBe(4);
    expect(daysUntil("2026-08-20", d)).toBe(-12);
  });
});
