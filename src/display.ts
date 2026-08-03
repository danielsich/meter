/** Format a duration in minutes as "Xh Ym" (e.g. 1234.76 → "20h 34m"). */
export function formatMinutes(minutesValue: number): string {
  const value = Number(minutesValue);
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}h ${minutes}m`;
}

/** Compact axis-tick label, e.g. 300 → "5h", 90 → "1h30m", 30 → "30m". */
export function formatTick(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h${remainder}m`;
}

export function formatNumber(value: number): string {
  // Coerce first: a "numeric" field that is actually a string would otherwise
  // pass through String.prototype.toLocaleString() unchanged and reach innerHTML.
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString('en-US') : '0';
}

export function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Epoch seconds → medium date, e.g. "Jul 6, 2026". */
export function formatDate(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return 'not available';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "YYYY-MM-DD" (UTC) → "Mon, Jul 6" for calendar tooltips. */
export function formatDayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "YYYY-MM-DD" (UTC) → "Jul 6" for compact axis labels. */
export function shortDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Round `range` to a "nice" 1/2/5×10ⁿ value for tick spacing. */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else {
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exponent);
}

/** Build a graduated scale (in minutes) that comfortably contains `maxMinutes`. */
export function buildScale(maxMinutes: number): { axisMax: number; ticks: number[] } {
  if (!(maxMinutes > 0)) return { axisMax: 60, ticks: [0, 60] };
  const maxHours = maxMinutes / 60;
  const stepHours = niceNum(maxHours / 5, true);
  const count = Math.ceil(maxHours / stepHours);
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round(i * stepHours * 60));
  return { axisMax: count * stepHours * 60, ticks };
}
