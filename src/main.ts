import './styles.css';
import {
  renderActivity,
  renderTokenUsage,
  type ChartMetric,
  type DaySort,
} from './charts';
import type { ClockworkExport, ClockworkProject } from './clockwork';
import {
  formatGeneratedAt,
  formatMinutes,
  formatNumber,
} from './display';
export { formatMinutes } from './display';
import { exportMeterPNG } from './export-png';
import { initProjectDeepLink, renderProjects } from './projects';
import {
  filterByMinSession,
  filterByProvider,
  filterExport,
  hasDateData,
  hasSessionData,
  hasTokenData,
  presetToFilter,
  providersOf,
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
import { shouldCompareUpload } from './upload';

const el = (id: string) => document.getElementById(id);

/** Where the currently displayed data came from. */
type Source = { kind: 'published' } | { kind: 'upload'; filename: string };

let _rawData: ClockworkExport | null = null;
let _compareData: ClockworkExport | null = null;
let _currentSource: Source | null = null;
let _activePreset: RangePreset | 'all' = 'all';
let _providerFilter: string = 'all';
let _minSession: number = 0;
let _yMetric: ChartMetric = 'minutes';
let _daySort: DaySort = 'date';

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
    ? `<span class="range-hint">use <code>--detail daily</code> to filter</span>`
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
    ? `<span class="range-hint">use <code>--detail sessions</code> to filter</span>`
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
      _yMetric = (btn.dataset.metric ?? 'minutes') as ChartMetric;
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
  if (
    _yMetric === 'tokens' &&
    (!hasTokenData(view) || (compareView !== null && !hasTokenData(compareView)))
  ) {
    _yMetric = 'minutes';
  }
  renderReadout(view, compareView);
  renderTokenUsage(el('token-usage'), view, compareView);
  renderActivity(el('activity'), applyAllFilters(activitySource), _yMetric);
  renderProjects(el('meter'), view, compareView, mergeByPath, _yMetric, _daySort);
  initProjectDeepLink();
  wireMetricToggle();
}

function clear(...ids: string[]): void {
  for (const id of ids) {
    const node = el(id);
    if (node) node.innerHTML = '';
  }
}

function renderError(headline: string, detail: string): void {
  clear('meta', 'readout', 'token-usage', 'activity', 'sample-note');
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
      ? `<div class="banner">You're viewing <strong>sample data</strong>. Select <strong>Load .json</strong> to view your own clockwork export. The file stays in your browser and is never uploaded.</div>`
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
      `${err instanceof Error ? err.message : String(err)} Re-export it or load a .json above.`,
    );
  }
}

/** Read and render a file the visitor picked or dropped, entirely in-browser. */
function loadFromFile(file: File): void {
  if (file.size > MAX_FILE_BYTES) {
    setResetVisible(true);
    renderError(
      `"${file.name}" is too large to open.`,
      `meter caps loaded files at ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB. Clockwork exports are usually much smaller, so check that you picked the right file.`,
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
        `${err instanceof Error ? err.message : String(err)} Export it with clockwork and try again.`,
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

    // Auto-detect comparison only between two user-uploaded single-provider files.
    // The first upload must replace the built-in published sample.
    const isComparison = shouldCompareUpload(
      _rawData,
      _currentSource?.kind ?? null,
      data,
    );

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
