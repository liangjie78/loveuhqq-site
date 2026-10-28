// The journal counts days in Beijing time, from 2026-07-01 as day 1.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/bundle.mjs';

const a = await load('src/lib/anniversary.ts');
const labels = await load('src/lib/calendar-labels.ts');
const at = iso => new Date(iso);

describe('day count', () => {
  test('the first day is day 1, in Beijing time', () => {
    assert.equal(a.getAnniversaryDay(at('2026-06-30T16:00:00Z')), 1, 'midnight in Beijing is still the evening before in UTC');
    assert.equal(a.getAnniversaryDay(at('2026-06-30T15:59:59Z')), 0);
    assert.equal(a.getAnniversaryDay(at('2026-10-08T04:00:00Z')), 100);
  });

  test('the next midnight is a Beijing midnight', () => {
    assert.equal(a.getNextShanghaiMidnight(at('2026-10-28T10:00:00Z')).toISOString(), '2026-10-28T16:00:00.000Z');
    assert.equal(a.getShanghaiDate(at('2026-10-28T17:00:00Z')), '2026-10-29');
  });
});

describe('the next anniversary', () => {
  test('points at day 100 first, then at each year', () => {
    assert.deepEqual(a.getUpcomingAnniversary(at('2026-09-01T04:00:00Z')), { title: '第 100 天', date: '2026-10-08', daysRemaining: 37 });
    assert.equal(a.getUpcomingAnniversary(at('2026-10-08T04:00:00Z')).daysRemaining, 0);
    assert.deepEqual(a.getUpcomingAnniversary(at('2026-10-09T04:00:00Z')).title, '第 1 周年');
    assert.equal(a.getUpcomingAnniversary(at('2027-07-01T04:00:00Z')).daysRemaining, 0);
    assert.equal(a.getUpcomingAnniversary(at('2027-07-02T04:00:00Z')).title, '第 2 周年');
  });

  test('a moment is upcoming, today, or past', () => {
    const now = at('2026-10-28T04:00:00Z');
    assert.equal(a.getMomentDateStatus('2026-10-29', now), 'upcoming');
    assert.equal(a.getMomentDateStatus('2026-10-28', now), 'today');
    assert.equal(a.getMomentDateStatus('2026-05-27', now), 'past');
  });
});

describe('relationship years', () => {
  test('a year ends on its anniversary, so the first one has 366 days', () => {
    const first = a.getRelationshipYearMonths(1);
    const days = first.flatMap(month => month.days);
    assert.equal(days.length, 366);
    assert.equal(days[0].date, '2026-07-01');
    assert.equal(days.at(-1).date, '2027-07-01');
    assert.equal(first.length, 13);
    const second = a.getRelationshipYearMonths(2).flatMap(month => month.days);
    assert.equal(second[0].date, '2027-07-02');
    assert.equal(second[0].day, 367);
  });

  test('today belongs to the year whose anniversary has not passed', () => {
    assert.equal(a.getRelationshipYear(at('2027-07-01T04:00:00Z')), 1);
    assert.equal(a.getRelationshipYear(at('2027-07-02T04:00:00Z')), 2);
  });
});

describe('calendar words', () => {
  test('years and anniversaries are named in Chinese numerals', () => {
    assert.equal(labels.yearLabel(1), '第一年');
    assert.equal(labels.yearLabel(12), '第 12 年');
    assert.equal(labels.anniversaryLabel(2), '两周年');
    assert.equal(labels.anniversaryLabel(3), '三周年');
  });

  test('the readout names the day, how far it is, and its story', () => {
    const base = { today: 120, anniversaryDay: 366, relationshipYear: 1, currentYear: 2026 };
    assert.equal(labels.describeDay({ ...base, day: 120, date: '2026-10-28' }), '今天 · 10 月 28 日 · 第 120 天');
    assert.equal(labels.describeDay({ ...base, day: 366, date: '2027-07-01' }), '2027 年 7 月 1 日 · 一周年 · 第 366 天 · 还有 246 天');
    assert.equal(labels.describeDay({ ...base, day: 100, date: '2026-10-08', moment: '恋爱 100 天纪念' }), '10 月 8 日 · 第 100 天 · 恋爱 100 天纪念');
  });

  test('day tones are stable and stay within the four reds', () => {
    const tones = Array.from({ length: 400 }, (_, day) => labels.dayTone(day));
    assert.ok(tones.every(tone => tone >= 0 && tone <= 3));
    assert.equal(labels.dayTone(42), labels.dayTone(42));
    assert.ok(new Set(tones).size === 4);
  });
});
