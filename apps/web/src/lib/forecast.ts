import { addDays, dayIndex, formatDay } from "./dates";

export interface ForecastCard {
  state: number; // 0 = new (never scheduled, excluded from the forecast)
  due: number; // epoch ms
}

export interface ForecastDay {
  label: string;
  count: number;
}

// How many (non-new) cards are scheduled to come due each of the next `days`
// days, based on each card's *current* FSRS due timestamp. Must read live
// card state, not the review log — a log entry's `due` field is a snapshot
// from whenever that review happened, so cards reviewed more than once
// produce stale/duplicate entries there.
export function forecastDueByDay(cards: ForecastCard[], today: Date, days = 7): ForecastDay[] {
  const todayIdx = dayIndex(today);
  const out: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    // "Today" sweeps in everything overdue-until-now too (an infinite lower
    // bound), matching what "due now" means elsewhere in the app — not just
    // today's 24h slice, which would undercount backlog.
    const start = i === 0 ? -Infinity : (todayIdx + i) * 86_400_000;
    const end = (todayIdx + i + 1) * 86_400_000;
    const count = cards.filter((c) => c.state !== 0 && c.due >= start && c.due < end).length;
    out.push({ label: i === 0 ? "Today" : formatDay(addDays(today, i)), count });
  }
  return out;
}
