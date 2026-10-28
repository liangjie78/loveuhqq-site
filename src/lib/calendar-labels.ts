/** Words for the year of days: relationship years, anniversaries and spoken dates. */
const numerals = '一二三四五六七八九十';

export const yearLabel = (year: number) => (year <= 10 ? `第${numerals[year - 1]}年` : `第 ${year} 年`);
export const anniversaryLabel = (year: number) => year === 2 ? '两周年' : year <= 10 ? `${numerals[year - 1]}周年` : `${year} 周年`;

export function spokenDate(date: string, currentYear: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return year === currentYear ? `${month} 月 ${day} 日` : `${year} 年 ${month} 月 ${day} 日`;
}

export interface DayDescription { day: number; date: string; today: number; anniversaryDay: number; relationshipYear: number; currentYear: number; moment?: string }

export function describeDay({ day, date, today, anniversaryDay, relationshipYear, currentYear, moment }: DayDescription): string {
  const name = day === anniversaryDay ? `${anniversaryLabel(relationshipYear)} · 第 ${day} 天` : `第 ${day} 天`;
  const parts = [day === today ? '今天' : '', spokenDate(date, currentYear), name, moment ?? ''];
  if (day > today) parts.push(`还有 ${day - today} 天`);
  return parts.filter(Boolean).join(' · ');
}

/** A steady, scattered tone per day so the lit dots look hand-mixed. */
export const dayTone = (day: number) => Math.imul(day, 2654435761) >>> 29 & 3;
