import type { CloudNotebook } from './cloud-notebook';
import { isCalendarDate, parseNotebook, type Wish } from './notebook';

/** Pure pieces of the shared notebook protocol: validation, merging and drafts. */

export const revisionOf = (revisions: Record<string, number>, key: string) => Object.hasOwn(revisions, key) ? revisions[key] : 0;

export function validateCloud(value: unknown): CloudNotebook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cloud notebook');
  const record = value as Partial<CloudNotebook>;
  const parsed = parseNotebook(JSON.stringify(value));
  const revisions = record.revisions;
  if (!revisions || typeof revisions !== 'object' || !revisions.notes || typeof revisions.notes !== 'object' || Array.isArray(revisions.notes)
    || !revisions.wishes || typeof revisions.wishes !== 'object' || Array.isArray(revisions.wishes)) throw new Error('Invalid revisions');
  const notes: Record<string, number> = {};
  for (const [key, revision] of Object.entries(revisions.notes)) {
    if (!isCalendarDate(key) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid note revision');
    notes[key] = revision;
  }
  const wishes: Record<string, number> = {};
  for (const [key, revision] of Object.entries(revisions.wishes)) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(key) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid wish revision');
    wishes[key] = revision;
  }
  return { ...parsed, revisions: { notes, wishes } };
}

/** Keeps, per note and per wish, whichever side carries the newer revision. */
export function mergeCloud(currentValue: CloudNotebook, incomingValue: CloudNotebook): CloudNotebook {
  const current = validateCloud(currentValue);
  const incoming = validateCloud(incomingValue);
  const notes: Record<string, string> = { ...current.notes };
  const noteVersions: Record<string, number> = { ...current.revisions.notes };
  const noteKeys = new Set([...Object.keys(current.revisions.notes), ...Object.keys(incoming.revisions.notes), ...Object.keys(current.notes), ...Object.keys(incoming.notes)]);
  for (const key of noteKeys) {
    const after = revisionOf(incoming.revisions.notes, key);
    if (after >= revisionOf(current.revisions.notes, key)) {
      if (Object.hasOwn(incoming.notes, key)) notes[key] = incoming.notes[key]; else delete notes[key];
      if (Object.hasOwn(incoming.revisions.notes, key)) noteVersions[key] = after; else delete noteVersions[key];
    }
  }
  const currentById = new Map(current.wishes.map(wish => [wish.id, wish]));
  const incomingById = new Map(incoming.wishes.map(wish => [wish.id, wish]));
  const wishVersions: Record<string, number> = { ...current.revisions.wishes };
  for (const id of new Set([...Object.keys(current.revisions.wishes), ...Object.keys(incoming.revisions.wishes), ...currentById.keys(), ...incomingById.keys()])) {
    const after = revisionOf(incoming.revisions.wishes, id);
    if (after >= revisionOf(current.revisions.wishes, id)) {
      if (Object.hasOwn(incoming.revisions.wishes, id)) wishVersions[id] = after; else delete wishVersions[id];
    }
  }
  const wishes: Wish[] = [];
  const order = [...current.wishes.map(({ id }) => id), ...incoming.wishes.map(({ id }) => id).filter(id => !currentById.has(id))];
  for (const id of order) {
    const selected = revisionOf(incoming.revisions.wishes, id) >= revisionOf(current.revisions.wishes, id) ? incomingById.get(id) : currentById.get(id);
    if (selected && !wishes.some(wish => wish.id === id)) wishes.push(selected);
  }
  return { version: 1, notes, wishes, revisions: { notes: noteVersions, wishes: wishVersions } };
}

export interface Drafts { version: 1; notes: Record<string, string>; wishText: string; wishes: Record<string, string> }
export const DRAFT_KEY = 'loveuhqq_notebook_drafts_v1';
export const emptyDrafts = (): Drafts => ({ version: 1, notes: {}, wishText: '', wishes: {} });

export function parseDrafts(raw: string | null): Drafts {
  if (!raw) return emptyDrafts();
  try {
    const value = JSON.parse(raw) as Partial<Drafts>;
    const strings = (input: unknown) => input && typeof input === 'object' && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
    return { version: 1, notes: strings(value.notes), wishText: typeof value.wishText === 'string' ? value.wishText : '', wishes: strings(value.wishes) };
  } catch { return emptyDrafts(); }
}

/** Dates with non-empty notes, newest first. */
export const writtenDates = (notes: Record<string, string>) => Object.keys(notes).filter(key => notes[key].trim()).sort().reverse();

/** Date (月日 or full) or text search over saved notes. */
export function searchNotes(notes: Record<string, string>, rawQuery: string): string[] {
  const query = rawQuery.trim().toLocaleLowerCase().replaceAll(/\s/g, '');
  return writtenDates(notes).filter(key => {
    const [year, month, day] = key.split('-');
    const labels = [key, `${year}-${Number(month)}-${Number(day)}`, `${Number(month)}-${Number(day)}`, `${year}年${Number(month)}月${Number(day)}日`, `${Number(month)}月${Number(day)}日`, `${Number(month)}月`];
    return labels.some(label => label.includes(query.replaceAll(/[./]/g, '-'))) || notes[key].toLocaleLowerCase().replaceAll(/\s/g, '').includes(query);
  });
}

export const excerpt = (text: string, length = 60) => {
  const chars = [...text.replaceAll(/\s+/g, ' ').trim()];
  return `${chars.slice(0, length).join('')}${chars.length > length ? '…' : ''}`;
};
