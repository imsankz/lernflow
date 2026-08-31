import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { calcStreak, daysUntil, formatDay } from "@/lib/dates";
import { useApp } from "@/store/app";

function dueForToday(cards: ReturnType<typeof useApp>["cards"]) {
  const now = Date.now();
  return cards.filter((c) => c.state === 0 || c.due <= now);
}

export default function TodayScreen() {
  const { decks, cards, settings, streakDays, refresh } = useApp();
  const [today] = useState(() => formatDay(new Date()));

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const due = useMemo(() => dueForToday(cards), [cards]);
  const newCount = useMemo(() => cards.filter((c) => c.state === 0).length, [cards]);
  const streak = useMemo(() => calcStreak(new Set(streakDays)), [streakDays]);
  const goal = settings.dailyGoal;
  const progress = Math.min(100, Math.round((due.length / Math.max(1, goal)) * 100));
  const examIn = settings.examDate ? daysUntil(settings.examDate) : null;
  const examSoon = examIn !== null && examIn >= 0 && examIn <= 30;

  const totalNotes = useMemo(() => decks.reduce((s, d) => s + d.rowCount, 0), [decks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        {examIn !== null && (
          <div
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              examSoon ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-border bg-muted text-muted-foreground"
            }`}
          >
            {examIn === 0 ? "Exam today!" : examIn === 1 ? "Exam tomorrow" : `Exam in ${examIn} days`}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className={streak > 0 ? "text-orange-400" : "text-muted-foreground"}>🔥</span>
              {streak} day{streak === 1 ? "" : "s"} streak
            </CardTitle>
            <CardDescription>Review every day to keep it alive</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Due now</CardTitle>
            <CardDescription>
              {due.length} card{due.length === 1 ? "" : "s"} — {newCount} new · {Math.max(0, due.length - newCount)} review
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="mb-1" />
            <p className="text-xs text-muted-foreground">
              {Math.min(goal, due.length)}/{goal} daily goal ({progress}%)
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Ready</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {due.length > 0 ? (
            <Link to="/review" className="block">
              <Button className="h-12 w-full text-base">Start review ({due.length})</Button>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">
              No cards due. {decks.length === 0 ? "Import a deck to get started." : "All caught up — see you tomorrow."}
            </p>
          )}
          {decks.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Tip: the bundled <strong>Goethe B1</strong> deck ({totalNotes || "2,886"} words) can be imported from the
              Decks tab.
            </p>
          )}
        </CardContent>
      </Card>

      {decks.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Get started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. Open <Link className="text-primary underline" to="/decks">Decks</Link> and import the bundled Goethe B1 vocabulary (2,886 words).</p>
            <p>2. Set your exam date in <Link className="text-primary underline" to="/settings">Settings</Link> to see the countdown.</p>
            <p>3. Hit <strong>Start review</strong> and rate cards with keys 1–4.</p>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {totalNotes} notes · {cards.length} cards · local-only (IndexedDB)
      </p>
    </div>
  );
}
