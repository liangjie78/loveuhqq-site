import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNotebook, parseNotebook, mergeNotebooks, isCalendarDate } from '../src/lib/notebook.ts';

test('calendar dates reject rollover and accept leap days', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  for (const date of ['2027-02-29', '2026-04-31', '2026-13-01', 'x', '__proto__']) assert.equal(isCalendarDate(date), false);
});
test('backup preserves multiline text and wish completion', () => {
  const book = { version: 1, notes: { '2026-10-01': '第一行\n<script>不是代码</script>' }, wishes: [{ id: 'test-1', text: '待填写的事', done: true }] };
  assert.deepEqual(parseNotebook(JSON.stringify(book)), book);
});
test('invalid or partially invalid backups are rejected as a whole', () => {
  for (const book of [{ version: 2, notes: {}, wishes: [] }, { version: 1, notes: { '2026-02-30': 'a' }, wishes: [] }, { version: 1, notes: {}, wishes: [{ id: 'a', text: 'x', done: 'false' }] }, { version: 1, notes: {}, wishes: [{ id: 'a', text: 'x', done: false }, { id: 'a', text: 'y', done: true }] }]) assert.throws(() => parseNotebook(JSON.stringify(book)));
});
test('restoring merges without overwriting current writing or duplicating wishes', () => {
  const current = { version: 1, notes: { '2026-10-01': '本机修改' }, wishes: [{ id: 'a', text: '现在', done: true }] };
  const incoming = { version: 1, notes: { '2026-10-01': '旧备份', '2026-10-02': '恢复' }, wishes: [{ id: 'a', text: '之前', done: false }, { id: 'b', text: '新增', done: false }] };
  const merged = mergeNotebooks(current, incoming);
  assert.equal(merged.notes['2026-10-01'], '本机修改');
  assert.equal(merged.notes['2026-10-02'], '恢复');
  assert.deepEqual(merged.wishes, [current.wishes[0], incoming.wishes[1]]);
  assert.deepEqual(mergeNotebooks(merged, incoming), merged);
  assert.deepEqual(mergeNotebooks(emptyNotebook(), current), current);
});
