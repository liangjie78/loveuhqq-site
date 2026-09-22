const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The first calendar day of the relationship in Asia/Shanghai. */
export const relationshipStartDate = '2026-07-01';

const relationshipStartTimestamp = Date.parse(
  `${relationshipStartDate}T00:00:00Z`,
);

const relationshipStartCalendarDate = new Date(relationshipStartTimestamp);

export interface UpcomingAnniversary {
  title: string;
  date: string;
  daysRemaining: number;
}

function getValidTimestamp(now: Date): number {
  const timestamp = now.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new RangeError('now must be a valid Date');
  }

  return timestamp;
}

function getShanghaiCalendarDate(timestamp: number): Date {
  return new Date(timestamp + SHANGHAI_OFFSET_MS);
}

function getShanghaiCalendarTimestamp(timestamp: number): number {
  const shanghaiDate = getShanghaiCalendarDate(timestamp);

  return Date.UTC(
    shanghaiDate.getUTCFullYear(),
    shanghaiDate.getUTCMonth(),
    shanghaiDate.getUTCDate(),
  );
}

function formatCalendarDate(timestamp: number): string {
  const calendarDate = new Date(timestamp);
  const year = calendarDate.getUTCFullYear();
  const month = String(calendarDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(calendarDate.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
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
 * Returns the inclusive relationship day for the Shanghai calendar date of
 * `now`. The start date is day 1, so dates before it return zero or less.
 */
export function getAnniversaryDay(now: Date): number {
  const timestamp = getValidTimestamp(now);
  const shanghaiDate = getShanghaiCalendarDate(timestamp);
  const calendarDateTimestamp = Date.UTC(
    shanghaiDate.getUTCFullYear(),
    shanghaiDate.getUTCMonth(),
    shanghaiDate.getUTCDate(),
  );

  return (
    Math.floor(
      (calendarDateTimestamp - relationshipStartTimestamp) / DAY_MS,
    ) + 1
  );
}

/** Returns the next Shanghai midnight, strictly later than `now`. */
export function getNextShanghaiMidnight(now: Date): Date {
  const timestamp = getValidTimestamp(now);
  const shanghaiDate = getShanghaiCalendarDate(timestamp);
  const nextMidnightTimestamp =
    Date.UTC(
      shanghaiDate.getUTCFullYear(),
      shanghaiDate.getUTCMonth(),
      shanghaiDate.getUTCDate() + 1,
    ) - SHANGHAI_OFFSET_MS;

  return new Date(nextMidnightTimestamp);
}

/**
 * Returns the closest upcoming milestone in the Shanghai calendar.
 *
 * The start date is treated as a milestone on day 1, and the 100th day is
 * counted inclusively from that date. Anniversary dates use the same month
 * and day in each following year.
 */
export function getUpcomingAnniversary(now: Date): UpcomingAnniversary {
  const timestamp = getValidTimestamp(now);
  const currentCalendarTimestamp = getShanghaiCalendarTimestamp(timestamp);

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
