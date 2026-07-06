import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, structuralError } from './validate.ts';

const validProject = {
  id: 'p1',
  name: 'project-1',
  totals: { minutes: 10, prompts: 2, sessions: 1, active_days: 1 },
};

const validExport = {
  schema: 'clockwork/v1',
  generated_at: '2026-07-06T00:00:00Z',
  provider: 'claude',
  projects: [validProject],
  totals: { projects: 1, minutes: 10, prompts: 2, sessions: 1 },
};

test('escapeHtml neutralizes every HTML-significant character', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('xss')">`),
    '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;',
  );
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml coerces non-strings instead of throwing', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
  // A hostile object cannot break out: its stringification is escaped, not run.
  assert.equal(escapeHtml({ toString: () => '<b>' }), '&lt;b&gt;');
});

test('structuralError accepts a well-formed export', () => {
  assert.equal(structuralError(validExport), null);
});

test('structuralError accepts a summary-only export (no detail arrays)', () => {
  assert.equal(structuralError({ ...validExport, projects: [validProject] }), null);
});

test('structuralError accepts valid daily/sessions/prompts arrays', () => {
  const rich = {
    ...validExport,
    projects: [
      {
        ...validProject,
        daily: [{ date: '2026-07-01', minutes: 5, prompts: 1 }],
        sessions: [{ start: 1, end: 2, minutes: 1, prompts: 1 }],
        prompts: [1, 2, 3],
      },
    ],
  };
  assert.equal(structuralError(rich), null);
});

test('structuralError rejects hostile and malformed shapes', () => {
  const cases: Array<[unknown, RegExp]> = [
    ['not an object', /top level/],
    [null, /top level/],
    [42, /top level/],
    [{ ...validExport, projects: undefined }, /"projects" array/],
    [{ ...validExport, projects: {} }, /"projects" array/],
    [{ ...validExport, totals: undefined }, /"totals" object/],
    [{ ...validExport, provider: 123 }, /"provider" must be a string/],
    [{ ...validExport, generated_at: {} }, /"generated_at" must be a string/],
    [{ ...validExport, projects: ['x'] }, /entry is not an object/],
    [{ ...validExport, projects: [{ ...validProject, id: 999 }] }, /string "id"/],
    [
      { ...validExport, projects: [{ ...validProject, name: { evil: '<script>' } }] },
      /string "name"/,
    ],
    [{ ...validExport, projects: [{ id: 'a', name: 'b' }] }, /"totals" object/],
    [
      { ...validExport, projects: [{ ...validProject, daily: 'nope' }] },
      /"daily" is not an array/,
    ],
    [
      { ...validExport, projects: [{ ...validProject, daily: [{ date: 5 }] }] },
      /non-string "date"/,
    ],
    [
      { ...validExport, projects: [{ ...validProject, sessions: {} }] },
      /"sessions" is not an array/,
    ],
    [
      { ...validExport, projects: [{ ...validProject, prompts: 7 }] },
      /"prompts" is not an array/,
    ],
  ];
  for (const [input, pattern] of cases) {
    const err = structuralError(input);
    assert.ok(err, `expected an error for ${JSON.stringify(input)}`);
    assert.match(err, pattern);
  }
});
