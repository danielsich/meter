import './styles.css';
import type { ClockworkExport, ClockworkProject } from './clockwork';

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

function clear(...ids: string[]): void {
  for (const id of ids) {
    const node = el(id);
    if (node) node.innerHTML = '';
  }
}

function renderError(headline: string, detail: string): void {
  clear('meta', 'readout');
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

function renderMeter(data: ClockworkExport): void {
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

  const scale = ticks
    .map(
      (t) =>
        `<span class="tick" style="left:${((t / axisMax) * 100).toFixed(
          2,
        )}%">${formatTick(t)}</span>`,
    )
    .join('');

  const grid = ticks
    .map(
      (t) =>
        `<span class="grid" style="left:${((t / axisMax) * 100).toFixed(
          2,
        )}%"></span>`,
    )
    .join('');

  const rows = projects
    .map((p, i) => {
      const rank = String(i + 1).padStart(2, '0');
      return `
      <li class="row" style="--w:${pctOf(p.totals.minutes)}%;--i:${i}">
        <span class="bar" aria-hidden="true"></span>
        <span class="rank">${rank}</span>
        <span class="pname" title="${escapeHtml(p.name)}">${escapeHtml(
          p.name,
        )}</span>
        <span class="reading">${formatMinutes(p.totals.minutes)}</span>
        <span class="pcount">${formatNumber(
          p.totals.prompts,
        )}<span class="unit">prompts</span></span>
      </li>`;
    })
    .join('');

  meter.innerHTML = `
    <div class="scale" aria-hidden="true">${scale}</div>
    <div class="chart">
      <div class="graticule" aria-hidden="true">${grid}</div>
      <ol class="rows">${rows}</ol>
    </div>`;
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
  renderMeta(data, source);
  renderReadout(data);
  renderMeter(data);
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

function wireControls(): void {
  const loadBtn = el('load');
  const resetBtn = el('reset');
  const input = el('file-input') as HTMLInputElement | null;
  const dropzone = el('dropzone');

  loadBtn?.addEventListener('click', () => input?.click());
  resetBtn?.addEventListener('click', () => void loadPublished());

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
