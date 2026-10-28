// The shared notebook: validation, merging remote changes and drafts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/bundle.mjs';

const sync = await load('src/lib/notebook-sync.ts');
const notebook = await load('src/lib/notebook.ts');
const cloud = (notes = {}, wishes = [], revisions = {}) => ({ version: 1, notes, wishes, revisions: { notes: {}, wishes: {}, ...revisions } });

describe('validation', () => {
  test('accepts a well-formed notebook and refuses broken ones', () => {
    assert.deepEqual(sync.validateCloud(cloud({ '2026-07-01': '第一天' }, [], { notes: { '2026-07-01': 1 } })).notes, { '2026-07-01': '第一天' });
    assert.throws(() => sync.validateCloud(cloud({}, [], { notes: { 'not-a-date': 1 } })));
    assert.throws(() => sync.validateCloud(cloud({}, [], { wishes: { 'bad id!': 1 } })));
    assert.throws(() => sync.validateCloud({ version: 1, notes: {}, wishes: [] }));
    assert.throws(() => sync.validateCloud([]));
  });

  test('calendar dates must exist', () => {
    assert.equal(notebook.isCalendarDate('2028-02-29'), true);
    assert.equal(notebook.isCalendarDate('2026-02-29'), false);
    assert.equal(notebook.isCalendarDate('2026-7-1'), false);
  });
});

describe('merging', () => {
  test('the newer revision wins for each note independently', () => {
    const mine = cloud({ '2026-07-01': '我的新稿', '2026-07-02': '旧的' }, [], { notes: { '2026-07-01': 3, '2026-07-02': 1 } });
    const theirs = cloud({ '2026-07-01': '他们的旧稿', '2026-07-02': '他们的新稿' }, [], { notes: { '2026-07-01': 2, '2026-07-02': 2 } });
    const merged = sync.mergeCloud(mine, theirs);
    assert.equal(merged.notes['2026-07-01'], '我的新稿');
    assert.equal(merged.notes['2026-07-02'], '他们的新稿');
  });

  test('a newer removal (tombstone) removes the note', () => {
    const mine = cloud({ '2026-07-01': '还在' }, [], { notes: { '2026-07-01': 1 } });
    const theirs = cloud({}, [], { notes: { '2026-07-01': 2 } });
    assert.equal(sync.mergeCloud(mine, theirs).notes['2026-07-01'], undefined);
  });

  test('wishes keep their order and new ones are appended', () => {
    const mine = cloud({}, [{ id: 'a', text: '甲', done: false }, { id: 'b', text: '乙', done: false }], { wishes: { a: 1, b: 1 } });
    const theirs = cloud({}, [{ id: 'a', text: '甲', done: false }, { id: 'b', text: '乙', done: true }, { id: 'c', text: '丙', done: false }], { wishes: { a: 1, b: 2, c: 1 } });
    const merged = sync.mergeCloud(mine, theirs);
    assert.deepEqual(merged.wishes.map(wish => wish.id), ['a', 'b', 'c']);
    assert.equal(merged.wishes.find(wish => wish.id === 'b').done, true);
  });

  test('a wish the server no longer lists, at a current revision, is gone', () => {
    const mine = cloud({}, [{ id: 'a', text: '甲', done: false }], { wishes: { a: 1 } });
    const theirs = cloud({}, [], { wishes: { a: 2 } });
    assert.deepEqual(sync.mergeCloud(mine, theirs).wishes, []);
  });
});

describe('drafts, search and excerpts', () => {
  test('drafts survive bad storage without throwing', () => {
    assert.deepEqual(sync.parseDrafts(null), sync.emptyDrafts());
    assert.deepEqual(sync.parseDrafts('{oops'), sync.emptyDrafts());
    assert.deepEqual(sync.parseDrafts(JSON.stringify({ notes: { '2026-07-01': '草稿', bad: 3 }, wishText: 9 })).notes, { '2026-07-01': '草稿' });
  });

  test('notes can be found by month, by date or by a few remembered words', () => {
    const notes = { '2026-07-01': '第一次见面', '2026-10-08': '一百天，吃了蛋糕', '2026-10-20': '  ' };
    assert.deepEqual(sync.writtenDates(notes), ['2026-10-08', '2026-07-01']);
    assert.deepEqual(sync.searchNotes(notes, '10月'), ['2026-10-08']);
    assert.deepEqual(sync.searchNotes(notes, '7-1'), ['2026-07-01']);
    assert.deepEqual(sync.searchNotes(notes, '2026.10.08'), ['2026-10-08']);
    assert.deepEqual(sync.searchNotes(notes, '蛋 糕'), ['2026-10-08']);
    assert.deepEqual(sync.searchNotes(notes, ''), ['2026-10-08', '2026-07-01']);
  });

  test('excerpts are trimmed by characters, not bytes', () => {
    assert.equal(sync.excerpt('一二三四五', 3), '一二三…');
    assert.equal(sync.excerpt('  短  句 ', 10), '短 句');
  });
});
