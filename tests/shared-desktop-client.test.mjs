import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptLatestDesktopPosition,
  applyDesktopMessage,
  beginDesktopPut,
  desktopDisconnected,
  emptyDesktopProtocol,
  matchesPendingDesktopSave,
  moveDesktopByArrow,
  moveDesktopByDelta,
  retryDesktopPosition,
  shouldClearPendingDesktopNote,
} from '../src/lib/desktop-client.ts';

const item = { id: 'same-item', kind: 'note', refId: '', text: '合成便签', x: .2, y: .2, rotation: 0, version: 1 };
const snapshot = (revision, value = item) => ({ revision, items: [value], current: null });

test('unrelated saves do not acknowledge my move; conflict retry keeps my position against the latest version', () => {
  let protocol = beginDesktopPut(emptyDesktopProtocol(), { ...item, x: .23 }, 'my-first-move');
  const partnerItem = { ...item, x: .8, version: 2 };
  protocol = applyDesktopMessage(protocol, { type: 'saved', mutationId: 'other-members-operation', state: snapshot(2, partnerItem) });
  assert.equal(protocol.pendingMutationId, 'my-first-move');
  assert.equal(protocol.pending.x, .23);

  protocol = applyDesktopMessage(protocol, { type: 'conflict', mutationId: 'my-first-move', state: snapshot(2, partnerItem) });
  assert.equal(protocol.pending, null);
  assert.equal(protocol.conflicted.x, .23);
  const retry = retryDesktopPosition(protocol, 'my-retry');
  assert.equal(retry.pending.version, 2);
  assert.equal(retry.pending.x, .23);
  assert.equal(retry.pendingMutationId, 'my-retry');

  protocol = applyDesktopMessage(retry, { type: 'saved', mutationId: 'my-retry', state: snapshot(3, { ...retry.pending, version: 3 }) });
  assert.equal(protocol.pending, null);
  assert.equal(protocol.status, 'saved');
  assert.equal(adoptLatestDesktopPosition(protocol).conflicted, null);
});

test('only the current note save acknowledgement can clear its unchanged input', () => {
  let protocol = beginDesktopPut(emptyDesktopProtocol(), { ...item, text: '我的便签' }, 'my-note-save');
  const myAck = { type: 'saved', mutationId: 'my-note-save', state: snapshot(1) };
  const partnerAck = { type: 'saved', mutationId: 'partner-note-save', state: snapshot(2) };
  const noteDraft = { mutationId: 'my-note-save', value: '我的便签' };

  assert.equal(matchesPendingDesktopSave(protocol, partnerAck), false);
  assert.equal(shouldClearPendingDesktopNote(protocol, partnerAck, noteDraft, noteDraft.value), false);
  assert.equal(shouldClearPendingDesktopNote(protocol, myAck, noteDraft, '刚写的新便签'), false);
  assert.equal(shouldClearPendingDesktopNote(protocol, myAck, noteDraft, noteDraft.value), true);

  protocol = applyDesktopMessage(protocol, myAck);
  assert.equal(matchesPendingDesktopSave(protocol, partnerAck), false);
  assert.equal(protocol.status, 'saved');
});

test('a lost acknowledgement is recoverable after reconnect with the latest server version', () => {
  let protocol = beginDesktopPut(emptyDesktopProtocol(), { ...item, y: .26 }, 'unconfirmed-move');
  protocol = desktopDisconnected(protocol);
  assert.equal(protocol.pending, null);
  assert.equal(protocol.conflicted.y, .26);
  assert.equal(protocol.status, 'disconnected');

  const recovered = { ...item, x: .7, version: 4 };
  protocol = applyDesktopMessage(protocol, { type: 'snapshot', state: snapshot(4, recovered) });
  const retry = retryDesktopPosition(protocol, 'reconnected-retry');
  assert.equal(retry.pending.version, 4);
  assert.equal(retry.pending.y, .26);
  assert.equal(retry.pendingMutationId, 'reconnected-retry');
});

test('desktop movement clamps normalized pointer coordinates and keeps keyboard nudges at three percent', () => {
  assert.deepEqual(moveDesktopByDelta(item, 10_000, -10_000, 600, 400), { ...item, x: 1, y: 0 });
  assert.deepEqual(moveDesktopByArrow(item, 'ArrowRight'), { ...item, x: .23 });
  assert.deepEqual(moveDesktopByArrow(item, 'ArrowDown'), { ...item, y: .23 });
  assert.equal(moveDesktopByArrow(item, 'Enter'), null);
});
