export interface Moment {
  /** Shanghai calendar date as YYYY-MM-DD. */
  date: string;
  /** A short title, shown when the day is picked on the calendar. */
  title: string;
}

/**
 * Days worth marking on the calendar. Day 100 and anniversaries are already hearts;
 * list one here only when it should also carry its own confirmed title.
 * Only add dates and titles that have been confirmed.
 */
export const moments: Moment[] = [
  // Before the calendar's first day, so it has no cell yet; kept as a confirmed date.
  { date: '2026-05-27', title: '通过游戏认识' },
  { date: '2026-07-01', title: '第一天' },
  { date: '2026-09-06', title: '抖音火花 100 天' },
  { date: '2026-10-08', title: '恋爱 100 天纪念' },
];

export const momentTitles = new Map(moments.map(({ date, title }) => [date, title]));
