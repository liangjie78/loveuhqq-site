// The shared desk's message protocol, the gate's date question, and the export.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/bundle.mjs';

const desk = await load('src/lib/desktop-client.ts');
const passphrase = await load('src/lib/passphrase.ts');
const exporter = await load('src/lib/memory-export.ts');
const item = { id: 'n1', kind: 'note', refId: '', text: '便签', x: .5, y: .5, rotation: 0, version: 1 };
const snapshot = (revision, items = [item]) => ({ revision, items, current: null });

describe('shared desk protocol', () => {
  test('one save at a time; the matching reply clears it', () => {
    let state = desk.beginDesktopPut(desk.emptyDesktopProtocol(), item, 'm1');
    assert.equal(desk.beginDesktopPut(state, item, 'm2'), state, 'a second save waits');
    assert.equal(desk.matchesPendingDesktopSave(state, { type: 'saved', mutationId: 'm1' }), true);
    state = desk.applyDesktopMessage(state, { type: 'saved', mutationId: 'm1', state: snapshot(2) });
    assert.equal(state.pending, null);
    assert.equal(state.status, 'saved');
  });

  test('older snapshots never overwrite newer ones', () => {
    const state = desk.applyDesktopMessage({ ...desk.emptyDesktopProtocol(), snapshot: snapshot(5) }, { type: 'snapshot', state: snapshot(3, []) });
    assert.equal(state.snapshot.revision, 5);
  });

  test('a conflict keeps my position so I can choose', () => {
    let state = desk.beginDesktopPut(desk.emptyDesktopProtocol(), { ...item, x: .9 }, 'm1');
    state = desk.applyDesktopMessage(state, { type: 'conflict', mutationId: 'm1', state: snapshot(4, [{ ...item, version: 3 }]) });
    assert.equal(state.conflicted.x, .9);
    const retry = desk.retryDesktopPosition(state, 'm2');
    assert.equal(retry.pending.version, 3, 'retries against the latest version');
    assert.equal(desk.adoptLatestDesktopPosition(state).conflicted, null);
  });

  test('a dropped connection turns an unconfirmed save into a choice', () => {
    const state = desk.desktopDisconnected(desk.beginDesktopPut(desk.emptyDesktopProtocol(), item, 'm1'));
    assert.equal(state.status, 'disconnected');
    assert.equal(state.conflicted.id, 'n1');
  });

  test('moves stay on the desk', () => {
    assert.deepEqual(desk.moveDesktopByArrow({ ...item, x: 0 }, 'ArrowLeft'), { ...item, x: 0 });
    assert.equal(desk.moveDesktopByArrow(item, 'Enter'), null);
    const dragged = desk.moveDesktopByDelta(item, 5000, -5000, 800, 600);
    assert.equal(dragged.x, 1);
    assert.equal(dragged.y, 0);
  });
});

describe('the gate question', () => {
  test('accepts the start date in its everyday forms only', async () => {
    for (const answer of ['0701', '07.01', '2026-07-01', '2026.07.01', '20260701', ' 0701 ']) assert.equal(await passphrase.verifyPassphrase(answer), true, answer);
    for (const answer of ['0702', '', '1007', '07-01x']) assert.equal(await passphrase.verifyPassphrase(answer), false, answer);
  });
});

describe('export', () => {
  test('exports only what the chosen signature can see, never photo or audio files', () => {
    const book = {
      member: { id: 'one', name: '男生' }, members: [{ id: 'one', name: '男生' }, { id: 'two', name: '女生' }],
      stories: [{ id: 's', version: 2, title: '看海', date: '2026-08-15', text: '正文', photoIds: ['a'.repeat(16)], wishIds: [], layout: 'album', revealTogether: false, openedAt: null, parts: [{ memberId: 'one', version: 1, submitted: true, text: '我的', reply: '', audioIds: ['x'] }] }],
      letters: [], places: [], wishPlans: [],
    };
    const result = exporter.buildMemoryExport(book, [{ id: 'w', text: '看海', done: true }], '2026-10-28T00:00:00.000Z');
    assert.equal(result.format, 'loveuhqq-visible-records');
    assert.equal(JSON.stringify(result).includes('photoIds'), false);
    assert.equal(JSON.stringify(result).includes('audioIds'), false);
    assert.throws(() => exporter.buildMemoryExport({ ...book, member: null }, [], ''));
  });
});
