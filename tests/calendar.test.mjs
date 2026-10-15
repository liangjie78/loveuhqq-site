import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRelationshipYear,
  getRelationshipYearMonths,
} from '../src/lib/anniversary.ts';

const date = (value) => new Date(value);

test('the anniversary closes its relationship year until the next Shanghai midnight', () => {
  assert.equal(getRelationshipYear(date('2026-06-01T12:00:00+08:00')), 1);
  assert.equal(getRelationshipYear(date('2027-07-01T15:59:59.999Z')), 1);
  assert.equal(getRelationshipYear(date('2027-07-01T16:00:00.000Z')), 2);
});

test('year 1 runs from the start date through the first anniversary', () => {
  const months = getRelationshipYearMonths(1);
  const days = months.flatMap((month) => month.days);

  assert.deepEqual(
    months.map(({ year, month, days }) => [year, month, days.length]),
    [
      [2026, 7, 31], [2026, 8, 31], [2026, 9, 30], [2026, 10, 31],
      [2026, 11, 30], [2026, 12, 31], [2027, 1, 31], [2027, 2, 28],
      [2027, 3, 31], [2027, 4, 30], [2027, 5, 31], [2027, 6, 30],
      [2027, 7, 1],
    ],
  );
  assert.deepEqual(days[0], { date: '2026-07-01', dayOfMonth: 1, day: 1 });
  assert.deepEqual(days.at(-1), { date: '2027-07-01', dayOfMonth: 1, day: 366 });
});

test('later years start the day after the previous anniversary', () => {
  const months = getRelationshipYearMonths(2);
  const days = months.flatMap((month) => month.days);

  assert.deepEqual(days[0], { date: '2027-07-02', dayOfMonth: 2, day: 367 });
  assert.deepEqual(days.at(-1), { date: '2028-07-01', dayOfMonth: 1, day: 732 });
  assert.equal(months.find(({ year, month }) => year === 2028 && month === 2).days.length, 29);
  assert.equal(days.length, 366);
});
