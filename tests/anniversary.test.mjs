import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAnniversaryDay,
  getMomentDateStatus,
  getNextShanghaiMidnight,
  getShanghaiDate,
  getUpcomingAnniversary,
} from '../src/lib/anniversary.ts';

const date = (value) => new Date(value);

test('today writing uses the Shanghai date across midnight and year boundaries', () => {
  assert.equal(getShanghaiDate(date('2026-10-15T15:59:59.999Z')), '2026-10-15');
  assert.equal(getShanghaiDate(date('2026-10-15T16:00:00.000Z')), '2026-10-16');
  assert.equal(getShanghaiDate(date('2026-12-31T16:00:00.000Z')), '2027-01-01');
  assert.throws(() => getShanghaiDate(new Date(NaN)), RangeError);
});

test('counts inclusive relationship days at Shanghai midnight and through leap years', () => {
  assert.equal(getAnniversaryDay(date('2026-06-30T15:59:59.999Z')), 0);
  assert.equal(getAnniversaryDay(date('2026-06-30T16:00:00.000Z')), 1);
  assert.equal(getAnniversaryDay(date('2026-07-01T16:00:00.000Z')), 2);
  assert.equal(getAnniversaryDay(date('2028-02-29T00:00:00+08:00')), 609);
});

test('marks a moment upcoming, current, then past at Shanghai midnight boundaries', () => {
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
    getMomentDateStatus(momentDate, date('2026-10-08T16:00:00.000Z')),
    'past',
  );
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
});

test('returns the start milestone on the relationship start date', () => {
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-07-01T00:00:00+08:00')),
    {
      title: '故事开始的那一天',
      date: '2026-07-01',
      daysRemaining: 0,
    },
  );
});

test('selects the 100th day through its date, then advances to the first anniversary', () => {
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
  assert.deepEqual(
    getUpcomingAnniversary(date('2026-10-09T00:00:00+08:00')),
    {
      title: '第 1 周年',
      date: '2027-07-01',
      daysRemaining: 265,
    },
  );
});

test('advances annual anniversaries and includes leap day in the countdown', () => {
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
  assert.deepEqual(
    getUpcomingAnniversary(date('2028-02-29T00:00:00+08:00')),
    {
      title: '第 2 周年',
      date: '2028-07-01',
      daysRemaining: 123,
    },
  );
});
