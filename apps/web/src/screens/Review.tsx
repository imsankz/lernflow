import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { nextCard, previewAll, type CardInput } from "@/lib/fsrs";
import { formatDay, formatInterval, todayKey } from "@/lib/dates";
import { KEY_TO_RATING, RATING_COLORS, RATING_LABELS } from "@/lib/ratings";
import { isGapCard, toDeckRows } from "@/lib/gap";
import { hasGermanVoice, speakGerman, stopSpeaking, ttsSupported } from "@/lib/tts";
import { useApp, type CardView } from "@/store/app";
import {
  appendLog,
  loadLog,
  saveCard,
  saveStreak,
  type CardStored,
  type DeckRowStored,
} from "@/store/storage";

interface SessionCard {
  card: CardStored;
  row: DeckRowStored;
}

function toStoredCard(card: CardView): CardStored {
  return {
    id: card.id,
    deckId: card.deckId,
    rowIndex: card.rowIndex,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
  };
}

function toFsrsCard(c: CardStored): CardInput {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  };
}

export default function ReviewScreen() {
  const { cards, decks, settings, refresh, streakDays } = useApp();

  const [queue, setQueue] = useState<SessionCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [previews, setPreviews] = useState<Record<number, string> | null>(null);
  const [gapAnswer, setGapAnswer] = useState("");
  const [gapRevealed, setGapRevealed] = useState(false);
  const [gapCorrect, setGapCorrect] = useState<boolean | null>(null);
  const [askText, setAskText] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [sessionDone, setSessionDone] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // build session queue once per mount / deck list. Daily goal budgets how
  // many *new* cards enter the session across the whole day (not per
  // session): count new-card reviews already logged today and only admit
  // the remainder. Reviews (already due) are unbounded — they're a debt
  // that must be paid down regardless of the new-card goal.
  useEffect(() => {
    if (queue !== null) return;
    let cancelled = false;
    void (async () => {
      const now = Date.now();
      const deckIds = new Set(decks.map((d) => d.id));
      const newCards: SessionCard[] = [];
      const reviewCards: SessionCard[] = [];
      const emptyRow: DeckRowStored = { lemma: "", gender: "", translation: "", forms: "", example: "" };
      for (const c of cards) {
        if (!deckIds.has(c.deckId)) continue;
        if (c.state === 0) {
          newCards.push({ card: toStoredCard(c), row: emptyRow });
        } else if (c.due <= now) {
          reviewCards.push({ card: toStoredCard(c), row: emptyRow });
        }
      }

      const log = await loadLog();
      const key = todayKey();
      const newDoneToday = log.filter((e) => e.wasNew && formatDay(new Date(e.t)) === key).length;
      const remaining = Math.max(0, settings.dailyGoal - newDoneToday);

      // shuffle for variety, then cap at whatever budget is left today
      newCards.sort(() => Math.random() - 0.5);
      const capped = newCards.slice(0, remaining);
      if (!cancelled) setQueue([...reviewCards, ...capped]);
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, decks, queue, settings.dailyGoal]);

  // hydrate rows for the queue: batch one getDeckRows() call per distinct
  // deck in the session (not one per card) so a 40-card session against a
  // single 2,886-row deck does a single IndexedDB read instead of 40.
  useEffect(() => {
    if (!queue || queue.length === 0 || queue[0].row.lemma !== "") return;
    let cancelled = false;
    void (async () => {
      const { getDeckRows } = await import("@/store/storage");
      const deckIds = [...new Set(queue.map((s) => s.card.deckId))];
      const rowsByDeck = new Map<string, DeckRowStored[]>();
      await Promise.all(
        deckIds.map(async (id) => {
          rowsByDeck.set(id, (await getDeckRows(id)) ?? []);
        }),
      );
      if (cancelled) return;
      const hydrated: SessionCard[] = [];
      for (const s of queue) {
        const row = rowsByDeck.get(s.card.deckId)?.[s.card.rowIndex];
        if (row) hydrated.push({ card: s.card, row });
      }
      if (hydrated.length !== queue.length) {
        setQueue(null);
        return;
      }
      setQueue(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, [queue]);

  const current = queue && idx < queue.length ? queue[idx] : null;
  const isGap = current ? isGapCard(toDeckRows([current.row])[0]) : false;
  const ttsReady = ttsSupported() && hasGermanVoice();

  const speakFront = useCallback(() => {
    if (!current) return;
    speakGerman(current.row.lemma);
  }, [current]);

  // Autoplay: speak the front the moment a card is shown, and the German
  // side again on flip (only for non-gap cards, where the back repeats the lemma).
  useEffect(() => {
    if (!current || !settings.ttsAutoplay || !settings.ttsEnabled) return;
    if (!flipped) speakGerman(current.row.lemma);
  }, [current, flipped, settings.ttsAutoplay, settings.ttsEnabled]);

  // Stop any in-flight utterance when leaving the review screen.
  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    if (flipped && isGap && !gapRevealed) {
      inputRef.current?.focus();
    }
  }, [flipped, isGap, gapRevealed]);

  // next-interval preview for the rating buttons (computed when card shows)
  useEffect(() => {
    if (!current) {
      setPreviews(null);
      return;
    }
    const p = previewAll(toFsrsCard(current.card));
    setPreviews({
      1: intervalLabel(p[1].card.due),
      2: intervalLabel(p[2].card.due),
      3: intervalLabel(p[3].card.due),
      4: intervalLabel(p[4].card.due),
    });
  }, [current]);

  const checkGap = useCallback(() => {
    if (!current) return;
    const clean = (s: string) => s.toLowerCase().replace(/[.,!?;:()"']/g, "").trim();
    setGapCorrect(clean(gapAnswer) === clean(current.row.lemma));
  }, [current, gapAnswer]);

  const ask = useCallback(async () => {
    if (!current || !askText.trim() || askBusy) return;
    setAskBusy(true);
    setAskError(null);
    try {
      const url = settings.openaiBase?.replace(/\/+$/, "") ?? "https://api.openai.com/v1";
      const key = settings.openaiKey ?? "";
      if (!key) throw new Error("No API key configured — add one in Settings");
      const model = settings.openaiModel ?? "gpt-4o-mini";
      const prompt =
        `German vocabulary tutor. The card's front is the German word "${current.row.lemma}" ` +
        `(${current.row.gender ? `gender ${current.row.gender}` : "no gender"}, ` +
        `translation "${current.row.translation}"). ` +
        `The student wrote: "${askText}". ` +
        `Respond in 2-3 short sentences: is the answer correct or not, and what's the right way to say it.`;
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a concise German tutor. Keep replies under 60 words." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 160,
        }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";
      setAskText(content);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : String(e));
    } finally {
      setAskBusy(false);
    }
  }, [current, askText, askBusy, settings]);

  const rate = useCallback(
    async (rating: number) => {
      if (!current) return;
      const r = nextCard(toFsrsCard(current.card), rating as 1 | 2 | 3 | 4);
      const updated: CardStored = {
        ...current.card,
        due: r.card.due.getTime(),
        stability: r.card.stability,
        difficulty: r.card.difficulty,
        reps: r.card.reps,
        lapses: r.card.lapses,
        state: r.card.state,
        lastReview: Date.now(),
      };
      await saveCard(updated);
      await appendLog({
        t: Date.now(),
        deckId: current.card.deckId,
        cardId: current.card.id,
        rating,
        due: updated.due,
        wasNew: current.card.state === 0,
      });
      const active = new Set(streakDays);
      active.add(todayKey());
      await saveStreak({ activeDays: [...active], current: active.size });

      setReviewed((n) => n + 1);
      setFlipped(false);
      setGapAnswer("");
      setGapRevealed(false);
      setGapCorrect(null);
      setAskText("");
      setAskError(null);

      const next = idx + 1;
      if (next >= queue!.length) {
        setSessionDone(true);
        void refresh();
      } else {
        setIdx(next);
      }
    },
    [current, idx, queue, streakDays, refresh],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (sessionDone) return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      const rating = KEY_TO_RATING[e.key];
      if (rating) {
        e.preventDefault();
        if (!flipped) {
          setFlipped(true);
        } else {
          void rate(rating);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, rate, sessionDone]);

  if (queue === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Building session…</p>
      </div>
    );
  }

  if (sessionDone) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Session complete 🎉</h1>
        <p className="text-muted-foreground">{reviewed} card{reviewed === 1 ? "" : "s"} reviewed</p>
        <div className="flex gap-2">
          <Button onClick={() => { setSessionDone(false); setIdx(0); setQueue(null); }}>Review again</Button>
          <Link to="/"><Button variant="outline">Back to Today</Button></Link>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-2xl font-bold">All done</h1>
        <p className="text-muted-foreground">Nothing due right now.</p>
        <Link to="/"><Button variant="outline">Back to Today</Button></Link>
      </div>
    );
  }

  const row = toDeckRows([current.row])[0];
  const gap = isGap ? (gapRevealed ? current.row.example : row.gap) : current.row.example;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{idx + 1} / {queue!.length}</span>
        <span className="text-xs">Space to flip · 1-4 to rate · Esc to quit</span>
      </div>
      <Progress value={(idx / queue!.length) * 100} className="mb-6" />

      <Card className="mb-4">
        <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-8 text-center">
          {!flipped ? (
            <>
              <p className="text-sm text-muted-foreground">{current.row.pos ?? "Vocabulary"}</p>
              <h2 className="text-3xl font-bold">
                {current.row.gender ? `${current.row.lemma} (${current.row.gender})` : current.row.lemma}
              </h2>
              {settings.ttsEnabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={speakFront}
                  disabled={!ttsReady}
                  title={ttsReady ? "Speak German (SpeechSynthesis)" : "No German voice found on this device"}
                >
                  🔊 {ttsReady ? "Listen" : "no German voice"}
                </Button>
              )}
            </>
          ) : (
            <>
              {isGap && !gapRevealed && (
                <div className="w-full space-y-2">
                  <p className="text-lg leading-relaxed">{gap}</p>
                  <div className="flex gap-2">
                    <Input
                      ref={inputRef}
                      value={gapAnswer}
                      onChange={(e) => setGapAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); checkGap(); }
                      }}
                      placeholder="Type the missing word…"
                      className="text-center"
                    />
                    <Button onClick={checkGap} disabled={!gapAnswer.trim()}>Check</Button>
                  </div>
                  {gapCorrect !== null && (
                    <p className={`text-sm ${gapCorrect ? "text-emerald-400" : "text-red-400"}`}>
                      {gapCorrect ? "Correct ✓" : `Not quite — it's “${current.row.lemma}”`}
                    </p>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setGapRevealed(true)}>
                    Reveal answer
                  </Button>
                </div>
              )}
              {(!isGap || gapRevealed) && (
                <>
                  <h2 className="text-2xl font-semibold">
                    {current.row.gender ? `${current.row.lemma} (${current.row.gender})` : current.row.lemma}
                  </h2>
                  <p className="text-lg text-primary">{current.row.translation}</p>
                  {current.row.forms && <p className="text-sm text-muted-foreground">{current.row.forms}</p>}
                  {current.row.example && <p className="text-sm italic text-muted-foreground">{current.row.example}</p>}
                  {settings.ttsEnabled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => speakGerman(current.row.example || current.row.lemma)}
                      disabled={!ttsReady}
                      title={ttsReady ? "Speak German (SpeechSynthesis)" : "No German voice found on this device"}
                    >
                      🔊 {ttsReady ? "Listen" : "no German voice"}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Ask (free-text check) */}
      {settings.openaiBase && settings.openaiKey && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex gap-2">
              <Input
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
                placeholder="Type a sentence using this word, hit Ask…"
              />
              <Button onClick={() => void ask()} disabled={askBusy || !askText.trim()}>
                {askBusy ? "…" : "Ask"}
              </Button>
            </div>
            {askError && <p className="mt-2 text-xs text-red-400">{askError}</p>}
          </CardContent>
        </Card>
      )}

      {/* Rating buttons */}
      {flipped && (!isGap || gapRevealed) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[1, 2, 3, 4].map((r) => (
            <Button
              key={r}
              onClick={() => void rate(r)}
              className={`h-16 flex-col border ${RATING_COLORS[r]} bg-transparent shadow-none`}
            >
              <span className="text-xs text-muted-foreground">{r}</span>
              <span className="font-semibold">{RATING_LABELS[r]}</span>
              <span className="text-xs opacity-80">{previews?.[r] ?? ""}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function intervalLabel(due: Date): string {
  const ms = due.getTime() - Date.now();
  const days = ms / 86_400_000;
  if (days < 1) {
    const mins = Math.max(1, Math.round(ms / 60_000));
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }
  return formatInterval(Math.round(days));
}
