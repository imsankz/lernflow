import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dayIndex, formatDay, fromDayIndex } from "@/lib/dates";
import { forecastDueByDay } from "@/lib/forecast";
import { RATING_LABELS } from "@/lib/ratings";
import { useApp } from "@/store/app";
import { loadLog, type ReviewLogEntry } from "@/store/storage";

const HEAT_WEEKS = 8;

function heatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 8) return 2;
  if (count <= 15) return 3;
  return 4;
}

interface DayCell {
  date: Date;
  key: string;
  count: number;
  level: number;
}

export default function StatsScreen() {
  const { cards, refresh } = useApp();
  const [log, setLog] = useState<ReviewLogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void loadLog().then((l) => {
      setLog(l);
      setLoaded(true);
    });
  }, []);

  const today = new Date();

  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of log) {
      const key = formatDay(new Date(e.t));
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [log]);

  const heatmap = useMemo<DayCell[]>(() => {
    const endIdx = dayIndex(today);
    const startIdx = endIdx - HEAT_WEEKS * 7 + 1;
    const cells: DayCell[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const d = fromDayIndex(i);
      const key = formatDay(d);
      const count = byDay.get(key) ?? 0;
      cells.push({ date: d, key, count, level: heatLevel(count) });
    }
    return cells;
  }, [byDay, today]);

  const totalReviews = useMemo(() => log.length, [log]);
  const totalDays = useMemo(() => byDay.size, [byDay]);

  const ratingMix = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const e of log) counts[e.rating] = (counts[e.rating] ?? 0) + 1;
    const max = Math.max(1, ...Object.values(counts));
    return [1, 2, 3, 4].map((r) => ({ rating: r, count: counts[r] ?? 0, pct: ((counts[r] ?? 0) / totalReviews) * 100, rel: (counts[r] ?? 0) / max }));
  }, [log, totalReviews]);

  // Forecast: how many cards are scheduled to come due each of the next 7
  // days, from each card's *current* FSRS due timestamp (see lib/forecast.ts
  // for why this can't be derived from the review log).
  const forecast = useMemo(() => forecastDueByDay(cards, today, 7), [cards, today]);

  const weekdayLabel = (d: Date) => ["S", "M", "T", "W", "T", "F", "S"][d.getDay()];

  if (!loaded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Loading stats…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stats</h1>
        <p className="text-sm text-muted-foreground">{totalReviews} reviews · {totalDays} active days</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Last 8 weeks</CardTitle>
          <CardDescription>Reviews per day</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="inline-flex flex-col gap-1">
            <div className="grid grid-flow-col grid-rows-7 gap-1">
              {heatmap.map((c) => (
                <div
                  key={c.key}
                  title={`${c.key}: ${c.count} review${c.count === 1 ? "" : "s"}`}
                  className={`heat-${c.level} h-3.5 w-3.5 rounded-[3px]`}
                />
              ))}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>less</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className={`heat-${l} h-3 w-3 rounded-[3px]`} />
              ))}
              <span>more</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Rating mix</CardTitle>
          <CardDescription>How you rated the last {totalReviews} reviews</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ratingMix.map((r) => (
            <div key={r.rating} className="flex items-center gap-3">
              <span className="w-14 text-sm">{RATING_LABELS[r.rating]}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${r.rating === 1 ? "bg-red-500" : r.rating === 2 ? "bg-orange-500" : r.rating === 3 ? "bg-emerald-500" : "bg-sky-500"}`}
                  style={{ width: `${Math.max(2, r.rel * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">
                {r.count} ({r.pct.toFixed(0)}%)
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Next 7 days</CardTitle>
          <CardDescription>Cards scheduled to come due, from current FSRS schedule</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            {forecast.map((d) => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs tabular-nums text-muted-foreground">{d.count}</span>
                <div
                  className="w-full rounded-t bg-primary/60"
                  style={{ height: `${Math.max(4, Math.min(100, (d.count / Math.max(1, ...forecast.map((f) => f.count))) * 80))}px` }}
                />
                <span className="text-[10px] text-muted-foreground">{d.label === "Today" ? "Today" : weekdayLabel(new Date(d.label))}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
