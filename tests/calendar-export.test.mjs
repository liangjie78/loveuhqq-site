import assert from 'node:assert/strict';
import test from 'node:test';

import { createCalendarEvent } from '../src/lib/calendar-export.ts';

const unfold = (ics) => ics.replace(/\r\n[ \t]/g, '');

test('creates an RFC 5545 all-day event with an exclusive end date', () => {
  const ics = createCalendarEvent('第 100 天', '2026-10-08');

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261008\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261009\r\n/);
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z\r\n/);
  assert.match(ics, /SUMMARY:第 100 天\r\n/);
  assert.match(ics, /\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
});

test('moves the exclusive end date across year and leap-day boundaries', () => {
  const yearEnd = unfold(createCalendarEvent('周年', '2026-12-31'));
  assert.match(yearEnd, /DTSTART;VALUE=DATE:20261231\r\n/);
  assert.match(yearEnd, /DTEND;VALUE=DATE:20270101\r\n/);

  const leapDay = unfold(createCalendarEvent('闰日', '2024-02-29'));
  assert.match(leapDay, /DTSTART;VALUE=DATE:20240229\r\n/);
  assert.match(leapDay, /DTEND;VALUE=DATE:20240301\r\n/);
});

test('escapes RFC 5545 text characters and keeps a deterministic UID', () => {
  const title = '你,好;\n\u0026\\我';
  const first = unfold(createCalendarEvent(title, '2026-07-01'));
  const second = unfold(createCalendarEvent(title, '2026-07-01'));

  assert.match(first, /SUMMARY:你\\,好\\;\\n&\\\\我\r\n/);
  const firstUid = first.match(/^UID:(.+)$/m)?.[1];
  const secondUid = second.match(/^UID:(.+)$/m)?.[1];
  assert.ok(firstUid);
  assert.equal(firstUid, secondUid);
});

test('folds UTF-8 content lines to no more than 75 octets', () => {
  const ics = createCalendarEvent('纪念'.repeat(50), '2026-10-08');
  const lines = ics.split('\r\n').filter(Boolean);

  assert.ok(lines.some((line) => line.startsWith(' ')), 'long line should be folded');
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line has ${Buffer.byteLength(line, 'utf8')} bytes`);
  }
});

test('rejects empty titles and invalid or non-ISO dates', () => {
  assert.throws(() => createCalendarEvent('   ', '2026-10-08'), TypeError);
  for (const invalidDate of ['2026-2-08', '2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01']) {
    assert.throws(() => createCalendarEvent('纪念日', invalidDate), RangeError, invalidDate);
  }
  assert.throws(() => createCalendarEvent('纪念日', '9999-12-31'), RangeError);
});
