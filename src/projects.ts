import {
  dayBarsHTML,
  dayBarsToggleHTML,
  heatmapHTML,
  type ChartMetric,
  type DaySort,
} from './charts';
import type { ClockworkExport, ClockworkProject } from './clockwork';
import {
  buildScale,
  formatDate,
  formatMinutes,
  formatNumber,
  formatTick,
  formatTokens,
} from './display';
import { projectRange, sumTokenUsage } from './stats';
import { escapeHtml } from './validate';

/**
 * Project deep-links live in the URL fragment (`#project=…`), never the query
 * string. A fragment is not transmitted to the server, so reloading or sharing a
 * link to an uploaded project never discloses its id to the host's request logs.
 */
function setProjectDeepLink(id: string | null): void {
  const base = location.pathname + location.search;
  const target = id ? `${base}#project=${encodeURIComponent(id)}` : base;
  history.replaceState(null, '', target);
}

function readProjectDeepLink(): string | null {
  return new URLSearchParams(location.hash.replace(/^#/, '')).get('project');
}

const LINK_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12"/></svg>`;

/** Body of a project's expanded drill-down panel. */
function drillContent(
  project: ClockworkProject,
  metric: ChartMetric,
  daySort: DaySort,
  projectCompare?: ClockworkProject | null,
  providerA?: string,
  providerB?: string,
  showTokens = true,
): string {
  const range = projectRange(project);
  const stat = (label: string, value: string) =>
    `<div class="ds"><span class="ds-v">${value}</span><span class="ds-l">${label}</span></div>`;

  const promptsPerMinute =
    project.totals.minutes > 0
      ? (project.totals.prompts / project.totals.minutes).toFixed(1)
      : 'not available';
  const tokenUsage = showTokens
    ? sumTokenUsage([project.tokens, projectCompare?.tokens])
    : undefined;
  const cacheBase = tokenUsage ? tokenUsage.input + tokenUsage.cache_read : 0;
  const tokenStats = tokenUsage
    ? `${stat('tokens', formatTokens(tokenUsage.total))}
      ${stat(
        'tokens / response',
        tokenUsage.responses > 0 ? formatTokens(tokenUsage.total / tokenUsage.responses) : 'not available',
      )}
      ${stat(
        'cache reuse',
        cacheBase > 0 ? `${((tokenUsage.cache_read / cacheBase) * 100).toFixed(1)}%` : 'not available',
      )}`
    : '';

  const splitStat = projectCompare
    ? `<div class="ds ds-split">
        <span class="ds-v">
          <span class="cmp-a">${formatMinutes(project.totals.minutes)}</span>
          <span class="cmp-sep"> · </span>
          <span class="cmp-b">${formatMinutes(projectCompare.totals.minutes)}</span>
        </span>
        <span class="ds-l">${escapeHtml(providerA ?? 'primary')} · ${escapeHtml(providerB ?? 'compare')}</span>
      </div>`
    : '';

  const stats = `
    <div class="drill-stats">
      ${splitStat}
      ${stat('active days', formatNumber(project.totals.active_days))}
      ${stat('sessions', formatNumber(project.totals.sessions))}
      ${stat('prompts / min', promptsPerMinute)}
      ${tokenStats}
      ${range.first !== undefined ? stat('first', formatDate(range.first)) : ''}
      ${range.last !== undefined ? stat('last', formatDate(range.last)) : ''}
    </div>`;

  const copyButton = `<button class="copy-link" data-copy-link="${escapeHtml(project.id)}" type="button" title="Copy link to this project">${LINK_ICON}<span class="copy-label">Copy link</span></button>`;

  const hasDailyData = !!(project.daily && project.daily.length);
  const hasDailyTokens = !!project.daily?.some((day) => day.tokens);
  const dailyMetric = metric === 'tokens' && !hasDailyTokens ? 'minutes' : metric;
  const days = hasDailyData
    ? dayBarsHTML(project.daily!, dailyMetric, daySort)
    : `<p class="hint">This export has no daily breakdown. Use <code>--detail daily</code> or richer.</p>`;

  const heat =
    project.prompts && project.prompts.length
      ? `<div class="heat-wrap"><h4>Hour of day</h4>${heatmapHTML(project.prompts)}</div>`
      : `<p class="hint">Export with <code>--detail raw</code> to see hourly activity.</p>`;

  const dayToggle = hasDailyData
    ? dayBarsToggleHTML(dailyMetric, daySort, hasDailyTokens)
    : '';

  return `
    <div class="drill-header">${copyButton}</div>
    ${stats}
    <div class="drill-charts">
      <div class="drill-days">
        <div class="chart-header"><h4>Per day</h4>${dayToggle}</div>
        ${days}
      </div>
      ${heat}
    </div>`;
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

/** Merge two exports into per-project rows carrying both sides. */
function buildSplitRows(
  primary: ClockworkExport,
  compare: ClockworkExport,
  keyOf: (project: ClockworkProject) => string = (project) => project.id,
): SplitRow[] {
  const map = new Map<string, SplitRow>();
  for (const project of primary.projects) {
    map.set(keyOf(project), {
      id: project.id,
      name: project.name,
      minutesA: project.totals.minutes,
      minutesB: 0,
      promptsA: project.totals.prompts,
      promptsB: 0,
      projectA: project,
      projectB: null,
    });
  }
  for (const project of compare.projects) {
    const existing = map.get(keyOf(project));
    if (existing) {
      existing.minutesB = project.totals.minutes;
      existing.promptsB = project.totals.prompts;
      existing.projectB = project;
    } else {
      map.set(keyOf(project), {
        id: project.id,
        name: project.name,
        minutesA: 0,
        minutesB: project.totals.minutes,
        promptsA: 0,
        promptsB: project.totals.prompts,
        projectA: null,
        projectB: project,
      });
    }
  }
  return [...map.values()]
    .filter((row) => row.minutesA + row.minutesB > 0)
    .sort((a, b) => (b.minutesA + b.minutesB) - (a.minutesA + a.minutesB));
}

const CHEVRON = `<svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderProjects(
  meter: HTMLElement | null,
  data: ClockworkExport,
  compare: ClockworkExport | null,
  mergeByPath: boolean,
  metric: ChartMetric,
  daySort: DaySort,
): void {
  if (!meter) return;

  const isSplit = !!compare;
  const keyOf = mergeByPath
    ? (project: ClockworkProject) => project.path ?? project.name
    : (project: ClockworkProject) => project.id;

  type Row = {
    id: string;
    name: string;
    totalMinutes: number;
    totalPrompts: number;
    totalTokens?: number;
    minutesA: number;
    minutesB: number;
    project: ClockworkProject;
    projectB: ClockworkProject | null;
  };

  let rows: Row[];
  if (isSplit) {
    const merged = buildSplitRows(data, compare, keyOf);
    if (!merged.length) {
      meter.innerHTML = `<div class="notice"><span class="notice-mark">idle</span><p class="notice-head">No overlapping projects found.</p></div>`;
      return;
    }
    rows = merged.map((row) => ({
      id: row.id,
      name: row.name,
      totalMinutes: row.minutesA + row.minutesB,
      totalPrompts: row.promptsA + row.promptsB,
      totalTokens:
        row.projectA?.tokens || row.projectB?.tokens
          ? (row.projectA?.tokens?.total ?? 0) + (row.projectB?.tokens?.total ?? 0)
          : undefined,
      minutesA: row.minutesA,
      minutesB: row.minutesB,
      project: (row.projectA ?? row.projectB)!,
      projectB: row.projectB,
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
    rows = sorted.map((project) => ({
      id: project.id,
      name: project.name,
      totalMinutes: project.totals.minutes,
      totalPrompts: project.totals.prompts,
      totalTokens: project.tokens?.total,
      minutesA: project.totals.minutes,
      minutesB: 0,
      project,
      projectB: null,
    }));
  }

  const { axisMax, ticks } = buildScale(rows[0].totalMinutes);
  const pctOf = (minutes: number) => Math.min(100, (minutes / axisMax) * 100).toFixed(2);
  const leftPct = (tick: number) => ((tick / axisMax) * 100).toFixed(2);

  const scale = ticks
    .map((tick) => `<span class="tick" style="left:${leftPct(tick)}%">${formatTick(tick)}</span>`)
    .join('');
  const grid = ticks
    .map((tick) => `<span class="grid" style="left:${leftPct(tick)}%"></span>`)
    .join('');

  const providerA = data.provider;
  const providerB = compare?.provider ?? '';
  const showTokens = isSplit
    ? data.totals.tokens !== undefined && compare?.totals.tokens !== undefined
    : rows.some((row) => row.totalTokens !== undefined);

  const rowsHTML = rows
    .map((row, index) => {
      const rank = String(index + 1).padStart(2, '0');
      const totalPct = pctOf(row.totalMinutes);

      const barHTML = isSplit
        ? (() => {
            const pctA = row.totalMinutes > 0
              ? ((row.minutesA / row.totalMinutes) * 100).toFixed(2)
              : '0';
            return `<span class="bar bar-split" aria-hidden="true"><span class="bar-a" style="width:${pctA}%"></span><span class="bar-b" style="width:calc(100% - ${pctA}%)"></span></span>`;
          })()
        : `<span class="bar" aria-hidden="true"></span>`;

      const nameHTML = isSplit
        ? `<span class="pname pname--split">
            <span class="pname-text" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
            <span class="split-sub">
              <span class="sub-a">${formatMinutes(row.minutesA)}</span>
              <span class="sub-sep">·</span>
              <span class="sub-b">${formatMinutes(row.minutesB)}</span>
            </span>
          </span>`
        : `<span class="pname" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>`;

      const drillHTML = drillContent(
        row.project,
        metric,
        daySort,
        isSplit ? row.projectB : null,
        providerA,
        providerB,
        showTokens,
      );

      return `
      <li class="row-item" data-project-id="${escapeHtml(row.id)}" style="--w:${totalPct}%;--i:${index}">
        <button class="row" type="button" aria-expanded="false" aria-controls="drill-${index}">
          ${barHTML}
          <span class="rank">${rank}</span>
          ${nameHTML}
          <span class="reading">${formatMinutes(row.totalMinutes)}</span>
          <span class="pcount">${formatNumber(row.totalPrompts)}<span class="unit">prompts</span></span>
          ${showTokens ? `<span class="tcount">${formatTokens(row.totalTokens ?? 0)}<span class="unit">tokens</span></span>` : ''}
          ${CHEVRON}
        </button>
        <div class="drill" id="drill-${index}" role="region" aria-hidden="true">
          <div class="drill-inner">${drillHTML}</div>
        </div>
      </li>`;
    })
    .join('');

  meter.innerHTML = `
    <div class="scale" aria-hidden="true">${scale}</div>
    <div class="chart">
      <div class="graticule" aria-hidden="true">${grid}</div>
      <ol class="rows${isSplit ? ' rows--split' : ''}${showTokens ? ' rows--tokens' : ''}">${rowsHTML}</ol>
    </div>`;

  wireDrilldowns(meter);
}

/** Expand/collapse project rows — one open at a time, keyboard-accessible. */
function wireDrilldowns(container: HTMLElement): void {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.row'),
  );

  const setOpen = (button: HTMLButtonElement, open: boolean, updateUrl = true) => {
    const item = button.closest<HTMLElement>('.row-item');
    const panel = document.getElementById(
      button.getAttribute('aria-controls') ?? '',
    );
    item?.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    panel?.setAttribute('aria-hidden', String(!open));

    if (updateUrl) {
      setProjectDeepLink(open && item?.dataset.projectId ? item.dataset.projectId : null);
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      for (const other of buttons) if (other !== button) setOpen(other, false);
      setOpen(button, willOpen);
    });
  }

  container.addEventListener('click', (event) => {
    const copyButton = (event.target as Element).closest<HTMLButtonElement>('[data-copy-link]');
    if (!copyButton) return;
    const id = copyButton.dataset.copyLink ?? '';
    const url = new URL(location.href);
    url.hash = `project=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(url.href).then(() => {
      copyButton.classList.add('copied');
      setTimeout(() => copyButton.classList.remove('copied'), 1600);
    }).catch(() => {/* clipboard permission denied */});
  });
}

/** Open the project matching #project= in the URL fragment after rendering. */
export function initProjectDeepLink(): void {
  const id = readProjectDeepLink();
  if (!id) return;
  const item = document.querySelector<HTMLElement>(
    `.row-item[data-project-id="${CSS.escape(id)}"]`,
  );
  if (!item) return;
  const button = item.querySelector<HTMLButtonElement>('.row');
  if (button && button.getAttribute('aria-expanded') !== 'true') {
    button.click();
    requestAnimationFrame(() =>
      item.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }
}
