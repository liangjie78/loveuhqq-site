// Asia/Taipei is a fixed UTC+8 with no daylight saving, so a constant offset is exact.
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The first calendar day of the relationship in Asia/Taipei. */
export const relationshipStartDate = '2026-07-01';

/** Shared by the Astro templates and the client scripts, so keep one copy. */
export const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

/** Renders a YYYY-MM-DD date the way the journal prints it: 2026.07.01. */
export const dotted = (date: string) => date.replaceAll('-', '.');

const relationshipStartTimestamp = Date.parse(
  `${relationshipStartDate}T00:00:00Z`,
);

const relationshipStartCalendarDate = new Date(relationshipStartTimestamp);

export interface UpcomingAnniversary {
  title: string;
  date: string;
  daysRemaining: number;
}

export type MomentDateStatus = 'upcoming' | 'today' | 'past';

function getValidTimestamp(now: Date): number {
  const timestamp = now.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new RangeError('now must be a valid Date');
  }

  return timestamp;
}

function getTaipeiCalendarDate(timestamp: number): Date {
  return new Date(timestamp + TAIPEI_OFFSET_MS);
}

function getTaipeiCalendarTimestamp(timestamp: number): number {
  const taipeiDate = getTaipeiCalendarDate(timestamp);

  return Date.UTC(
    taipeiDate.getUTCFullYear(),
    taipeiDate.getUTCMonth(),
    taipeiDate.getUTCDate(),
  );
}

function formatCalendarDate(timestamp: number): string {
  const calendarDate = new Date(timestamp);
  const year = calendarDate.getUTCFullYear();
  const month = String(calendarDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(calendarDate.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** Returns a marked date's status against today's Taipei calendar date. */
export function getMomentDateStatus(date: string, now: Date): MomentDateStatus {
  const timestamp = getValidTimestamp(now);
  const today = formatCalendarDate(getTaipeiCalendarTimestamp(timestamp));

  if (date > today) return 'upcoming';
  if (date === today) return 'today';
  return 'past';
}

function getAnnualAnniversaryTimestamp(year: number): number {
  return Date.UTC(
    year,
    relationshipStartCalendarDate.getUTCMonth(),
    relationshipStartCalendarDate.getUTCDate(),
  );
}

/** The 100th calendar day, counting the relationship start as day 1. */
export const hundredthDayDate = formatCalendarDate(
  relationshipStartTimestamp + 99 * DAY_MS,
);

/**
 * Returns the inclusive relationship day for the Taipei calendar date of
 * `now`. The start date is day 1, so dates before it return zero or less.
 */
export function getAnniversaryDay(now: Date): number {
  const timestamp = getValidTimestamp(now);
  const calendarDateTimestamp = getTaipeiCalendarTimestamp(timestamp);

  return (
    Math.floor(
      (calendarDateTimestamp - relationshipStartTimestamp) / DAY_MS,
    ) + 1
  );
}

/** Returns the next Taipei midnight, strictly later than `now`. */
export function getNextTaipeiMidnight(now: Date): Date {
  const timestamp = getValidTimestamp(now);
  const taipeiDate = getTaipeiCalendarDate(timestamp);
  const nextMidnightTimestamp =
    Date.UTC(
      taipeiDate.getUTCFullYear(),
      taipeiDate.getUTCMonth(),
      taipeiDate.getUTCDate() + 1,
    ) - TAIPEI_OFFSET_MS;

  return new Date(nextMidnightTimestamp);
}

/**
 * Returns the closest upcoming milestone in the Taipei calendar.
 *
 * The start date is treated as a milestone on day 1, and the 100th day is
 * counted inclusively from that date. Anniversary dates use the same month
 * and day in each following year.
 */
export function getUpcomingAnniversary(now: Date): UpcomingAnniversary {
  const timestamp = getValidTimestamp(now);
  const currentCalendarTimestamp = getTaipeiCalendarTimestamp(timestamp);

  if (currentCalendarTimestamp <= relationshipStartTimestamp) {
    return {
      title: '故事开始的那一天',
      date: relationshipStartDate,
      daysRemaining: Math.floor(
        (relationshipStartTimestamp - currentCalendarTimestamp) / DAY_MS,
      ),
    };
  }

  const candidates: Array<{
    title: string;
    timestamp: number;
  }> = [];
  const hundredthDayTimestamp = relationshipStartTimestamp + 99 * DAY_MS;

  if (currentCalendarTimestamp <= hundredthDayTimestamp) {
    candidates.push({
      title: '第 100 天',
      timestamp: hundredthDayTimestamp,
    });
  }

  const startYear = relationshipStartCalendarDate.getUTCFullYear();
  const currentYear = new Date(currentCalendarTimestamp).getUTCFullYear();
  let anniversaryYear = Math.max(currentYear, startYear + 1);
  let anniversaryTimestamp = getAnnualAnniversaryTimestamp(anniversaryYear);

  if (anniversaryTimestamp < currentCalendarTimestamp) {
    anniversaryYear += 1;
    anniversaryTimestamp = getAnnualAnniversaryTimestamp(anniversaryYear);
  }

  candidates.push({
    title: `第 ${anniversaryYear - startYear} 周年`,
    timestamp: anniversaryTimestamp,
  });

  candidates.sort((left, right) => left.timestamp - right.timestamp);
  const next = candidates[0];

  return {
    title: next.title,
    date: formatCalendarDate(next.timestamp),
    daysRemaining: Math.floor(
      (next.timestamp - currentCalendarTimestamp) / DAY_MS,
    ),
  };
}

export interface CalendarDay {
  /** Taipei calendar date as YYYY-MM-DD. */
  date: string;
  /** Day of the month, 1-31. */
  dayOfMonth: number;
  /** Relationship day; the start date is day 1. */
  day: number;
}

export interface CalendarMonth {
  year: number;
  /** Calendar month, 1-12. */
  month: number;
  days: CalendarDay[];
}

/**
 * Returns the relationship year that the Taipei calendar date of `now`
 * falls in. Each anniversary closes its year: year 1 runs from the start
 * date through the first anniversary, year 2 from the next day through the
 * second anniversary. Dates before the start belong to year 1.
 */
export function getRelationshipYear(now: Date): number {
  const currentCalendarTimestamp = getTaipeiCalendarTimestamp(
    getValidTimestamp(now),
  );
  const startYear = relationshipStartCalendarDate.getUTCFullYear();
  const currentYear = new Date(currentCalendarTimestamp).getUTCFullYear();
  let year = Math.max(1, currentYear - startYear);

  if (currentCalendarTimestamp > getAnnualAnniversaryTimestamp(startYear + year)) {
    year += 1;
  }

  return year;
}

/**
 * Lists every calendar day of relationship year `year`, grouped by calendar
 * month in order, ending with the anniversary that closes the year.
 */
export function getRelationshipYearMonths(year: number): CalendarMonth[] {
  if (!Number.isInteger(year) || year < 1) {
    throw new RangeError('year must be a positive integer');
  }

  const startYear = relationshipStartCalendarDate.getUTCFullYear();
  const firstTimestamp =
    year === 1
      ? relationshipStartTimestamp
      : getAnnualAnniversaryTimestamp(startYear + year - 1) + DAY_MS;
  const lastTimestamp = getAnnualAnniversaryTimestamp(startYear + year);
  const months: CalendarMonth[] = [];

  for (let timestamp = firstTimestamp; timestamp <= lastTimestamp; timestamp += DAY_MS) {
    const calendarDate = new Date(timestamp);
    const calendarYear = calendarDate.getUTCFullYear();
    const month = calendarDate.getUTCMonth() + 1;
    let current = months[months.length - 1];

    if (!current || current.year !== calendarYear || current.month !== month) {
      current = { year: calendarYear, month, days: [] };
      months.push(current);
    }

    current.days.push({
      date: formatCalendarDate(timestamp),
      dayOfMonth: calendarDate.getUTCDate(),
      day: Math.round((timestamp - relationshipStartTimestamp) / DAY_MS) + 1,
    });
  }

  return months;
}
