/**
 * Pure computation for the dashboard: streaks, calendar intensities, and
 * hour-of-day histograms. No DOM here — everything is testable in isolation.
 */
import type { ClockworkExport, ClockworkProject, DailyEntry } from './clockwork';

const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch for a "YYYY-MM-DD" string, interpreted as UTC. */
export function ordinal(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Inverse of {@link ordinal}: a day count back to "YYYY-MM-DD" (UTC). */
export function ordinalToDateStr(ord: number): string {
  const d = new Date(ord * MS_PER_DAY);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Today as a UTC day ordinal. */
export function todayOrdinalUTC(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) /
      MS_PER_DAY,
  );
}

/** Union of every project's active dates (YYYY-MM-DD). */
export function activeDates(data: ClockworkExport): Set<string> {
  const dates = new Set<string>();
  for (const p of data.projects) {
    for (const d of p.daily ?? []) if (d.date) dates.add(d.date);
  }
  return dates;
}

export interface StreakInfo {
  current: number;
  longest: number;
  activeDays: number;
  /** True when the most recent active date is today or yesterday (UTC). */
  live: boolean;
  lastDate?: string;
}

export function computeStreaks(dates: Set<string>): StreakInfo {
  const ords = [...dates].map(ordinal).sort((a, b) => a - b);
  if (ords.length === 0) {
    return { current: 0, longest: 0, activeDays: 0, live: false };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < ords.length; i++) {
    run = ords[i] === ords[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  let current = 1;
  for (let i = ords.length - 1; i > 0; i--) {
    if (ords[i] === ords[i - 1] + 1) current++;
    else break;
  }

  const last = ords[ords.length - 1];
  const today = todayOrdinalUTC();
  return {
    current,
    longest,
    activeDays: ords.length,
    live: last === today || last === today - 1,
    lastDate: ordinalToDateStr(last),
  };
}

/** Total minutes per calendar date, summed across all projects. */
export function minutesByDate(data: ClockworkExport): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of data.projects) {
    for (const d of p.daily ?? []) {
      map.set(d.date, (map.get(d.date) ?? 0) + d.minutes);
    }
  }
  return map;
}

/** 0 (none) … 4 intensity bucket for a day's minutes. */
export function minuteLevel(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 90) return 2;
  if (minutes < 180) return 3;
  return 4;
}

export interface DayCell {
  ord: number;
  dateStr: string;
  minutes: number;
  level: number;
  inFuture: boolean;
}

/** A GitHub-style calendar: `weeks` columns of 7 days ending on today (UTC). */
export function contributionGrid(
  data: ClockworkExport,
  weeks = 12,
): { columns: DayCell[][]; hasData: boolean } {
  const byDate = minutesByDate(data);
  const today = todayOrdinalUTC();
  const todayDow = new Date(today * MS_PER_DAY).getUTCDay();
  const startOrd = today - todayDow - 7 * (weeks - 1);

  const columns: DayCell[][] = [];
  for (let c = 0; c < weeks; c++) {
    const column: DayCell[] = [];
    for (let r = 0; r < 7; r++) {
      const ord = startOrd + c * 7 + r;
      const dateStr = ordinalToDateStr(ord);
      const minutes = byDate.get(dateStr) ?? 0;
      column.push({
        ord,
        dateStr,
        minutes,
        level: minuteLevel(minutes),
        inFuture: ord > today,
      });
    }
    columns.push(column);
  }
  return { columns, hasData: byDate.size > 0 };
}

/** Count prompts per local hour (0–23). */
export function hourHistogram(prompts: number[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const sec of prompts) {
    const h = new Date(sec * 1000).getHours();
    if (h >= 0 && h < 24) hours[h]++;
  }
  return hours;
}

/** Every project's prompt timestamps, or null if no project exports them. */
export function allPrompts(data: ClockworkExport): number[] | null {
  const all: number[] = [];
  let any = false;
  for (const p of data.projects) {
    if (p.prompts && p.prompts.length) {
      any = true;
      all.push(...p.prompts);
    }
  }
  return any ? all : null;
}

/** 0 (none) … 4 intensity bucket for an hour's prompt count. */
export function hourLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

/** Best-effort first/last activity (epoch seconds) for a project. */
export function projectRange(p: ClockworkProject): {
  first?: number;
  last?: number;
} {
  if (typeof p.first === 'number' && typeof p.last === 'number') {
    return { first: p.first, last: p.last };
  }
  if (p.sessions && p.sessions.length) {
    return {
      first: Math.min(...p.sessions.map((s) => s.start)),
      last: Math.max(...p.sessions.map((s) => s.end)),
    };
  }
  if (p.prompts && p.prompts.length) {
    return { first: Math.min(...p.prompts), last: Math.max(...p.prompts) };
  }
  if (p.daily && p.daily.length) {
    const ords = p.daily.map((d) => ordinal(d.date)).sort((a, b) => a - b);
    return { first: ords[0] * 86400, last: ords[ords.length - 1] * 86400 };
  }
  return {};
}

/** Sort a project's daily entries chronologically (does not mutate input). */
export function sortedDaily(daily: DailyEntry[]): DailyEntry[] {
  return [...daily].sort((a, b) => ordinal(a.date) - ordinal(b.date));
}
