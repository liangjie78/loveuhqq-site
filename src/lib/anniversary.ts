const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The first calendar day of the relationship in Asia/Shanghai. */
export const relationshipStartDate = '2026-07-01';

const relationshipStartTimestamp = Date.parse(
  `${relationshipStartDate}T00:00:00Z`,
);

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
