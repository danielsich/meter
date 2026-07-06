import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterByProvider, providersOf } from './stats.ts';
import type { ClockworkExport } from './clockwork.ts';

const project = (
  id: string,
  provider: string,
  path: string,
  minutes: number,
  prompts: number,
) => ({
  id,
  provider,
  name: path.split('/').pop()!,
  path,
  totals: { minutes, prompts, sessions: 1, active_days: 1 },
});

const combined: ClockworkExport = {
  schema: 'clockwork/v2',
  generated_at: '2026-07-06T00:00:00Z',
  provider: 'both',
  providers: ['claude', 'codex'],
  projects: [
    project('c1', 'claude', '/dev/a', 100, 10),
    project('c2', 'claude', '/dev/b', 50, 5),
    project('x1', 'codex', '/dev/a', 40, 4),
  ],
  totals: { projects: 3, minutes: 190, prompts: 19, sessions: 3 },
};

test('providersOf prefers the top-level providers list', () => {
  assert.deepEqual(providersOf(combined), ['claude', 'codex']);
});

test('providersOf falls back to per-project provider tags', () => {
  const { providers: _drop, ...noList } = combined;
  assert.deepEqual(providersOf(noList as ClockworkExport), ['claude', 'codex']);
});

test('providersOf returns [] for an untagged v1 export', () => {
  const v1: ClockworkExport = {
    ...combined,
    schema: 'clockwork/v1',
    providers: undefined,
    projects: combined.projects.map(({ provider: _p, ...rest }) => rest),
  };
  assert.deepEqual(providersOf(v1), []);
});

test('filterByProvider keeps one tool and recomputes grand totals', () => {
  const claude = filterByProvider(combined, 'claude');
  assert.equal(claude.provider, 'claude');
  assert.deepEqual(claude.providers, ['claude']);
  assert.equal(claude.projects.length, 2);
  assert.equal(claude.totals.projects, 2);
  assert.equal(claude.totals.minutes, 150);
  assert.equal(claude.totals.prompts, 15);

  const codex = filterByProvider(combined, 'codex');
  assert.equal(codex.projects.length, 1);
  assert.equal(codex.totals.minutes, 40);
});

test('filterByProvider on an untagged export narrows to empty', () => {
  const untagged: ClockworkExport = {
    ...combined,
    projects: combined.projects.map(({ provider: _p, ...rest }) => rest),
  };
  assert.equal(filterByProvider(untagged, 'claude').projects.length, 0);
});
