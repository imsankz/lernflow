export function dayIndex(d: Date = new Date()): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function fromDayIndex(i: number): Date {
  return new Date(i * 86_400_000);
}

export function todayKey(): string {
  return formatDay(new Date());
}

export function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

// Whole days between two dates, ignoring time-of-day.
export function daysBetween(a: Date, b: Date): number {
  return dayIndex(b) - dayIndex(a);
}

export function formatInterval(days: number): string {
  if (days < 1) return "<1m";
  if (days < 60) return `${days}d`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months}mo`;
  }
  const years = days / 365;
  return years >= 10 ? `${Math.round(years)}y` : `${years.toFixed(1)}y`;
}

// Streak: count consecutive days ending at `end` that have review activity.
export function calcStreak(activeDays: Set<string>, end: Date = new Date()): number {
  let streak = 0;
  let cursor = end;
  // A day with zero activity today doesn't break the streak yet.
  if (!activeDays.has(formatDay(cursor))) cursor = addDays(cursor, -1);
  while (activeDays.has(formatDay(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function daysUntil(target: string, now: Date = new Date()): number {
  const [y, m, d] = target.split("-").map(Number);
  return daysBetween(now, new Date(y, m - 1, d));
}
