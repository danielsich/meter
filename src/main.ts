import './styles.css';
import type { ClockworkExport } from './clockwork';

const EXPECTED_SCHEMA = 'clockwork/v1';

/** Format a duration in minutes as "Xh Ym" (e.g. 1234.76 → "20h 34m"). */
export function formatMinutes(m: number): string {
  const total = Math.max(0, Math.floor(m));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}h ${minutes}m`;
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

function renderError(message: string): void {
  const content = document.getElementById('content');
  const summary = document.getElementById('summary');
  if (summary) summary.innerHTML = '';
  if (content) {
    content.innerHTML = `<div class="error"><strong>Cannot render dashboard.</strong><p>${escapeHtml(
      message,
    )}</p></div>`;
  }
}

function renderHeader(data: ClockworkExport): void {
  const summary = document.getElementById('summary');
  if (!summary) return;
  summary.innerHTML = `
    <div class="stat">
      <span class="stat-label">Provider</span>
      <span class="stat-value">${escapeHtml(data.provider)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Projects</span>
      <span class="stat-value">${formatNumber(data.totals.projects)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Total time</span>
      <span class="stat-value">${formatMinutes(data.totals.minutes)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Prompts</span>
      <span class="stat-value">${formatNumber(data.totals.prompts)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Sessions</span>
      <span class="stat-value">${formatNumber(data.totals.sessions)}</span>
    </div>
    <div class="stat generated">
      <span class="stat-label">Generated</span>
      <span class="stat-value">${escapeHtml(formatGeneratedAt(data.generated_at))}</span>
    </div>
  `;
}

function renderProjects(data: ClockworkExport): void {
  const content = document.getElementById('content');
  if (!content) return;

  if (data.projects.length === 0) {
    content.innerHTML = `<div class="empty">No projects in this export.</div>`;
    return;
  }

  const rows = [...data.projects]
    .sort((a, b) => b.totals.minutes - a.totals.minutes)
    .map(
      (project) => `
        <tr>
          <td class="name">${escapeHtml(project.name)}</td>
          <td class="num">${formatMinutes(project.totals.minutes)}</td>
          <td class="num">${formatNumber(project.totals.prompts)}</td>
          <td class="num">${formatNumber(project.totals.sessions)}</td>
          <td class="num">${formatNumber(project.totals.active_days)}</td>
        </tr>`,
    )
    .join('');

  content.innerHTML = `
    <table class="projects">
      <thead>
        <tr>
          <th>Project</th>
          <th class="num">Time</th>
          <th class="num">Prompts</th>
          <th class="num">Sessions</th>
          <th class="num">Active days</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function main(): Promise<void> {
  let data: ClockworkExport;
  try {
    // Base-path-aware fetch — critical for the /meter/ Pages subpath.
    const res = await fetch(`${import.meta.env.BASE_URL}clockwork-data.json`);
    if (!res.ok) {
      renderError(`Failed to load clockwork-data.json (HTTP ${res.status}).`);
      return;
    }
    data = (await res.json()) as ClockworkExport;
  } catch (err) {
    renderError(
      `Could not fetch or parse clockwork-data.json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  if (data.schema !== EXPECTED_SCHEMA) {
    renderError(
      `Unsupported schema "${data.schema ?? '(missing)'}". This dashboard renders only "${EXPECTED_SCHEMA}".`,
    );
    return;
  }

  renderHeader(data);
  renderProjects(data);
}

void main();
