import './styles.css';
import type { ClockworkExport, ClockworkProject, DailyEntry, SessionEntry } from './clockwork';
import {
  activeDates,
  allPrompts,
  allSessions,
  computeStreaks,
  contributionGrid,
  filterExport,
  hasDateData,
  hourHistogram,
  hourLevel,
  presetToFilter,
  projectRange,
  sortedDaily,
  type DateFilter,
  type RangePreset,
} from './stats';

const EXPECTED_SCHEMA = 'clockwork/v1';

/** Format a duration in minutes as "Xh Ym" (e.g. 1234.76 → "20h 34m"). */
export function formatMinutes(m: number): string {
  const total = Math.max(0, Math.floor(m));
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
  return n.toLocaleString('en-US');
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
let _activePreset: RangePreset | 'all' = 'all';

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

function rerender(data: ClockworkExport): void {
  const filter = _activePreset !== 'all' ? presetToFilter(_activePreset) : null;
  const view = applyFilter(data, filter);
  renderRangeBar(data);
  renderReadout(view);
  renderActivity(view);
  renderProjects(view);
  initDeepLink();
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

function renderMeta(data: ClockworkExport, source: Source): void {
  const meta = el('meta');
  if (!meta) return;
  const src =
    source.kind === 'upload'
      ? `<span class="src" title="${escapeHtml(source.filename)}">your file</span>`
      : '';
  meta.innerHTML = `
    <span class="chip">${escapeHtml(data.provider)}</span>
    <span class="gen">updated ${escapeHtml(formatGeneratedAt(data.generated_at))}</span>
    ${src}`;
}

function renderReadout(data: ClockworkExport): void {
  const readout = el('readout');
  if (!readout) return;
  const { totals } = data;
  readout.innerHTML = `
    <div class="total">
      <span class="total-value">${formatMinutes(totals.minutes)}</span>
      <span class="total-label">total time logged</span>
    </div>
    <dl class="secondary">
      <div class="metric">
        <dt>prompts</dt><dd>${formatNumber(totals.prompts)}</dd>
      </div>
      <div class="metric">
        <dt>sessions</dt><dd>${formatNumber(totals.sessions)}</dd>
      </div>
      <div class="metric">
        <dt>projects</dt><dd>${formatNumber(totals.projects)}</dd>
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
          return `<span class="cell lvl-${cell.level}" title="${formatDayLabel(
            cell.dateStr,
          )} — ${time}"></span>`;
        })
        .join(''),
    )
    .join('');
  return `<div class="contrib">${cells}</div>`;
}

/** Scatter plot: session start time-of-day (X) vs duration (Y). */
function sessionRhythmHTML(sessions: SessionEntry[]): string {
  if (!sessions.length) return '';

  const VW = 780, VH = 160;
  const ML = 46, MR = 12, MT = 10, MB = 28;
  const cW = VW - ML - MR;
  const cH = VH - MT - MB;

  const maxMin = Math.max(...sessions.map((s) => s.minutes), 60);
  const { axisMax, ticks } = buildScale(maxMin);

  const xOf = (sec: number) => {
    const d = new Date(sec * 1000);
    return ML + ((d.getHours() + d.getMinutes() / 60) / 24) * cW;
  };
  const yOf = (min: number) =>
    MT + cH - Math.min(1, min / axisMax) * cH;

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
      return (
        `<line x1="${ML - 4}" y1="${y}" x2="${ML}" y2="${y}" stroke="#2b3743" stroke-width="1"/>` +
        `<text x="${ML - 7}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" fill="#8a97a2" font-size="9" font-family="'JetBrains Mono',monospace">${formatTick(t)}</text>`
      );
    })
    .join('');

  const dots = sessions
    .map((s) => {
      const cx = xOf(s.start).toFixed(1);
      const cy = yOf(s.minutes).toFixed(1);
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#d8a24a" opacity="0.52"/>`;
    })
    .join('');

  return `
    <div class="scatter-wrap card">
      <h3>Session rhythm</h3>
      <svg class="scatter" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Scatter plot of session start time versus duration">
        <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + cH}" stroke="#2b3743" stroke-width="1"/>
        <line x1="${ML}" y1="${MT + cH}" x2="${ML + cW}" y2="${MT + cH}" stroke="#2b3743" stroke-width="1"/>
        ${gridLines}${xAxis}${yAxis}${dots}
      </svg>
    </div>`;
}

/** Per-day horizontal bar chart for one project's daily breakdown. */
function dayBarsHTML(daily: DailyEntry[]): string {
  const days = sortedDaily(daily);
  const max = Math.max(...days.map((d) => d.minutes), 1);
  const rows = days
    .map((d) => {
      const w = ((d.minutes / max) * 100).toFixed(1);
      return `
      <div class="daybar">
        <span class="db-date">${shortDate(d.date)}</span>
        <span class="db-track"><span class="db-fill" style="width:${w}%"></span></span>
        <span class="db-min">${formatMinutes(d.minutes)}</span>
        <span class="db-p">${formatNumber(d.prompts)}<span class="unit">p</span></span>
      </div>`;
    })
    .join('');
  return `<div class="daybars">${rows}</div>`;
}

const LINK_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12"/></svg>`;

/** Body of a project's expanded drill-down panel. */
function drillContent(p: ClockworkProject): string {
  const range = projectRange(p);
  const stat = (label: string, value: string) =>
    `<div class="ds"><span class="ds-v">${value}</span><span class="ds-l">${label}</span></div>`;

  const ppm =
    p.totals.minutes > 0
      ? (p.totals.prompts / p.totals.minutes).toFixed(1)
      : '—';

  const stats = `
    <div class="drill-stats">
      ${stat('active days', formatNumber(p.totals.active_days))}
      ${stat('sessions', formatNumber(p.totals.sessions))}
      ${stat('prompts / min', ppm)}
      ${range.first !== undefined ? stat('first', formatDate(range.first)) : ''}
      ${range.last !== undefined ? stat('last', formatDate(range.last)) : ''}
    </div>`;

  const copyBtn = `<button class="copy-link" data-copy-link="${escapeHtml(p.id)}" type="button" title="Copy link to this project">${LINK_ICON}<span class="copy-label">Copy link</span></button>`;

  const days =
    p.daily && p.daily.length
      ? dayBarsHTML(p.daily)
      : `<p class="hint">No per-day breakdown in this export — use <code>--detail daily</code> or richer.</p>`;

  const heat =
    p.prompts && p.prompts.length
      ? `<div class="heat-wrap"><h4>Hour of day</h4>${heatmapHTML(p.prompts)}</div>`
      : `<p class="hint">Hourly activity needs a <code>--detail raw</code> export.</p>`;

  return `
    <div class="drill-header">${copyBtn}</div>
    ${stats}
    <div class="drill-charts">
      <div class="drill-days"><h4>Per day</h4>${days}</div>
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

/** SVG chevron used on each expandable project row. */
const CHEVRON = `<svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderProjects(data: ClockworkExport): void {
  const meter = el('meter');
  if (!meter) return;

  if (data.projects.length === 0) {
    meter.innerHTML = `
      <div class="notice">
        <span class="notice-mark">idle</span>
        <p class="notice-head">No projects on the meter yet.</p>
        <p class="notice-detail">Run <code>clockwork both export --anonymize &gt; data/clockwork-data.json</code>, then rebuild.</p>
      </div>`;
    return;
  }

  const projects: ClockworkProject[] = [...data.projects].sort(
    (a, b) => b.totals.minutes - a.totals.minutes,
  );
  const maxMinutes = projects[0].totals.minutes;
  const { axisMax, ticks } = buildScale(maxMinutes);

  const pctOf = (minutes: number) =>
    Math.min(100, (minutes / axisMax) * 100).toFixed(2);
  const leftPct = (t: number) => ((t / axisMax) * 100).toFixed(2);

  const scale = ticks
    .map(
      (t) =>
        `<span class="tick" style="left:${leftPct(t)}%">${formatTick(t)}</span>`,
    )
    .join('');

  const grid = ticks
    .map((t) => `<span class="grid" style="left:${leftPct(t)}%"></span>`)
    .join('');

  const rows = projects
    .map((p, i) => {
      const rank = String(i + 1).padStart(2, '0');
      return `
      <li class="row-item" data-project-id="${escapeHtml(p.id)}" style="--w:${pctOf(p.totals.minutes)}%;--i:${i}">
        <button class="row" type="button" aria-expanded="false" aria-controls="drill-${i}">
          <span class="bar" aria-hidden="true"></span>
          <span class="rank">${rank}</span>
          <span class="pname" title="${escapeHtml(p.name)}">${escapeHtml(
            p.name,
          )}</span>
          <span class="reading">${formatMinutes(p.totals.minutes)}</span>
          <span class="pcount">${formatNumber(
            p.totals.prompts,
          )}<span class="unit">prompts</span></span>
          ${CHEVRON}
        </button>
        <div class="drill" id="drill-${i}" role="region" aria-hidden="true">
          <div class="drill-inner">${drillContent(p)}</div>
        </div>
      </li>`;
    })
    .join('');

  meter.innerHTML = `
    <div class="scale" aria-hidden="true">${scale}</div>
    <div class="chart">
      <div class="graticule" aria-hidden="true">${grid}</div>
      <ol class="rows">${rows}</ol>
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
      const url = new URL(location.href);
      if (open && item?.dataset.projectId) {
        url.searchParams.set('project', item.dataset.projectId);
      } else {
        url.searchParams.delete('project');
      }
      history.replaceState(null, '', url);
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
    url.searchParams.set('project', id);
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
      ? `<div class="banner">You're viewing <strong>sample data</strong>. Load your own export with <strong>Load .json</strong>, or follow <strong>How to use meter</strong> below to publish yours.</div>`
      : '';
  }
  if (sample) {
    const howto = el('howto') as HTMLDetailsElement | null;
    if (howto) howto.open = true;
  }
}

/** Validate a parsed export and render it, or show a clear error. */
function show(data: ClockworkExport, source: Source): void {
  if (data.schema !== EXPECTED_SCHEMA) {
    renderError(
      `This file reports schema "${data.schema ?? '(missing)'}".`,
      `meter reads ${EXPECTED_SCHEMA}. Re-export with a current clockwork build.`,
    );
    return;
  }
  _rawData = data;
  _activePreset = 'all';
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
  const reader = new FileReader();
  reader.onload = () => {
    // Once someone loads their own file, offer a way back to published data.
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
    show(data, { kind: 'upload', filename: file.name });
  };
  reader.onerror = () => {
    setResetVisible(true);
    renderError(`Couldn't read "${file.name}".`, 'Try loading the file again.');
  };
  reader.readAsText(file);
}

/** Open the project matching ?project= in the URL after rendering. */
function initDeepLink(): void {
  const id = new URLSearchParams(location.search).get('project');
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
