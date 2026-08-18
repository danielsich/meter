import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ClockworkExport } from './clockwork.ts';
import { shouldCompareUpload } from './upload.ts';

function data(provider: string): ClockworkExport {
  return {
    schema: 'clockwork/v3',
    generated_at: '2026-08-18T00:00:00Z',
    provider,
    projects: [],
    totals: { projects: 0, minutes: 0, prompts: 0, sessions: 0 },
  };
}

test('the first upload replaces published sample data', () => {
  assert.equal(shouldCompareUpload(data('sample'), 'published', data('codex')), false);
  assert.equal(shouldCompareUpload(data('sample'), 'published', data('claude')), false);
});

test('two uploaded single-provider exports with different providers compare', () => {
  assert.equal(shouldCompareUpload(data('claude'), 'upload', data('codex')), true);
  assert.equal(shouldCompareUpload(data('codex'), 'upload', data('claude')), true);
});

test('comparison rejects missing, same-provider, and combined data', () => {
  assert.equal(shouldCompareUpload(null, null, data('codex')), false);
  assert.equal(shouldCompareUpload(data('codex'), 'upload', data('codex')), false);
  assert.equal(shouldCompareUpload(data('both'), 'upload', data('codex')), false);
  assert.equal(shouldCompareUpload(data('codex'), 'upload', data('both')), false);
});
