import './styles.css';
import type { ClockworkExport, ClockworkProject, DailyEntry, SessionEntry } from './clockwork';
import {
  activeDates,
  allPrompts,
  allSessions,
  computeStreaks,
  contributionGrid,
  filterByMinSession,
  filterByProvider,
  filterExport,
  hasDateData,
  hasSessionData,
  hourHistogram,
  hourLevel,
  presetToFilter,
  projectRange,
  providersOf,
  sortedDaily,
  type DateFilter,
  type RangePreset,
} from './stats';
import {
  ACCEPTED_SCHEMAS_LABEL,
  MAX_FILE_BYTES,
  escapeHtml,
  isSchemaSupported,
  structuralError,
} from './validate';

/** Format a duration in minutes as "Xh Ym" (e.g. 1234.76 → "20h 34m"). */
export function formatMinutes(m: number): string {
  const n = Number(m);
  const total = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}h ${minutes}m`;
}

/** Compact axis-tick label, e.g. 300 → "5h", 90 → "1h30m", 30 → "30m". */
function formatTick(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

function formatNumber(n: number): string {
  // Coerce first: a "numeric" field that is actually a string would otherwise
  // pass through String.prototype.toLocaleString() unchanged and reach innerHTML.
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : '0';
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Epoch seconds → medium date, e.g. "Jul 6, 2026". */
function formatDate(sec: number): string {
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "YYYY-MM-DD" (UTC) → "Mon, Jul 6" for calendar tooltips. */
function formatDayLabel(dateStr: string): string {
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
function shortDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Project deep-links live in the URL *fragment* (`#project=…`), never the query
 * string. A fragment is not transmitted to the server, so reloading or sharing a
 * link to an uploaded project never discloses its id to the host's request logs
 * — keeping the "your file never leaves the browser" promise intact.
 */
function setProjectDeepLink(id: string | null): void {
  const base = location.pathname + location.search;
  const target = id ? `${base}#project=${encodeURIComponent(id)}` : base;
  history.replaceState(null, '', target);
}

function readProjectDeepLink(): string | null {
  return new URLSearchParams(location.hash.replace(/^#/, '')).get('project');
}

/** Round `range` to a "nice" 1/2/5×10ⁿ value for tick spacing. */
function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

/** Build a graduated scale (in minutes) that comfortably contains `maxMinutes`. */
function buildScale(maxMinutes: number): { axisMax: number; ticks: number[] } {
  if (!(maxMinutes > 0)) return { axisMax: 60, ticks: [0, 60] };
  const maxHours = maxMinutes / 60;
  const stepHours = niceNum(maxHours / 5, true);
  const count = Math.ceil(maxHours / stepHours);
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round(i * stepHours * 60));
  return { axisMax: count * stepHours * 60, ticks };
}

const el = (id: string) => document.getElementById(id);

/** Where the currently displayed data came from. */
type Source = { kind: 'published' } | { kind: 'upload'; filename: string };

let _rawData: ClockworkExport | null = null;
let _compareData: ClockworkExport | null = null;
let _currentSource: Source | null = null;
let _activePreset: RangePreset | 'all' = 'all';
let _providerFilter: string = 'all';
let _minSession: number = 0;
let _yMetric: 'minutes' | 'prompts' = 'minutes';
let _daySort: 'date' | 'asc' | 'desc' = 'date';

function applyFilter(data: ClockworkExport, filter: DateFilter | null): ClockworkExport {
  return filter ? filterExport(data, filter) : data;
}

function renderRangeBar(data: ClockworkExport): void {
  const bar = el('range-bar');
  if (!bar) return;
  const hasDates = hasDateData(data);
  const presets: Array<{ key: RangePreset | 'all'; label: string }> = [
    { key: 'all', label: 'All time' },
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
    { key: '90d', label: '90d' },
  ];
  const buttons = presets
    .map((p) => {
      const active = p.key === _activePreset;
      const disabled = !hasDates && p.key !== 'all';
      return `<button class="range-btn${active ? ' active' : ''}" data-preset="${p.key}"${disabled ? ' disabled' : ''} type="button">${p.label}</button>`;
    })
    .join('');
  const hint = !hasDates
    ? `<span class="range-hint">needs <code>--detail daily</code> to filter</span>`
    : '';
  bar.innerHTML = buttons + hint;
  bar.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activePreset = (btn.dataset.preset ?? 'all') as RangePreset | 'all';
      if (_rawData) rerender(_rawData);
    });
  });
}

const SESSION_PRESETS: Array<{ label: string; value: number }> = [
  { label: 'All', value: 0 },
  { label: '5m+', value: 5 },
  { label: '15m+', value: 15 },
  { label: '30m+', value: 30 },
];

function renderSessionBar(data: ClockworkExport): void {
  const bar = el('session-bar');
  if (!bar) return;
  const hasSessions = hasSessionData(data);
  const buttons = SESSION_PRESETS.map((p) => {
    const active = p.value === _minSession;
    const disabled = !hasSessions && p.value > 0;
    return `<button class="range-btn${active ? ' active' : ''}" data-session="${p.value}"${disabled ? ' disabled' : ''} type="button">${p.label}</button>`;
  }).join('');
  const hint = !hasSessions
    ? `<span class="range-hint">needs <code>--detail sessions</code> to filter</span>`
    : '';
  bar.innerHTML = `<span class="range-label">min session</span>${buttons}${hint}`;
  bar.querySelectorAll<HTMLButtonElement>('[data-session]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _minSession = Number(btn.dataset.session ?? 0);
      if (_rawData) rerender(_rawData);
    });
  });
}

/**
 * Provider filter for a combined clockwork/v2 export. Hidden entirely unless the
 * loaded file spans more than one provider (and we're not already in file-vs-file
 * comparison, which owns the same visual channel).
 */
function renderProviderBar(providers: string[]): void {
  const bar = el('provider-bar');
  if (!bar) return;

  if (_compareData || providers.length < 2) {
    bar.innerHTML = '';
    bar.hidden = true;
    return;
  }
  bar.hidden = false;

  const choices = ['all', ...providers];
  const label = (key: string) => (key === 'all' ? 'Both' : key);
  const buttons = choices
    .map((key) => {
      const active = key === _providerFilter;
      return `<button class="range-btn${active ? ' active' : ''}" data-provider="${escapeHtml(key)}" type="button">${escapeHtml(label(key))}</button>`;
    })
    .join('');

  // In the combined ("Both") view with exactly two providers, the bars are split
  // A|B — a legend maps each colour back to its tool.
  const legend =
    _providerFilter === 'all' && providers.length === 2
      ? `<span class="prov-legend">
           <span class="prov-key"><span class="prov-dot prov-dot-a"></span>${escapeHtml(providers[0])}</span>
           <span class="prov-key"><span class="prov-dot prov-dot-b"></span>${escapeHtml(providers[1])}</span>
         </span>`
      : '';

  bar.innerHTML = `<span class="range-label">tool</span>${buttons}${legend}`;
  bar.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _providerFilter = btn.dataset.provider ?? 'all';
      if (_rawData) rerender(_rawData);
    });
  });
}

function wireMetricToggle(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _yMetric = (btn.dataset.metric ?? 'minutes') as 'minutes' | 'prompts';
      if (_rawData) rerender(_rawData);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-day-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = (btn.dataset.daySort ?? 'asc') as 'asc' | 'desc';
      _daySort = _daySort === s ? 'date' : s;
      if (_rawData) rerender(_rawData);
    });
  });
}

function applyAllFilters(data: ClockworkExport): ClockworkExport {
  const filter = _activePreset !== 'all' ? presetToFilter(_activePreset) : null;
  let view = applyFilter(data, filter);
  if (_minSession > 0) view = filterByMinSession(view, _minSession);
  return view;
}

function rerender(data: ClockworkExport): void {
  const providers = providersOf(data);
  const multi = !_compareData && providers.length > 1;
  // Reset a stale selection if the newly loaded file doesn't carry that provider.
  if (_providerFilter !== 'all' && !providers.includes(_providerFilter)) {
    _providerFilter = 'all';
  }

  let view: ClockworkExport;
  let compareView: ClockworkExport | null;
  let activitySource: ClockworkExport;
  let mergeByPath = false;

  if (_compareData) {
    // File-vs-file comparison (two uploaded exports) — unchanged.
    view = applyAllFilters(data);
    compareView = applyAllFilters(_compareData);
    activitySource = data;
  } else if (multi && _providerFilter !== 'all') {
    // Narrowed to a single tool within a combined export.
    activitySource = filterByProvider(data, _providerFilter);
    view = applyAllFilters(activitySource);
    compareView = null;
  } else if (multi && providers.length === 2) {
    // Combined "Both" view: split each project's bar into its two tools.
    view = applyAllFilters(filterByProvider(data, providers[0]));
    compareView = applyAllFilters(filterByProvider(data, providers[1]));
    activitySource = data;
    mergeByPath = true;
  } else {
    view = applyAllFilters(data);
    compareView = null;
    activitySource = data;
  }

  renderProviderBar(providers);
  renderRangeBar(data);
  renderSessionBar(data);
  renderReadout(view, compareView);
  renderActivity(applyAllFilters(activitySource));
  renderProjects(view, compareView, mergeByPath);
  initDeepLink();
  wireMetricToggle();
}

function clear(...ids: string[]): void {
  for (const id of ids) {
    const node = el(id);
    if (node) node.innerHTML = '';
  }
}

function renderError(headline: string, detail: string): void {
  clear('meta', 'readout', 'activity', 'sample-note');
  const meter = el('meter');
  if (!meter) return;
  meter.innerHTML = `
    <div class="notice">
      <span class="notice-mark">no signal</span>
      <p class="notice-head">${escapeHtml(headline)}</p>
      <p class="notice-detail">${escapeHtml(detail)}</p>
    </div>`;
}

function renderMeta(data: ClockworkExport, source: Source, compare?: ClockworkExport | null): void {
  const meta = el('meta');
  if (!meta) return;
  const src =
    source.kind === 'upload'
      ? `<span class="src" title="${escapeHtml(source.filename)}">your file</span>`
      : '';
  const providerChips = compare
    ? `<span class="chip chip-a">${escapeHtml(data.provider)}</span><span class="chip-vs">vs</span><span class="chip chip-b">${escapeHtml(compare.provider)}</span><button class="clear-compare" id="clear-compare" type="button" title="Exit comparison mode">✕ compare</button>`
    : `<span class="chip">${escapeHtml(data.provider)}</span>`;
  meta.innerHTML = `
    ${providerChips}
    <span class="gen">updated ${escapeHtml(formatGeneratedAt(data.generated_at))}</span>
    ${src}`;
}

function renderReadout(data: ClockworkExport, compare?: ClockworkExport | null): void {
  const readout = el('readout');
  if (!readout) return;
  const t = data.totals;
  const c = compare?.totals;
  const minutes  = t.minutes  + (c?.minutes  ?? 0);
  const prompts  = t.prompts  + (c?.prompts  ?? 0);
  const sessions = t.sessions + (c?.sessions ?? 0);
  // Unique project count. Key by path so a project touched by both tools (its
  // own id per provider in v2, but the same path) counts once — matching the
  // merged row list. Falls back to id when a path is absent (anonymized/v1).
  const key = (p: ClockworkProject) => p.path ?? p.id;
  const projects = compare
    ? new Set([...data.projects.map(key), ...compare.projects.map(key)]).size
    : t.projects;
  readout.innerHTML = `
    <div class="total">
      <span class="total-value">${formatMinutes(minutes)}</span>
      <span class="total-label">total time logged</span>
    </div>
    <dl class="secondary">
      <div class="metric">
        <dt>prompts</dt><dd>${formatNumber(prompts)}</dd>
      </div>
      <div class="metric">
        <dt>sessions</dt><dd>${formatNumber(sessions)}</dd>
      </div>
      <div class="metric">
        <dt>projects</dt><dd>${formatNumber(projects)}</dd>
      </div>
    </dl>`;
}

/** 24-cell hour-of-day heatmap from a prompt-timestamp list. */
function heatmapHTML(prompts: number[]): string {
  const hist = hourHistogram(prompts);
  const max = Math.max(...hist);
  const cells = hist
    .map((count, h) => {
      const label = `${String(h).padStart(2, '0')}:00 — ${count} ${
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
          )} — ${time}"></span>`;
        })
        .join(''),
    )
    .join('');
  return `<div class="contrib">${cells}</div>`;
}

/** Scatter plot: session start time-of-day (X) vs duration or prompts (Y). */
function sessionRhythmHTML(sessions: SessionEntry[]): string {
  if (!sessions.length) return '';

  const usePrompts = _yMetric === 'prompts';
  const yVal = (s: SessionEntry) => usePrompts ? s.prompts : s.minutes;
  // Iterate rather than spread: `Math.max(...bigArray)` overflows the call
  // stack on very large session lists.
  let maxY = usePrompts ? 10 : 60;
  for (const s of sessions) {
    const v = yVal(s);
    if (v > maxY) maxY = v;
  }

  const VW = 780, VH = 160;
  const ML = 46, MR = 12, MT = 10, MB = 28;
  const cW = VW - ML - MR;
  const cH = VH - MT - MB;

  // Y axis scale
  const { axisMax, ticks } = usePrompts
    ? buildScale(maxY)
    : buildScale(maxY);

  const xOf = (sec: number) => {
    const d = new Date(sec * 1000);
    return ML + ((d.getHours() + d.getMinutes() / 60) / 24) * cW;
  };
  const yOf = (v: number) => MT + cH - Math.min(1, v / axisMax) * cH;

  const gridLines = [6, 12, 18]
    .map((h) => {
      const x = (ML + (h / 24) * cW).toFixed(1);
      return `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + cH}" stroke="#2b3743" stroke-width="1"/>`;
    })
    .join('');

  const xAxis = [0, 6, 12, 18, 24]
    .map((h) => {
      const x = (ML + (h / 24) * cW).toFixed(1);
      const label = h < 24 ? `${h}` : '';
      return (
        `<line x1="${x}" y1="${MT + cH}" x2="${x}" y2="${MT + cH + 4}" stroke="#2b3743" stroke-width="1"/>` +
        (label
          ? `<text x="${x}" y="${VH - 3}" text-anchor="middle" fill="#8a97a2" font-size="10" font-family="'JetBrains Mono',monospace">${label}</text>`
          : '')
      );
    })
    .join('');

  const yAxis = ticks
    .map((t) => {
      const y = yOf(t).toFixed(1);
      const label = usePrompts ? String(t) : formatTick(t);
      return (
        `<line x1="${ML - 4}" y1="${y}" x2="${ML}" y2="${y}" stroke="#2b3743" stroke-width="1"/>` +
        `<text x="${ML - 7}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" fill="#8a97a2" font-size="9" font-family="'JetBrains Mono',monospace">${label}</text>`
      );
    })
    .join('');

  const dots = sessions
    .map((s) => {
      const cx = xOf(s.start).toFixed(1);
      const cy = yOf(yVal(s)).toFixed(1);
      const tip = usePrompts
        ? `${formatNumber(s.prompts)} prompts · ${formatMinutes(s.minutes)}`
        : `${formatMinutes(s.minutes)} · ${formatNumber(s.prompts)} prompts`;
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#d8a24a" opacity="0.52"><title>${escapeHtml(tip)}</title></circle>`;
    })
    .join('');

  const subLabel = usePrompts
    ? 'Each dot is a session — when it started vs. prompts sent.'
    : 'Each dot is a session — when it started vs. how long it ran.';

  const toggle = (m: 'minutes' | 'prompts', label: string) =>
    `<button class="toggle-btn${_yMetric === m ? ' active' : ''}" data-metric="${m}" type="button">${label}</button>`;

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
function dayBarsHTML(daily: DailyEntry[]): string {
  const byDate = sortedDaily(daily);
  const usePrompts = _yMetric === 'prompts';
  const valueOf = (d: DailyEntry) => usePrompts ? d.prompts : d.minutes;
  const days =
    _daySort === 'asc' ? [...byDate].sort((a, b) => valueOf(a) - valueOf(b)) :
    _daySort === 'desc' ? [...byDate].sort((a, b) => valueOf(b) - valueOf(a)) :
    byDate;
  let max = 1;
  for (const d of days) {
    const v = valueOf(d);
    if (v > max) max = v;
  }
  const rows = days
    .map((d) => {
      const w = ((valueOf(d) / max) * 100).toFixed(1);
      const primary = usePrompts
        ? `${formatNumber(d.prompts)}<span class="unit">p</span>`
        : formatMinutes(d.minutes);
      const secondary = usePrompts
        ? formatMinutes(d.minutes)
        : `${formatNumber(d.prompts)}<span class="unit">p</span>`;
      return `
      <div class="daybar">
        <span class="db-date">${escapeHtml(shortDate(d.date))}</span>
        <span class="db-track"><span class="db-fill" style="width:${w}%"></span></span>
        <span class="db-min">${primary}</span>
        <span class="db-p">${secondary}</span>
      </div>`;
    })
    .join('');
  return `<div class="daybars">${rows}</div>`;
}

function dayBarsToggleHTML(): string {
  const metric = (m: 'minutes' | 'prompts', label: string) =>
    `<button class="toggle-btn${_yMetric === m ? ' active' : ''}" data-metric="${m}" type="button">${label}</button>`;
  const sort = (s: 'asc' | 'desc', label: string) =>
    `<button class="toggle-btn${_daySort === s ? ' active' : ''}" data-day-sort="${s}" type="button" title="${s === 'asc' ? 'Least first' : 'Most first'}">${label}</button>`;
  return `
    <div class="chart-controls">
      <div class="chart-toggle" role="group" aria-label="Y axis metric">
        ${metric('minutes', 'time')}${metric('prompts', 'prompts')}
      </div>
      <div class="chart-toggle" role="group" aria-label="Sort order">
        ${sort('asc', '↑')}${sort('desc', '↓')}
      </div>
    </div>`;
}

const LINK_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12"/></svg>`;

/** Body of a project's expanded drill-down panel. */
function drillContent(
  p: ClockworkProject,
  pCompare?: ClockworkProject | null,
  providerA?: string,
  providerB?: string,
): string {
  const range = projectRange(p);
  const stat = (label: string, value: string) =>
    `<div class="ds"><span class="ds-v">${value}</span><span class="ds-l">${label}</span></div>`;

  const ppm =
    p.totals.minutes > 0
      ? (p.totals.prompts / p.totals.minutes).toFixed(1)
      : '—';

  const splitStat = pCompare
    ? `<div class="ds ds-split">
        <span class="ds-v">
          <span class="cmp-a">${formatMinutes(p.totals.minutes)}</span>
          <span class="cmp-sep"> · </span>
          <span class="cmp-b">${formatMinutes(pCompare.totals.minutes)}</span>
        </span>
        <span class="ds-l">${escapeHtml(providerA ?? 'primary')} · ${escapeHtml(providerB ?? 'compare')}</span>
      </div>`
    : '';

  const stats = `
    <div class="drill-stats">
      ${splitStat}
      ${stat('active days', formatNumber(p.totals.active_days))}
      ${stat('sessions', formatNumber(p.totals.sessions))}
      ${stat('prompts / min', ppm)}
      ${range.first !== undefined ? stat('first', formatDate(range.first)) : ''}
      ${range.last !== undefined ? stat('last', formatDate(range.last)) : ''}
    </div>`;

  const copyBtn = `<button class="copy-link" data-copy-link="${escapeHtml(p.id)}" type="button" title="Copy link to this project">${LINK_ICON}<span class="copy-label">Copy link</span></button>`;

  const hasDailyData = !!(p.daily && p.daily.length);
  const days = hasDailyData
    ? dayBarsHTML(p.daily!)
    : `<p class="hint">No per-day breakdown in this export — use <code>--detail daily</code> or richer.</p>`;

  const heat =
    p.prompts && p.prompts.length
      ? `<div class="heat-wrap"><h4>Hour of day</h4>${heatmapHTML(p.prompts)}</div>`
      : `<p class="hint">Hourly activity needs a <code>--detail raw</code> export.</p>`;

  const dayToggle = hasDailyData ? dayBarsToggleHTML() : '';

  return `
    <div class="drill-header">${copyBtn}</div>
    ${stats}
    <div class="drill-charts">
      <div class="drill-days">
        <div class="chart-header"><h4>Per day</h4>${dayToggle}</div>
        ${days}
      </div>
      ${heat}
    </div>`;
}

/** Activity summary: streaks, calendar, and the global hour heatmap. */
function renderActivity(data: ClockworkExport): void {
  const activity = el('activity');
  if (!activity) return;

  const streaks = computeStreaks(activeDates(data));
  const prompts = allPrompts(data);

  if (streaks.activeDays === 0) {
    // No daily data at all — offer the global heatmap if prompts somehow exist,
    // otherwise a single hint. Keeps the section from rendering empty boxes.
    activity.innerHTML = prompts
      ? `<div class="heat-wrap card"><h3>When you work</h3>${heatmapHTML(
          prompts,
        )}</div>`
      : `<div class="hint card">Streaks and the calendar need a <code>--detail daily</code> export (or richer).</div>`;
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
    ? sessionRhythmHTML(sessions)
    : '';

  activity.innerHTML = `
    ${streakCards}
    <div class="cal-heat">
      <div class="calendar"><h3>Last 12 weeks</h3>${contributionHTML(data)}</div>
      ${heat}
    </div>
    ${scatter}`;
}

interface SplitRow {
  id: string;
  name: string;
  minutesA: number;
  minutesB: number;
  promptsA: number;
  promptsB: number;
  projectA: ClockworkProject | null;
  projectB: ClockworkProject | null;
}

/**
 * Merge two exports into per-project rows carrying both sides.
 *
 * `keyOf` decides what counts as "the same project". File-vs-file comparison
 * keys by `id` (v1 ids are sha1(path), stable across files). Provider split keys
 * by path, because v2 ids fold the provider in — so the same path has a
 * different id under each tool and must be matched on path instead.
 */
function buildSplitRows(
  primary: ClockworkExport,
  compare: ClockworkExport,
  keyOf: (p: ClockworkProject) => string = (p) => p.id,
): SplitRow[] {
  const map = new Map<string, SplitRow>();
  for (const p of primary.projects) {
    map.set(keyOf(p), {
      id: p.id, name: p.name,
      minutesA: p.totals.minutes, minutesB: 0,
      promptsA: p.totals.prompts, promptsB: 0,
      projectA: p, projectB: null,
    });
  }
  for (const p of compare.projects) {
    const existing = map.get(keyOf(p));
    if (existing) {
      existing.minutesB = p.totals.minutes;
      existing.promptsB = p.totals.prompts;
      existing.projectB = p;
    } else {
      map.set(keyOf(p), {
        id: p.id, name: p.name,
        minutesA: 0, minutesB: p.totals.minutes,
        promptsA: 0, promptsB: p.totals.prompts,
        projectA: null, projectB: p,
      });
    }
  }
  return [...map.values()]
    .filter((r) => r.minutesA + r.minutesB > 0)
    .sort((a, b) => (b.minutesA + b.minutesB) - (a.minutesA + a.minutesB));
}

/** SVG chevron used on each expandable project row. */
const CHEVRON = `<svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderProjects(
  data: ClockworkExport,
  compare?: ClockworkExport | null,
  mergeByPath = false,
): void {
  const meter = el('meter');
  if (!meter) return;

  const isSplit = !!compare;
  const keyOf = mergeByPath
    ? (p: ClockworkProject) => p.path ?? p.name
    : (p: ClockworkProject) => p.id;

  // Build a unified list of rows (handles both normal and split mode)
  type Row = {
    id: string; name: string;
    totalMinutes: number; totalPrompts: number;
    minutesA: number; minutesB: number;
    project: ClockworkProject;
    projectB: ClockworkProject | null;
  };

  let rows: Row[];
  if (isSplit) {
    const merged = buildSplitRows(data, compare!, keyOf);
    if (!merged.length) {
      meter.innerHTML = `<div class="notice"><span class="notice-mark">idle</span><p class="notice-head">No overlapping projects found.</p></div>`;
      return;
    }
    rows = merged.map((r) => ({
      id: r.id, name: r.name,
      totalMinutes: r.minutesA + r.minutesB,
      totalPrompts: r.promptsA + r.promptsB,
      minutesA: r.minutesA, minutesB: r.minutesB,
      project: (r.projectA ?? r.projectB)!,
      projectB: r.projectB,
    }));
  } else {
    if (!data.projects.length) {
      meter.innerHTML = `
        <div class="notice">
          <span class="notice-mark">idle</span>
          <p class="notice-head">No projects on the meter yet.</p>
          <p class="notice-detail">Run <code>clockwork both export &gt; clockwork-data.json</code>, then <strong>Load .json</strong> to view it here.</p>
        </div>`;
      return;
    }
    const sorted = [...data.projects].sort((a, b) => b.totals.minutes - a.totals.minutes);
    rows = sorted.map((p) => ({
      id: p.id, name: p.name,
      totalMinutes: p.totals.minutes, totalPrompts: p.totals.prompts,
      minutesA: p.totals.minutes, minutesB: 0,
      project: p, projectB: null,
    }));
  }

  const maxTotal = rows[0].totalMinutes;
  const { axisMax, ticks } = buildScale(maxTotal);
  const pctOf = (m: number) => Math.min(100, (m / axisMax) * 100).toFixed(2);
  const leftPct = (t: number) => ((t / axisMax) * 100).toFixed(2);

  const scale = ticks
    .map((t) => `<span class="tick" style="left:${leftPct(t)}%">${formatTick(t)}</span>`)
    .join('');
  const grid = ticks
    .map((t) => `<span class="grid" style="left:${leftPct(t)}%"></span>`)
    .join('');

  const providerA = data.provider;
  const providerB = compare?.provider ?? '';

  const rowsHTML = rows
    .map((r, i) => {
      const rank = String(i + 1).padStart(2, '0');
      const totalPct = pctOf(r.totalMinutes);

      const barHTML = isSplit
        ? (() => {
            const pctA = r.totalMinutes > 0
              ? ((r.minutesA / r.totalMinutes) * 100).toFixed(2)
              : '0';
            return `<span class="bar bar-split" aria-hidden="true"><span class="bar-a" style="width:${pctA}%"></span><span class="bar-b" style="width:calc(100% - ${pctA}%)"></span></span>`;
          })()
        : `<span class="bar" aria-hidden="true"></span>`;

      const nameHTML = isSplit
        ? `<span class="pname pname--split">
            <span class="pname-text" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
            <span class="split-sub">
              <span class="sub-a">${formatMinutes(r.minutesA)}</span>
              <span class="sub-sep">·</span>
              <span class="sub-b">${formatMinutes(r.minutesB)}</span>
            </span>
          </span>`
        : `<span class="pname" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>`;

      const drillHTML = drillContent(r.project, isSplit ? r.projectB : null, providerA, providerB);

      return `
      <li class="row-item" data-project-id="${escapeHtml(r.id)}" style="--w:${totalPct}%;--i:${i}">
        <button class="row" type="button" aria-expanded="false" aria-controls="drill-${i}">
          ${barHTML}
          <span class="rank">${rank}</span>
          ${nameHTML}
          <span class="reading">${formatMinutes(r.totalMinutes)}</span>
          <span class="pcount">${formatNumber(r.totalPrompts)}<span class="unit">prompts</span></span>
          ${CHEVRON}
        </button>
        <div class="drill" id="drill-${i}" role="region" aria-hidden="true">
          <div class="drill-inner">${drillHTML}</div>
        </div>
      </li>`;
    })
    .join('');

  meter.innerHTML = `
    <div class="scale" aria-hidden="true">${scale}</div>
    <div class="chart">
      <div class="graticule" aria-hidden="true">${grid}</div>
      <ol class="rows${isSplit ? ' rows--split' : ''}">${rowsHTML}</ol>
    </div>`;

  wireDrilldowns(meter);
}

/** Expand/collapse project rows — one open at a time, keyboard-accessible. */
function wireDrilldowns(container: HTMLElement): void {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.row'),
  );

  const setOpen = (btn: HTMLButtonElement, open: boolean, updateUrl = true) => {
    const item = btn.closest<HTMLElement>('.row-item');
    const panel = document.getElementById(
      btn.getAttribute('aria-controls') ?? '',
    );
    item?.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    panel?.setAttribute('aria-hidden', String(!open));

    if (updateUrl) {
      setProjectDeepLink(open && item?.dataset.projectId ? item.dataset.projectId : null);
    }
  };

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const willOpen = btn.getAttribute('aria-expanded') !== 'true';
      for (const other of buttons) if (other !== btn) setOpen(other, false);
      setOpen(btn, willOpen);
    });
  }

  // Copy-link buttons inside drill-downs
  container.addEventListener('click', (e) => {
    const copyBtn = (e.target as Element).closest<HTMLButtonElement>('[data-copy-link]');
    if (!copyBtn) return;
    const id = copyBtn.dataset.copyLink ?? '';
    const url = new URL(location.href);
    url.hash = `project=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(url.href).then(() => {
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1600);
    }).catch(() => {/* clipboard permission denied */});
  });
}

/** The built-in placeholder written by scripts/prepare-data.mjs. */
function isSampleData(data: ClockworkExport): boolean {
  return (
    data.provider === 'sample' ||
    (data.projects.length === 1 && data.projects[0].id === 'sample')
  );
}

/** When only placeholder data is loaded, invite the visitor to load their own. */
function renderSampleState(data: ClockworkExport): void {
  const note = el('sample-note');
  const sample = isSampleData(data);
  if (note) {
    note.innerHTML = sample
      ? `<div class="banner">You're viewing <strong>sample data</strong>. Load your own clockwork export with <strong>Load .json</strong> — it stays in your browser and is never uploaded.</div>`
      : '';
  }
  if (sample) {
    const howto = el('howto') as HTMLDetailsElement | null;
    if (howto) howto.open = true;
  }
}

/** Validate a parsed export and render it, or show a clear error. */
function show(data: ClockworkExport, source: Source): void {
  if (!isSchemaSupported(data.schema)) {
    renderError(
      `This file reports schema "${data.schema ?? '(missing)'}".`,
      `meter reads ${ACCEPTED_SCHEMAS_LABEL}. Re-export with a current clockwork build.`,
    );
    return;
  }
  const shapeErr = structuralError(data);
  if (shapeErr) {
    renderError('This export is malformed.', shapeErr);
    return;
  }
  _rawData = data;
  _compareData = null;
  _currentSource = source;
  _activePreset = 'all';
  _providerFilter = 'all';
  _minSession = 0;
  _yMetric = 'minutes';
  _daySort = 'date';
  renderMeta(data, source);
  rerender(data);
  renderSampleState(data);
}

function setResetVisible(visible: boolean): void {
  const reset = el('reset');
  if (reset) reset.toggleAttribute('hidden', !visible);
}

/** Load the data bundled with the deployed site. */
async function loadPublished(): Promise<void> {
  setResetVisible(false);
  try {
    // Base-path-aware fetch — critical for the /meter/ Pages subpath.
    const res = await fetch(`${import.meta.env.BASE_URL}clockwork-data.json`);
    if (!res.ok) {
      renderError(
        `Could not load clockwork-data.json (HTTP ${res.status}).`,
        'Run the build so scripts/prepare-data.mjs writes it, or load a .json above.',
      );
      return;
    }
    show((await res.json()) as ClockworkExport, { kind: 'published' });
  } catch (err) {
    renderError(
      "clockwork-data.json couldn't be read.",
      `${err instanceof Error ? err.message : String(err)} — re-export it, or load a .json above.`,
    );
  }
}

/** Read and render a file the visitor picked or dropped, entirely in-browser. */
function loadFromFile(file: File): void {
  if (file.size > MAX_FILE_BYTES) {
    setResetVisible(true);
    renderError(
      `"${file.name}" is too large to open.`,
      `meter caps loaded files at ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB. A clockwork export is far smaller — check you picked the right file.`,
    );
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    setResetVisible(true);
    let data: ClockworkExport;
    try {
      data = JSON.parse(String(reader.result)) as ClockworkExport;
    } catch (err) {
      renderError(
        `"${file.name}" isn't valid JSON.`,
        `${err instanceof Error ? err.message : String(err)} — export it with clockwork and try again.`,
      );
      return;
    }
    if (!isSchemaSupported(data.schema)) {
      // Let show() handle the schema error properly
      show(data, { kind: 'upload', filename: file.name });
      return;
    }

    const shapeErr = structuralError(data);
    if (shapeErr) {
      renderError('This export is malformed.', shapeErr);
      return;
    }

    // Auto-detect comparison: two single-provider exports with different providers
    const isComparison =
      _rawData !== null &&
      _rawData.provider !== data.provider &&
      _rawData.provider !== 'both' &&
      data.provider !== 'both';

    if (isComparison) {
      _compareData = data;
      if (_rawData && _currentSource) {
        renderMeta(_rawData, _currentSource, data);
        rerender(_rawData);
      }
    } else {
      show(data, { kind: 'upload', filename: file.name });
    }
  };
  reader.onerror = () => {
    setResetVisible(true);
    renderError(`Couldn't read "${file.name}".`, 'Try loading the file again.');
  };
  reader.readAsText(file);
}

function clearCompare(): void {
  _compareData = null;
  if (_rawData && _currentSource) {
    renderMeta(_rawData, _currentSource);
    rerender(_rawData);
  }
}

/** Open the project matching #project= in the URL fragment after rendering. */
function initDeepLink(): void {
  const id = readProjectDeepLink();
  if (!id) return;
  const item = document.querySelector<HTMLElement>(
    `.row-item[data-project-id="${CSS.escape(id)}"]`,
  );
  if (!item) return;
  const btn = item.querySelector<HTMLButtonElement>('.row');
  if (btn && btn.getAttribute('aria-expanded') !== 'true') {
    btn.click();
    requestAnimationFrame(() =>
      item.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Render the current meter panel to a PNG and trigger a download. */
function exportMeterPNG(data: ClockworkExport): void {
  const projects = [...data.projects].sort(
    (a, b) => b.totals.minutes - a.totals.minutes,
  );
  if (!projects.length) return;

  const DPR = 2;
  const W = 880;
  const PX = 28, PT = 56, PB = 28;
  const ROW_H = 48, GAP = 8;
  const H = PT + projects.length * (ROW_H + GAP) - GAP + PB;

  const canvas = document.createElement('canvas');
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);

  // Panel background
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = '#171e25';
  ctx.fill();
  ctx.strokeStyle = '#2b3743';
  ctx.lineWidth = 1;
  ctx.stroke();

  const { axisMax, ticks } = buildScale(projects[0].totals.minutes);
  const cL = PX, cR = W - PX;
  const cW = cR - cL;

  // Scale ticks
  ctx.font = `11px 'JetBrains Mono', monospace`;
  ctx.fillStyle = '#8a97a2';
  ctx.textAlign = 'center';
  for (const t of ticks) {
    const x = cL + (t / axisMax) * cW;
    ctx.fillText(formatTick(t), x, PT - 18);
    ctx.strokeStyle = '#2b3743';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, PT - 13);
    ctx.lineTo(x, PT - 9);
    ctx.stroke();
  }

  // Grid lines
  ctx.strokeStyle = '#2b3743';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  for (const t of ticks) {
    const x = cL + (t / axisMax) * cW;
    ctx.beginPath();
    ctx.moveTo(x, PT);
    ctx.lineTo(x, H - PB);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  projects.forEach((p, i) => {
    const y = PT + i * (ROW_H + GAP);
    const bW = (p.totals.minutes / axisMax) * cW;

    // Row bg
    roundRect(ctx, cL, y, cW, ROW_H, 9);
    ctx.fillStyle = '#1f2831';
    ctx.fill();
    ctx.strokeStyle = '#2b3743';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Bar fill
    if (bW > 0) {
      const grad = ctx.createLinearGradient(cL, 0, cL + bW, 0);
      grad.addColorStop(0, 'rgba(216,162,74,0.16)');
      grad.addColorStop(1, 'rgba(216,162,74,0.24)');
      roundRect(ctx, cL, y, bW, ROW_H, 9);
      ctx.fillStyle = grad;
      ctx.fill();

      // Needle
      ctx.save();
      ctx.shadowColor = 'rgba(216,162,74,0.4)';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#f0c46a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cL + bW, y + 1);
      ctx.lineTo(cL + bW, y + ROW_H - 1);
      ctx.stroke();
      ctx.restore();
    }

    const mid = y + ROW_H / 2 + 5;

    // Rank
    ctx.font = `12px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#8a97a2';
    ctx.textAlign = 'left';
    ctx.fillText(String(i + 1).padStart(2, '0'), cL + 12, mid);

    // Name (truncate if needed)
    ctx.font = `500 14px 'Space Grotesk', system-ui`;
    ctx.fillStyle = '#e8e4d9';
    const maxNameW = cW * 0.45;
    let name = p.name;
    while (name.length > 3 && ctx.measureText(name).width > maxNameW) {
      name = name.slice(0, -1);
    }
    if (name !== p.name) name += '…';
    ctx.fillText(name, cL + 40, mid);

    // Reading
    ctx.font = `500 13px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#e8e4d9';
    ctx.textAlign = 'right';
    ctx.fillText(formatMinutes(p.totals.minutes), cR - 78, mid);

    // Prompts
    ctx.fillStyle = '#64b6a4';
    ctx.fillText(`${formatNumber(p.totals.prompts)} p`, cR - 8, mid);
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meter.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function wireControls(): void {
  const loadBtn = el('load');
  const resetBtn = el('reset');
  const input = el('file-input') as HTMLInputElement | null;
  const dropzone = el('dropzone');

  loadBtn?.addEventListener('click', () => input?.click());
  resetBtn?.addEventListener('click', () => void loadPublished());

  // Copyable command blocks in the how-to: click the icon or double-click the
  // command itself to copy it to the clipboard.
  const copyCommand = (cmd: Element): void => {
    const text = cmd.querySelector('code')?.textContent?.trim();
    const btn = cmd.querySelector<HTMLElement>('.cmd-copy');
    if (!text || !btn) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        btn.classList.add('copied');
        window.setTimeout(() => btn.classList.remove('copied'), 1600);
      })
      .catch(() => {
        /* clipboard permission denied */
      });
  };
  const howto = el('howto');
  howto?.addEventListener('click', (e) => {
    const cmd = (e.target as Element).closest('.cmd');
    if ((e.target as Element).closest('.cmd-copy') && cmd) copyCommand(cmd);
  });
  howto?.addEventListener('dblclick', (e) => {
    const cmd = (e.target as Element).closest('.cmd');
    if (cmd) copyCommand(cmd);
  });
  // clear-compare is rendered dynamically inside #meta, so delegate from parent
  el('meta')?.addEventListener('click', (e) => {
    if ((e.target as Element).closest('#clear-compare')) clearCompare();
  });
  el('export')?.addEventListener('click', () => {
    if (!_rawData) return;
    const filter = _activePreset !== 'all' ? presetToFilter(_activePreset) : null;
    exportMeterPNG(applyFilter(_rawData, filter));
  });

  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) loadFromFile(file);
    input.value = ''; // allow re-picking the same file
  });

  // Full-window drag-and-drop. A depth counter keeps the overlay stable as the
  // drag moves across child elements.
  let depth = 0;
  const setDragging = (on: boolean) => {
    depth = on ? depth + 1 : Math.max(0, depth - 1);
    document.body.classList.toggle('dragging', depth > 0);
    dropzone?.setAttribute('aria-hidden', String(depth === 0));
  };

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    setDragging(true);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    setDragging(false);
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    dropzone?.setAttribute('aria-hidden', 'true');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFromFile(file);
  });
}

wireControls();
void loadPublished();
