import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAnniversaryDay,
  getNextShanghaiMidnight,
  relationshipStartDate,
} from '../src/lib/anniversary.ts';

const date = (value) => new Date(value);

test('exports the confirmed relationship start date', () => {
  assert.equal(relationshipStartDate, '2026-07-01');
});

test('counts inclusive days by the Shanghai calendar date', () => {
  assert.equal(getAnniversaryDay(date('2026-07-01T00:00:00+08:00')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-02T00:00:00+08:00')), 2);
  assert.equal(getAnniversaryDay(date('2026-09-22T12:34:56+08:00')), 84);
});

test('switches days at the Shanghai midnight UTC boundary', () => {
  assert.equal(getAnniversaryDay(date('2026-06-30T15:59:59.999Z')), 0);
  assert.equal(getAnniversaryDay(date('2026-06-30T16:00:00.000Z')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-01T15:59:59.999Z')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-01T16:00:00.000Z')), 2);
});

test('handles month, year, and leap-day boundaries', () => {
  assert.equal(getAnniversaryDay(date('2026-08-01T00:00:00+08:00')), 32);
  assert.equal(getAnniversaryDay(date('2027-01-01T00:00:00+08:00')), 185);
  assert.equal(getAnniversaryDay(date('2028-02-29T00:00:00+08:00')), 609);
});

test('equivalent instants with different timezone offsets have the same day', () => {
  const sameInstant = [
    date('2026-07-01T00:00:00+08:00'),
    date('2026-06-30T16:00:00Z'),
    date('2026-06-30T12:00:00-04:00'),
  ];

  for (const instant of sameInstant) {
    assert.equal(getAnniversaryDay(instant), 1);
  }
});

test('returns zero or less before the relationship starts', () => {
  assert.equal(getAnniversaryDay(date('2026-06-30T15:59:59.999Z')), 0);
  assert.equal(getAnniversaryDay(date('2026-06-29T15:59:59.999Z')), -1);
});

test('returns the next Shanghai midnight strictly after now', () => {
  assert.equal(
    getNextShanghaiMidnight(date('2026-07-01T15:59:59.999Z')).toISOString(),
    '2026-07-01T16:00:00.000Z',
  );
  assert.equal(
    getNextShanghaiMidnight(date('2026-07-01T16:00:00.000Z')).toISOString(),
    '2026-07-02T16:00:00.000Z',
  );
  assert.equal(
    getNextShanghaiMidnight(date('2026-07-31T12:00:00+08:00')).toISOString(),
    '2026-07-31T16:00:00.000Z',
  );
  assert.equal(
    getNextShanghaiMidnight(date('2026-12-31T12:00:00+08:00')).toISOString(),
    '2026-12-31T16:00:00.000Z',
  );
});

test('rejects invalid dates', () => {
  assert.throws(
    () => getAnniversaryDay(new Date(Number.NaN)),
    RangeError,
  );
  assert.throws(
    () => getNextShanghaiMidnight(new Date(Number.NaN)),
    RangeError,
  );
});
