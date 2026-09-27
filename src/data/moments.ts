export interface Moment {
  /** Shanghai calendar date as YYYY-MM-DD. */
  date: string;
  /** A short title, shown when the day is picked on the calendar. */
  title: string;
}

/**
 * Days worth marking on the calendar, beyond day 100 and the anniversaries.
 * Only add dates and titles that have been confirmed.
 */
export const moments: Moment[] = [];

export const momentTitles = new Map(moments.map(({ date, title }) => [date, title]));
