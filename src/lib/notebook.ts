export interface Wish { id: string; text: string; done: boolean }
export interface Notebook { version: 1; notes: Record<string, string>; wishes: Wish[] }
export interface CloudNotebook extends Notebook {
  revisions: { notes: Record<string, number>; wishes: Record<string, number> };
}
export const emptyNotebook = (): Notebook => ({ version: 1, notes: {}, wishes: [] });

export function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) >= 1900 &&
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** Validate a complete notebook payload without truncating any writing. */
export function parseNotebook(raw: string): Notebook {
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || !value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes) || !Array.isArray(value.wishes)) throw new Error('Invalid notebook');
  const entries = Object.entries(value.notes);
  if (entries.length > 3000 || value.wishes.length > 300) throw new Error('Notebook too large');
  const result = emptyNotebook();
  for (const [date, text] of entries) {
    if (!isCalendarDate(date) || typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Invalid note');
    result.notes[date] = text;
  }
  const ids = new Set<string>();
  for (const wish of value.wishes) {
    if (!wish || typeof wish.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(wish.id) || ids.has(wish.id) || typeof wish.text !== 'string' || !wish.text.trim() || wish.text.length > 120 || typeof wish.done !== 'boolean') throw new Error('Invalid wish');
    ids.add(wish.id);
    result.wishes.push({ id: wish.id, text: wish.text, done: wish.done });
  }
  return result;
}
