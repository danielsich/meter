import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatTokens } from './display.ts';

test('formatTokens matches clockwork compact token labels', () => {
  assert.equal(formatTokens(1_200_000), '1.2M');
  assert.equal(formatTokens(730_200_000), '730.2M');
  assert.equal(formatTokens(1_500_000_000), '1.5B');
  assert.equal(formatTokens(999), '999');
});
