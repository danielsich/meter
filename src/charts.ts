import type { ClockworkExport, DailyEntry, SessionEntry, TokenUsage } from './clockwork';
import {
  buildScale,
  formatDayLabel,
  formatMinutes,
  formatNumber,
  formatTick,
  formatTokens,
  shortDate,
} from './display';
import {
  activeDates,
  allPrompts,
  allSessions,
  computeStreaks,
  contributionGrid,
  hourHistogram,
  hourLevel,
  sortedDaily,
  sumTokenUsage,
} from './stats';
import { escapeHtml } from './validate';

export type ChartMetric = 'minutes' | 'prompts' | 'tokens';
export type DaySort = 'date' | 'asc' | 'desc';

/** 24-cell hour-of-day heatmap from a prompt-timestamp list. */
export function heatmapHTML(prompts: number[]): string {
  const hist = hourHistogram(prompts);
  const max = Math.max(...hist);
  const cells = hist
    .map((count, h) => {
      const label = `${String(h).padStart(2, '0')}:00: ${count} ${
        count === 1 ? 'prompt' : 'prompts'
      }`;
      return `<span class="cell lvl-${hourLevel(
        count,
        max,
      )}" title="${label}"></span>`;
    })
    .join('');
  const axis = [0, 6, 12, 18, 23]
    .map((h) => `<span style="grid-column:${h + 1}">${h}</span>`)
    .join('');
  return `<div class="heat">${cells}</div><div class="heat-axis">${axis}</div>`;
}

/** GitHub-style last-12-weeks contribution calendar. */
function contributionHTML(data: ClockworkExport): string {
  const { columns } = contributionGrid(data, 12);
  const cells = columns
    .map((column) =>
      column
        .map((cell) => {
          if (cell.inFuture) return `<span class="cell empty"></span>`;
          const time =
            cell.minutes > 0 ? formatMinutes(cell.minutes) : 'no activity';
          return `<span class="cell lvl-${cell.level}" title="${escapeHtml(
            formatDayLabel(cell.dateStr),
          )}: ${time}"></span>`;
        })
        .join(''),
    )
    .join('');
  return `<div class="contrib">${cells}</div>`;
}

/** Scatter plot: session start time-of-day (X) vs duration or prompts (Y). */
function sessionRhythmHTML(sessions: SessionEntry[], metric: ChartMetric): string {
  if (!sessions.length) return '';

  const sessionMetric = metric === 'tokens' ? 'minutes' : metric;
  const usePrompts = sessionMetric === 'prompts';
  const yVal = (session: SessionEntry) => usePrompts ? session.prompts : session.minutes;
  // Iterate rather than spread: `Math.max(...bigArray)` overflows the call
  // stack on very large session lists.
  let maxY = usePrompts ? 10 : 60;
  for (const session of sessions) {
    const value = yVal(session);
    if (value > maxY) maxY = value;
  }

  const VW = 780, VH = 160;
  const ML = 46, MR = 12, MT = 10, MB = 28;
  const cW = VW - ML - MR;
  const cH = VH - MT - MB;
  const { axisMax, ticks } = buildScale(maxY);

  const xOf = (seconds: number) => {
    const date = new Date(seconds * 1000);
    return ML + ((date.getHours() + date.getMinutes() / 60) / 24) * cW;
  };
  const yOf = (value: number) => MT + cH - Math.min(1, value / axisMax) * cH;

  const gridLines = [6, 12, 18]
    .map((hour) => {
      const x = (ML + (hour / 24) * cW).toFixed(1);
      return `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + cH}" stroke="#2b3743" stroke-width="1"/>`;
    })
    .join('');

  const xAxis = [0, 6, 12, 18, 24]
    .map((hour) => {
      const x = (ML + (hour / 24) * cW).toFixed(1);
      const label = hour < 24 ? `${hour}` : '';
      return (
        `<line x1="${x}" y1="${MT + cH}" x2="${x}" y2="${MT + cH + 4}" stroke="#2b3743" stroke-width="1"/>` +
        (label
          ? `<text x="${x}" y="${VH - 3}" text-anchor="middle" fill="#8a97a2" font-size="10" font-family="'JetBrains Mono',monospace">${label}</text>`
          : '')
      );
    })
    .join('');

  const yAxis = ticks
    .map((tick) => {
      const y = yOf(tick).toFixed(1);
      const label = usePrompts ? String(tick) : formatTick(tick);
      return (
        `<line x1="${ML - 4}" y1="${y}" x2="${ML}" y2="${y}" stroke="#2b3743" stroke-width="1"/>` +
        `<text x="${ML - 7}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" fill="#8a97a2" font-size="9" font-family="'JetBrains Mono',monospace">${label}</text>`
      );
    })
    .join('');

  const dots = sessions
    .map((session) => {
      const cx = xOf(session.start).toFixed(1);
      const cy = yOf(yVal(session)).toFixed(1);
      const tip = usePrompts
        ? `${formatNumber(session.prompts)} prompts · ${formatMinutes(session.minutes)}`
        : `${formatMinutes(session.minutes)} · ${formatNumber(session.prompts)} prompts`;
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#d8a24a" opacity="0.52"><title>${escapeHtml(tip)}</title></circle>`;
    })
    .join('');

  const subLabel = usePrompts
    ? 'Each dot is a session. Its position shows the start time and number of prompts.'
    : 'Each dot is a session. Its position shows the start time and duration.';

  const toggle = (value: ChartMetric, label: string) =>
    `<button class="toggle-btn${sessionMetric === value ? ' active' : ''}" data-metric="${value}" type="button">${label}</button>`;

  return `
    <div class="scatter-wrap card">
      <div class="chart-header">
        <h3>Session rhythm</h3>
        <div class="chart-toggle" role="group" aria-label="Y axis metric">
          ${toggle('minutes', 'time')}${toggle('prompts', 'prompts')}
        </div>
      </div>
      <p class="chart-sub">${subLabel}</p>
      <svg class="scatter" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Scatter plot of session start time versus ${usePrompts ? 'prompts' : 'duration'}">
        <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + cH}" stroke="#2b3743" stroke-width="1"/>
        <line x1="${ML}" y1="${MT + cH}" x2="${ML + cW}" y2="${MT + cH}" stroke="#2b3743" stroke-width="1"/>
        ${gridLines}${xAxis}${yAxis}${dots}
      </svg>
    </div>`;
}

/** Per-day horizontal bar chart for one project's daily breakdown. */
export function dayBarsHTML(
  daily: DailyEntry[],
  metric: ChartMetric,
  daySort: DaySort,
): string {
  const byDate = sortedDaily(daily);
  const usePrompts = metric === 'prompts';
  const useTokens = metric === 'tokens';
  const valueOf = (day: DailyEntry) =>
    useTokens ? (day.tokens?.total ?? 0) : usePrompts ? day.prompts : day.minutes;
  const days =
    daySort === 'asc' ? [...byDate].sort((a, b) => valueOf(a) - valueOf(b)) :
    daySort === 'desc' ? [...byDate].sort((a, b) => valueOf(b) - valueOf(a)) :
    byDate;
  let max = 1;
  for (const day of days) {
    const value = valueOf(day);
    if (value > max) max = value;
  }
  const rows = days
    .map((day) => {
      const width = ((valueOf(day) / max) * 100).toFixed(1);
      const primary = useTokens
        ? `${formatTokens(day.tokens?.total ?? 0)}<span class="unit">tok</span>`
        : usePrompts
        ? `${formatNumber(day.prompts)}<span class="unit">p</span>`
        : formatMinutes(day.minutes);
      const secondary = useTokens
        ? `${formatNumber(day.tokens?.responses ?? 0)}<span class="unit">r</span>`
        : usePrompts
        ? formatMinutes(day.minutes)
        : `${formatNumber(day.prompts)}<span class="unit">p</span>`;
      return `
      <div class="daybar">
        <span class="db-date">${escapeHtml(shortDate(day.date))}</span>
        <span class="db-track"><span class="db-fill" style="width:${width}%"></span></span>
        <span class="db-min">${primary}</span>
        <span class="db-p">${secondary}</span>
      </div>`;
    })
    .join('');
  return `<div class="daybars">${rows}</div>`;
}

export function dayBarsToggleHTML(
  metric: ChartMetric,
  daySort: DaySort,
  hasTokens: boolean,
): string {
  const metricButton = (value: ChartMetric, label: string) =>
    `<button class="toggle-btn${metric === value ? ' active' : ''}" data-metric="${value}" type="button">${label}</button>`;
  const sortButton = (value: Exclude<DaySort, 'date'>, label: string) =>
    `<button class="toggle-btn${daySort === value ? ' active' : ''}" data-day-sort="${value}" type="button" title="${value === 'asc' ? 'Least first' : 'Most first'}">${label}</button>`;
  return `
    <div class="chart-controls">
      <div class="chart-toggle" role="group" aria-label="Y axis metric">
        ${metricButton('minutes', 'time')}${metricButton('prompts', 'prompts')}${hasTokens ? metricButton('tokens', 'tokens') : ''}
      </div>
      <div class="chart-toggle" role="group" aria-label="Sort order">
        ${sortButton('asc', '↑')}${sortButton('desc', '↓')}
      </div>
    </div>`;
}

function tokenField(label: string, value: number): string {
  return `<div class="token-field"><span>${escapeHtml(label)}</span><strong>${formatTokens(value)}</strong></div>`;
}

/** Model mix plus a separate cache-efficiency signal, avoiding an unreadable stack. */
export function renderTokenUsage(
  container: HTMLElement | null,
  data: ClockworkExport,
  compare: ClockworkExport | null = null,
): void {
  if (!container) return;

  const primary = data.totals.tokens;
  const secondary = compare?.totals.tokens;
  if (!primary || (compare && !secondary)) {
    const filtered =
      (data.tokens === true && !primary) ||
      (compare?.tokens === true && !secondary);
    container.innerHTML = `<div class="hint card">${
      filtered
        ? 'Token usage is hidden because tokens cannot be attributed to individual sessions. Choose <strong>All</strong> under min session to restore it.'
        : 'Export with <code>--tokens</code> to see model usage.'
    }</div>`;
    return;
  }

  const usage = sumTokenUsage([primary, secondary]) as TokenUsage;
  const reusableInput = usage.input + usage.cache_read;
  const cachePct = reusableInput > 0 ? (usage.cache_read / reusableInput) * 100 : 0;
  const freshPct = 100 - cachePct;
  const perResponse = usage.responses > 0 ? usage.total / usage.responses : 0;
  const fields = [
    tokenField('fresh input', usage.input),
    tokenField('output', usage.output),
    tokenField('cache read', usage.cache_read),
    usage.cache_write > 0 ? tokenField('cache write', usage.cache_write) : '',
    usage.reasoning > 0 ? tokenField('reasoning · in output', usage.reasoning) : '',
  ].join('');
  const modelUsage = usage.by_model ?? [];
  const maxModel = modelUsage[0]?.total ?? 1;
  const models = modelUsage
    .map((model) => {
      const width = Math.min(100, (model.total / maxModel) * 100).toFixed(1);
      return `<div class="model-row">
        <span class="model-name" title="${escapeHtml(model.model)}">${escapeHtml(model.model)}</span>
        <span class="model-track"><span style="width:${width}%"></span></span>
        <strong>${formatTokens(model.total)}</strong>
        <small>${formatNumber(model.responses)} responses</small>
      </div>`;
    })
    .join('');
  const modelList = models || `<p class="model-note">This export has no per-day model breakdown for the selected date range.</p>`;

  container.innerHTML = `<div class="token-card card">
    <div class="token-head">
      <div><span class="token-kicker">Model usage</span><strong>${formatTokens(usage.total)}</strong><small>${formatNumber(usage.responses)} responses · ${formatTokens(perResponse)} tokens / response</small></div>
      <div class="cache-score"><strong>${cachePct.toFixed(1)}%</strong><span>cache reuse</span></div>
    </div>
    <div class="cache-rail" title="Fresh input ${formatTokens(usage.input)} · cache read ${formatTokens(usage.cache_read)}">
      <span class="cache-fresh" style="width:${freshPct.toFixed(3)}%"></span><span class="cache-read" style="width:${cachePct.toFixed(3)}%"></span>
    </div>
    <div class="cache-legend"><span><i class="fresh-dot"></i>fresh input</span><span><i class="cache-dot"></i>cache read</span></div>
    <div class="token-fields">${fields}</div>
    <div class="model-list" aria-label="Token usage by model">${modelList}</div>
  </div>`;
}

/** Activity summary: streaks, calendar, and the global hour heatmap. */
export function renderActivity(
  activity: HTMLElement | null,
  data: ClockworkExport,
  metric: ChartMetric,
): void {
  if (!activity) return;

  const streaks = computeStreaks(activeDates(data));
  const prompts = allPrompts(data);

  if (streaks.activeDays === 0) {
    activity.innerHTML = prompts
      ? `<div class="heat-wrap card"><h3>When you work</h3>${heatmapHTML(
          prompts,
        )}</div>`
      : `<div class="hint card">Export with <code>--detail daily</code> or richer to see streaks and the calendar.</div>`;
    return;
  }

  const streakCard = (value: string, label: string, tag = '') =>
    `<div class="stat-card">
       <span class="sc-value">${value}</span>
       <span class="sc-label">${label}</span>
       ${tag}
     </div>`;

  const liveTag = `<span class="sc-tag ${streaks.live ? 'live' : 'ended'}">${
    streaks.live ? 'live' : 'ended'
  }</span>`;

  const streakCards = `
    <div class="streaks">
      ${streakCard(String(streaks.current), 'current streak · days', liveTag)}
      ${streakCard(String(streaks.longest), 'longest streak · days')}
      ${streakCard(String(streaks.activeDays), 'total active days')}
    </div>`;

  const heat = prompts
    ? `<div class="heat-wrap"><h3>When you work</h3>${heatmapHTML(prompts)}</div>`
    : `<div class="hint">Export with <code>clockwork both export</code> (default <code>--detail raw</code>) to see hourly activity.</div>`;

  const sessions = allSessions(data);
  const scatter = sessions.length
    ? sessionRhythmHTML(sessions, metric)
    : '';

  activity.innerHTML = `
    ${streakCards}
    <div class="cal-heat">
      <div class="calendar"><h3>Last 12 weeks</h3>${contributionHTML(data)}</div>
      ${heat}
    </div>
    ${scatter}`;
}
