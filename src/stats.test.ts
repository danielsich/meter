import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  filterByMinSession,
  filterByProvider,
  filterExport,
  hasTokenData,
  providersOf,
  sumTokenUsage,
} from './stats.ts';
import type { ClockworkExport, ClockworkProject, TokenUsage } from './clockwork.ts';

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

function usage(
  model: string,
  responses: number,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite = 0,
  reasoning = 0,
): TokenUsage {
  const total = input + output + cacheRead + cacheWrite;
  return {
    responses,
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    reasoning,
    total,
    by_model: [{
      model,
      responses,
      input,
      output,
      cache_read: cacheRead,
      cache_write: cacheWrite,
      reasoning,
      total,
    }],
  };
}

function tokenProject(
  id: string,
  provider: string,
  path: string,
  days: Array<{ date: string; minutes: number; prompts: number; tokens: TokenUsage }>,
): ClockworkProject {
  const sessions = days.map((day) => {
    const start = Date.parse(`${day.date}T10:00:00Z`) / 1000;
    return {
      start,
      end: start + day.minutes * 60,
      minutes: day.minutes,
      prompts: day.prompts,
    };
  });
  return {
    id,
    provider,
    name: path.split('/').pop()!,
    path,
    totals: {
      minutes: days.reduce((sum, day) => sum + day.minutes, 0),
      prompts: days.reduce((sum, day) => sum + day.prompts, 0),
      sessions: sessions.length,
      active_days: days.length,
    },
    tokens: sumTokenUsage(days.map((day) => day.tokens))!,
    daily: days,
    sessions,
  };
}

const tokenProjects = [
  tokenProject('tc1', 'claude', '/dev/a', [
    { date: '2026-07-01', minutes: 10, prompts: 2, tokens: usage('claude-sonnet-4-6', 2, 10, 20, 100, 5) },
    { date: '2026-07-02', minutes: 20, prompts: 3, tokens: usage('claude-sonnet-4-6', 3, 20, 30, 200, 10) },
  ]),
  tokenProject('tc2', 'claude', '/dev/b', [
    { date: '2026-07-02', minutes: 30, prompts: 4, tokens: usage('claude-opus-4-8', 4, 5, 5, 50, 5) },
  ]),
  tokenProject('tx1', 'codex', '/dev/a', [
    { date: '2026-07-01', minutes: 12, prompts: 2, tokens: usage('gpt-5.3-codex', 2, 30, 40, 300, 0, 15) },
    { date: '2026-07-02', minutes: 25, prompts: 3, tokens: usage('gpt-5.3-codex', 3, 40, 50, 400, 0, 20) },
  ]),
];

const claudeTokenTotals = sumTokenUsage(
  tokenProjects.filter((p) => p.provider === 'claude').map((p) => p.tokens),
)!;
const codexTokenTotals = sumTokenUsage(
  tokenProjects.filter((p) => p.provider === 'codex').map((p) => p.tokens),
)!;

const tokenCombined: ClockworkExport = {
  schema: 'clockwork/v3',
  generated_at: '2026-07-03T00:00:00Z',
  provider: 'both',
  providers: ['claude', 'codex'],
  tokens: true,
  projects: tokenProjects,
  totals: {
    projects: 3,
    minutes: 97,
    prompts: 14,
    sessions: 5,
    tokens: sumTokenUsage(tokenProjects.map((p) => p.tokens)),
    by_provider: {
      claude: { projects: 2, minutes: 60, prompts: 9, sessions: 3, tokens: claudeTokenTotals },
      codex: { projects: 1, minutes: 37, prompts: 5, sessions: 2, tokens: codexTokenTotals },
    },
  },
};

function assertTokenReconciliation(data: ClockworkExport): void {
  const expectedGrand = sumTokenUsage(data.projects.map((p) => p.tokens));
  assert.deepEqual(data.totals.tokens, expectedGrand);
  assert.equal(
    data.totals.tokens?.total,
    (data.totals.tokens?.input ?? 0) +
      (data.totals.tokens?.output ?? 0) +
      (data.totals.tokens?.cache_read ?? 0) +
      (data.totals.tokens?.cache_write ?? 0),
    'reasoning and by_model totals must not be added to total',
  );
  for (const project of data.projects) {
    if (project.daily?.length) {
      assert.deepEqual(project.tokens, sumTokenUsage(project.daily.map((d) => d.tokens)));
    }
  }
  for (const [provider, totals] of Object.entries(data.totals.by_provider ?? {})) {
    assert.deepEqual(
      totals.tokens,
      sumTokenUsage(
        data.projects.filter((project) => project.provider === provider).map((p) => p.tokens),
      ),
    );
  }
  assert.deepEqual(
    data.totals.tokens,
    sumTokenUsage(Object.values(data.totals.by_provider ?? {}).map((t) => t.tokens)),
  );
}

test('hasTokenData distinguishes absent token data from zero usage', () => {
  assert.equal(hasTokenData(tokenCombined), true);
  assert.equal(hasTokenData({ ...tokenCombined, tokens: false, totals: { ...tokenCombined.totals, tokens: undefined } }), false);
  assert.equal(hasTokenData({ ...tokenCombined, tokens: true, totals: { ...tokenCombined.totals, tokens: undefined } }), false);
});

test('sumTokenUsage keeps reasoning as an output subset and merges models', () => {
  const total = sumTokenUsage([
    usage('gpt-5.3-codex', 1, 10, 20, 100, 0, 12),
    usage('gpt-5.3-codex', 2, 20, 30, 200, 0, 18),
  ])!;
  assert.equal(total.total, 380);
  assert.equal(total.reasoning, 30);
  assert.equal(total.by_model?.length, 1);
  assert.equal(total.by_model?.[0].total, 380);
});

test('provider filtering rebuilds token and per-model totals from surviving projects', () => {
  const claude = filterByProvider(tokenCombined, 'claude');
  assert.equal(claude.totals.tokens?.total, claudeTokenTotals.total);
  assert.equal(claude.totals.by_provider?.codex, undefined);
  assertTokenReconciliation(claude);

  const codex = filterByProvider(tokenCombined, 'codex');
  assert.equal(codex.totals.tokens?.reasoning, 35);
  assert.equal(codex.totals.tokens?.cache_write, 0);
  assertTokenReconciliation(codex);
});

test('date filtering re-sums token blocks from the surviving daily entries', () => {
  const julySecond = filterExport(tokenCombined, {
    startDate: '2026-07-02',
    endDate: '2026-07-02',
  });
  assert.equal(julySecond.projects.length, 3);
  assert.equal(julySecond.totals.tokens?.responses, 10);
  assert.equal(julySecond.totals.tokens?.total, 815);
  assertTokenReconciliation(julySecond);
});

test('date filtering supports real v3 daily blocks that omit by_model', () => {
  const realLike: ClockworkExport = {
    ...tokenCombined,
    projects: tokenCombined.projects.map((project) => ({
      ...project,
      daily: project.daily?.map((day) => {
        if (!day.tokens) return day;
        const { by_model: _models, ...tokens } = day.tokens;
        return { ...day, tokens };
      }),
    })),
  };
  const julySecond = filterExport(realLike, {
    startDate: '2026-07-02',
    endDate: '2026-07-02',
  });
  assert.equal(julySecond.totals.tokens?.total, 815);
  assert.equal(julySecond.totals.tokens?.by_model, undefined);
  assertTokenReconciliation(julySecond);
});

test('minimum-session filtering drops all unattributable token blocks', () => {
  const filtered = filterByMinSession(tokenCombined, 15);
  assert.equal(filtered.tokens, true, 'retain the export flag so the UI can explain suppression');
  assert.equal(hasTokenData(filtered), false);
  assert.equal(filtered.totals.tokens, undefined);
  assert.ok(Object.values(filtered.totals.by_provider ?? {}).every((t) => t.tokens === undefined));
  assert.ok(filtered.projects.every((p) => p.tokens === undefined));
  assert.ok(filtered.projects.every((p) => p.daily?.every((d) => d.tokens === undefined)));
});
