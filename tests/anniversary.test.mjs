import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAnniversaryDay,
  getMomentDateStatus,
  getNextTaipeiMidnight,
  getUpcomingAnniversary,
  hundredthDayDate,
  relationshipStartDate,
} from '../src/lib/anniversary.ts';

const date = (value) => new Date(value);

test('exports the confirmed relationship start date', () => {
  assert.equal(relationshipStartDate, '2026-07-01');
  assert.equal(hundredthDayDate, '2026-10-08');
});

test('counts inclusive days by the Taipei calendar date', () => {
  assert.equal(getAnniversaryDay(date('2026-07-01T00:00:00+08:00')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-02T00:00:00+08:00')), 2);
  assert.equal(getAnniversaryDay(date('2026-09-22T12:34:56+08:00')), 84);
});

test('switches days at the Taipei midnight UTC boundary', () => {
  assert.equal(getAnniversaryDay(date('2026-06-30T15:59:59.999Z')), 0);
  assert.equal(getAnniversaryDay(date('2026-06-30T16:00:00.000Z')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-01T15:59:59.999Z')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-01T16:00:00.000Z')), 2);
});

test('marks a moment upcoming, current, then past at Taipei midnight boundaries', () => {
  const momentDate = '2026-10-08';

  assert.equal(
    getMomentDateStatus(momentDate, date('2026-10-07T15:59:59.999Z')),
    'upcoming',
  );
  assert.equal(
    getMomentDateStatus(momentDate, date('2026-10-07T16:00:00.000Z')),
    'today',
  );
  assert.equal(
    getMomentDateStatus(momentDate, date('2026-10-08T15:59:59.999Z')),
    'today',
  );
  assert.equal(
    getMomentDateStatus(momentDate, date('2026-10-08T16:00:00.000Z')),
    'past',
  );
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

test('returns the next Taipei midnight strictly after now', () => {
  assert.equal(
    getNextTaipeiMidnight(date('2026-07-01T15:59:59.999Z')).toISOString(),
    '2026-07-01T16:00:00.000Z',
  );
  assert.equal(
    getNextTaipeiMidnight(date('2026-07-01T16:00:00.000Z')).toISOString(),
    '2026-07-02T16:00:00.000Z',
  );
  assert.equal(
    getNextTaipeiMidnight(date('2026-07-31T12:00:00+08:00')).toISOString(),
    '2026-07-31T16:00:00.000Z',
  );
  assert.equal(
    getNextTaipeiMidnight(date('2026-12-31T12:00:00+08:00')).toISOString(),
    '2026-12-31T16:00:00.000Z',
  );
});

test('rejects invalid dates', () => {
  assert.throws(
    () => getAnniversaryDay(new Date(Number.NaN)),
    RangeError,
  );
  assert.throws(
    () => getNextTaipeiMidnight(new Date(Number.NaN)),
    RangeError,
  );
  assert.throws(
    () => getUpcomingAnniversary(new Date(Number.NaN)),
    RangeError,
  );
});

test('returns the start milestone before and on the relationship start date', () => {
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-06-30T15:59:59.999Z')),
    {
      title: '故事开始的那一天',
      date: '2026-07-01',
      daysRemaining: 1,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-07-01T00:00:00+08:00')),
    {
      title: '故事开始的那一天',
      date: '2026-07-01',
      daysRemaining: 0,
    },
  );
});

test('selects the 100th day before and on its Taipei calendar date', () => {
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-10-07T23:59:59+08:00')),
    {
      title: '第 100 天',
      date: '2026-10-08',
      daysRemaining: 1,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-10-08T00:00:00+08:00')),
    {
      title: '第 100 天',
      date: '2026-10-08',
      daysRemaining: 0,
    },
  );
});

test('moves to the first anniversary after the 100th day', () => {
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-10-09T00:00:00+08:00')),
    {
      title: '第 1 周年',
      date: '2027-07-01',
      daysRemaining: 265,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2027-06-30T23:59:59+08:00')),
    {
      title: '第 1 周年',
      date: '2027-07-01',
      daysRemaining: 1,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2027-07-01T00:00:00+08:00')),
    {
      title: '第 1 周年',
      date: '2027-07-01',
      daysRemaining: 0,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2027-07-02T00:00:00+08:00')),
    {
      title: '第 2 周年',
      date: '2028-07-01',
      daysRemaining: 365,
    },
  );
});

test('counts leap-day calendar distance toward the next anniversary', () => {
  assert.deepEqual(
    getUpcomingAnniversary(date('2028-02-29T00:00:00+08:00')),
    {
      title: '第 2 周年',
      date: '2028-07-01',
      daysRemaining: 123,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2028-07-01T00:00:00+08:00')),
    {
      title: '第 2 周年',
      date: '2028-07-01',
      daysRemaining: 0,
    },
  );
  assert.deepEqual(
    getUpcomingAnniversary(date('2028-07-02T00:00:00+08:00')),
    {
      title: '第 3 周年',
      date: '2029-07-01',
      daysRemaining: 364,
    },
  );
});
