const DAY_MS = 24 * 60 * 60 * 1000;

function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('date must use YYYY-MM-DD');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError('date must be a real calendar date');
  }

  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError('date must be a real calendar date');
  }

  return parsed;
}

function basicDate(value: Date): string {
  const year = value.getUTCFullYear();
  if (year > 9999) throw new RangeError('date must be before year 10000');
  const yearText = String(year).padStart(4, '0');
  const monthText = String(value.getUTCMonth() + 1).padStart(2, '0');
  const dayText = String(value.getUTCDate()).padStart(2, '0');
  return `${yearText}${monthText}${dayText}`;
}

function escapeText(value: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError('title contains unsupported control characters');
  }

  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = '';
  let byteLength = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (byteLength + characterBytes > 75) {
      folded.push(current);
      current = ` ${character}`;
      byteLength = 1 + characterBytes;
    } else {
      current += character;
      byteLength += characterBytes;
    }
  }

  folded.push(current);
  return folded.join('\r\n');
}

function stableTitleId(title: string): string {
  const bytes = new TextEncoder().encode(title);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function calendarStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Creates an RFC 5545 all-day event with an exclusive next-day end date. */
export function createCalendarEvent(title: string, date: string): string {
  if (!title.trim()) throw new TypeError('title must not be empty');

  const start = parseCalendarDate(date);
  const end = new Date(start.getTime() + DAY_MS);
  const startDate = basicDate(start);
  const endDate = basicDate(end);
  const uid = `${startDate}-${stableTitleId(title)}@loveuhqq.x23.shop`;
  const stamp = calendarStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//loveuhqq.x23.shop//Calendar Export//ZH-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${startDate}`,
    `DTEND;VALUE=DATE:${endDate}`,
    `SUMMARY:${escapeText(title)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
