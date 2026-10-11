import assert from 'node:assert/strict';
import test from 'node:test';

import { moments } from '../src/data/moments.ts';

test('moments use real YYYY-MM-DD dates, unique and non-empty titles', () => {
  const seen = new Set();
  for (const { date, title } of moments) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
    assert.ok(title.trim(), `empty title for ${date}`);
    assert.ok(!seen.has(date), `duplicate ${date}`);
    seen.add(date);
  }
  for (const date of ['2026-05-27', '2026-07-01', '2026-09-06', '2026-10-08']) {
    assert.ok(seen.has(date), `missing confirmed moment ${date}`);
  }
});
