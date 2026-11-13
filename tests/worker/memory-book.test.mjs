// The shared memory book: who can read what, and when.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { origin, startWorker } from '../helpers/worker.mjs';

let env;
let him;
let her;
before(async () => {
  env = await startWorker();
  him = env.client(); her = env.client();
  await him.login(env.password); await her.login(env.password);
  await him.as('one'); await her.as('two');
});
after(async () => { await env.mf.dispose(); });

const story = (overrides = {}) => ({ expectedVersion: 0, title: '一起看海', date: '2026-08-15', text: '共同的正文', photoIds: [], wishIds: [], layout: 'journal', revealTogether: false, ...overrides });
const letter = (overrides = {}) => ({ expectedVersion: 0, title: '写给以后', text: '只给收信人', recipientId: 'two', openDate: '2099-01-01', pairKey: '', audioIds: [], ...overrides });

describe('identity', () => {
  test('the book needs the shared session first, then a chosen signature', async () => {
    assert.equal((await env.client().call('/api/memory/bootstrap')).status, 401);
    const reader = env.client();
    await reader.login(env.password);
    const book = await reader.call('/api/memory/bootstrap');
    assert.equal(book.status, 200);
    assert.equal(book.json.member, null);
    assert.equal((await reader.call('/api/memory/stories/s-x', { method: 'PUT', body: story() })).status, 403);
  });

  test('only 男生 and 女生 can be chosen, and the choice is remembered', async () => {
    const reader = env.client();
    await reader.login(env.password);
    assert.equal((await reader.as('three')).status, 400);
    const chosen = await reader.as('two');
    assert.deepEqual(chosen.json.member, { id: 'two', name: '女生' });
    assert.deepEqual((await reader.call('/api/memory/bootstrap')).json.member, { id: 'two', name: '女生' });
  });

  test('signing out of the journal also ends the signature', async () => {
    const reader = env.client();
    await reader.login(env.password);
    await reader.as('one');
    const cookies = reader.cookie();
    await reader.call('/api/session', { method: 'DELETE' });
    const replay = await env.mf.dispatchFetch(`${origin}/api/memory/bootstrap`, { headers: { Cookie: cookies } });
    assert.equal(replay.status, 401);
  });
});

describe('stories', () => {
  test('save with versions and refuse stale edits', async () => {
    const saved = await him.call('/api/memory/stories/s-sea', { method: 'PUT', body: story() });
    assert.equal(saved.status, 200);
    const entry = saved.json.stories.find(item => item.id === 's-sea');
    assert.equal(entry.version, 1);
    assert.equal((await her.call('/api/memory/stories/s-sea', { method: 'PUT', body: story({ title: '迟到的改动' }) })).status, 409);
    const edited = await her.call('/api/memory/stories/s-sea', { method: 'PUT', body: story({ expectedVersion: 1, title: '看海' }) });
    assert.equal(edited.json.stories.find(item => item.id === 's-sea').title, '看海');
  });

  test('photos and wishes must exist before a story can point at them', async () => {
    assert.equal((await him.call('/api/memory/stories/s-bad', { method: 'PUT', body: story({ photoIds: ['ffffffffffffffff'] }) })).status, 400);
  });

  test('with reveal-together, neither version shows until both are submitted', async () => {
    await him.call('/api/memory/stories/s-both', { method: 'PUT', body: story({ revealTogether: true }) });
    await him.call('/api/memory/stories/s-both/part', { method: 'PUT', body: { expectedVersion: 0, text: '他记得的', reply: '', submitted: true, audioIds: [] } });
    const herView = (await her.call('/api/memory/bootstrap')).json.stories.find(item => item.id === 's-both');
    const hisPartForHer = herView.parts.find(part => part.memberId === 'one');
    assert.equal(hisPartForHer.submitted, true);
    assert.equal(hisPartForHer.text, undefined, 'his words stay sealed while hers are missing');
    await her.call('/api/memory/stories/s-both/part', { method: 'PUT', body: { expectedVersion: 0, text: '她记得的', reply: '', submitted: true, audioIds: [] } });
    const opened = (await her.call('/api/memory/bootstrap')).json.stories.find(item => item.id === 's-both');
    assert.ok(opened.openedAt);
    assert.equal(opened.parts.find(part => part.memberId === 'one').text, '他记得的');
  });

  test('the reveal mode cannot be switched off once someone has written', async () => {
    const current = (await him.call('/api/memory/bootstrap')).json.stories.find(item => item.id === 's-both');
    const flipped = await him.call('/api/memory/stories/s-both', { method: 'PUT', body: story({ expectedVersion: current.version, revealTogether: false }) });
    assert.equal(flipped.status, 409);
  });
});

describe('the post office', () => {
  test('a draft is visible only to the sender', async () => {
    await him.call('/api/memory/letters/l-draft', { method: 'PUT', body: letter() });
    const forHer = (await her.call('/api/memory/bootstrap')).json.letters.find(item => item.id === 'l-draft');
    assert.ok(!forHer || forHer.text === undefined);
    const forHim = (await him.call('/api/memory/bootstrap')).json.letters.find(item => item.id === 'l-draft');
    assert.equal(forHim.text, '只给收信人');
  });

  test('a sealed letter waits for its date, and cannot be edited', async () => {
    await him.call('/api/memory/letters/l-later', { method: 'PUT', body: letter() });
    const sealed = await him.call('/api/memory/letters/l-later/seal', { method: 'POST', body: { expectedVersion: 1 } });
    assert.equal(sealed.status, 200);
    const forHer = (await her.call('/api/memory/bootstrap')).json.letters.find(item => item.id === 'l-later');
    assert.equal(forHer.status, 'sealed');
    assert.equal(forHer.readable, false);
    assert.equal(forHer.text, undefined);
    const edit = await him.call('/api/memory/letters/l-later', { method: 'PUT', body: letter({ expectedVersion: 2, text: '改正文' }) });
    assert.notEqual(edit.status, 200);
  });

  test('a letter whose day has come opens for its recipient', async () => {
    await him.call('/api/memory/letters/l-now', { method: 'PUT', body: letter({ openDate: '2026-07-01' }) });
    await him.call('/api/memory/letters/l-now/seal', { method: 'POST', body: { expectedVersion: 1 } });
    const forHer = (await her.call('/api/memory/letters/l-now')).json;
    assert.equal(forHer.readable, true);
    assert.equal(forHer.text, '只给收信人');
  });

  test('a sealed letter can be withdrawn back to a draft before it opens', async () => {
    const before = (await him.call('/api/memory/bootstrap')).json.letters.find(item => item.id === 'l-later');
    const withdrawn = await him.call('/api/memory/letters/l-later/withdraw', { method: 'POST', body: { expectedVersion: before.version } });
    assert.equal(withdrawn.json.letters.find(item => item.id === 'l-later').status, 'draft');
  });
});

describe('places and plans', () => {
  test('a place needs only a name and a year; coordinates are optional', async () => {
    const saved = await him.call('/api/memory/places/p-cafe', { method: 'PUT', body: { expectedVersion: 0, name: '街角', lat: null, lng: null, year: 2026, storyIds: [], wishIds: [] } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.places.find(place => place.id === 'p-cafe').lat, null);
    const outOfRange = await him.call('/api/memory/places/p-far', { method: 'PUT', body: { expectedVersion: 0, name: '远方', lat: 120, lng: 0, year: 2026, storyIds: [], wishIds: [] } });
    assert.equal(outOfRange.status, 400);
  });

  test('editing a place retains every selected story and its historical wish links', async () => {
    for (const id of ['p-wish-one', 'p-wish-two']) {
      assert.equal((await him.call(`/api/wishes/${id}`, { method: 'PUT', body: { expectedVersion: 0, text: id, done: false } })).status, 200);
    }
    const path = '/api/memory/places/p-linked';
    const input = { expectedVersion: 0, name: '测试地点', lat: null, lng: null, year: 2026, storyIds: ['s-sea', 's-both'], wishIds: ['p-wish-one', 'p-wish-two'] };
    assert.equal((await him.call(path, { method: 'PUT', body: input })).status, 200);
    assert.equal((await her.call('/api/wishes/p-wish-two', { method: 'DELETE', body: { expectedVersion: 1 } })).status, 200);
    const changed = await her.call(path, { method: 'PUT', body: { ...input, expectedVersion: 1, name: '地点改名' } });
    assert.equal(changed.status, 200);
    const saved = changed.json.places.find(place => place.id === 'p-linked');
    assert.deepEqual(saved.storyIds, input.storyIds);
    assert.deepEqual(saved.wishIds, input.wishIds);
    assert.equal((await her.call('/api/memory/places/p-another', { method: 'PUT', body: input })).status, 400);
  });

  test('both versions must match before a wish and its plan are updated', async () => {
    const wish = '/api/wishes/w-atomic';
    const plan = '/api/memory/wishPlans/w-atomic';
    assert.equal((await him.call(wish, { method: 'PUT', body: { expectedVersion: 0, text: '测试愿望', done: false } })).status, 200);
    const input = { expectedVersion: 0, expectedWishVersion: 1, done: true, plannedDate: '2026-11-20', storyId: 's-sea' };
    assert.equal((await him.call(plan, { method: 'PUT', body: { ...input, expectedWishVersion: 0 } })).status, 409);
    const before = (await him.call('/api/memory/bootstrap')).json;
    assert.equal(before.wishes.find(item => item.id === 'w-atomic').done, false);
    assert.equal(before.wishPlans.some(item => item.id === 'w-atomic'), false);
    const outcomes = await Promise.all([
      him.call(plan, { method: 'PUT', body: input }),
      her.call(plan, { method: 'PUT', body: { ...input, plannedDate: '2026-11-21' } }),
    ]);
    assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
    const accepted = outcomes.find(result => result.status === 200).json;
    assert.equal(accepted.wishes.find(item => item.id === 'w-atomic').done, true);
    assert.equal(accepted.wishRevisions['w-atomic'], 2);
    const arrangement = accepted.wishPlans.find(item => item.id === 'w-atomic');
    assert.equal(arrangement.version, 1);
    assert.equal((await him.call(plan, { method: 'PUT', body: { ...input, expectedWishVersion: 2, done: false } })).status, 409);
    const after = (await him.call('/api/memory/bootstrap')).json;
    assert.deepEqual(after.wishPlans.find(item => item.id === 'w-atomic'), arrangement);
    assert.equal(after.wishes.find(item => item.id === 'w-atomic').done, true);
    const legacy = await him.call(plan, { method: 'PUT', body: { expectedVersion: 1, plannedDate: null, storyId: null } });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.json.wishRevisions['w-atomic'], 2);
  });
});

test('sync sends only the snapshots that changed, with a fresh projection after a Beijing date change', async () => {
  assert.equal((await env.client().call('/api/memory/sync')).status, 401);
  const path = '/api/memory/sync';
  const initial = (await him.call(path)).json;
  assert.equal(initial.memberId, 'one');
  assert.ok(initial.book.stories.some(item => item.id === 's-sea'));
  assert.ok(Array.isArray(initial.album.photos));
  const params = new URLSearchParams({ member: initial.memberId, revision: String(initial.revision), day: initial.day, photos: String(initial.photoRevision) });
  const steady = (await him.call(`${path}?${params}`)).json;
  assert.deepEqual(steady, { memberId: initial.memberId, revision: initial.revision, day: initial.day, photoRevision: initial.photoRevision });
  assert.equal((await her.call('/api/wishes/w-sync', { method: 'PUT', body: { expectedVersion: 0, text: '同步测试', done: false } })).status, 200);
  const updated = (await him.call(`${path}?${params}`)).json;
  assert.ok(updated.book.wishes.some(wish => wish.id === 'w-sync'));
  assert.equal(updated.album, undefined);
  params.set('revision', String(updated.revision));
  params.set('day', '2000-01-01');
  const nextDay = (await him.call(`${path}?${params}`)).json;
  assert.equal(nextDay.book.day, initial.day);
  params.set('day', nextDay.day);
  await env.db.prepare(`INSERT INTO album_photos (id, object_id, title, width, height)
    VALUES ('1a1a1a1a1a1a1a1a', 'fixture', '相册同步测试', 1, 1)`).run();
  const albumOnly = (await him.call(`${path}?${params}`)).json;
  assert.equal(albumOnly.book, undefined);
  assert.equal(albumOnly.album.photos[0].id, '1a1a1a1a1a1a1a1a');
  const other = (await her.call(`${path}?${params}`)).json;
  assert.equal(other.book.member.id, 'two');
  assert.ok(!other.book.letters.some(item => item.id === 'l-draft'));
});

test('audio cleanup reclaims expired or explicitly discarded drafts and retains both kinds of attached audio', async () => {
  const wav = new TextEncoder().encode('RIFF0000WAVEfixture');
  const upload = async query => {
    const result = await him.call(`/api/memory/audio?${query}`, { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav', 'X-Audio-Duration': '1' } });
    assert.equal(result.status, 201);
    return result.json.id;
  };
  const path = id => `/api/memory/audio/${id}`;
  const expired = await upload('storyId=s-sea');
  const discarded = await upload('storyId=s-sea');
  const fresh = await upload('storyId=s-sea');
  const attached = await upload('storyId=s-sea');
  const mailed = await upload('letterId=l-draft');
  assert.equal((await him.call('/api/memory/stories/s-sea/part', { method: 'PUT', body: { expectedVersion: 0, text: '', reply: '', submitted: false, audioIds: [attached] } })).status, 200);
  assert.equal((await him.call('/api/memory/letters/l-draft', { method: 'PUT', body: letter({ expectedVersion: 1, audioIds: [mailed] }) })).status, 200);
  assert.equal((await her.call(path(discarded), { method: 'DELETE' })).status, 404);
  assert.equal((await him.call(path(discarded), { method: 'DELETE' })).status, 200);
  assert.equal((await him.call(path(attached), { method: 'DELETE' })).status, 409);
  await env.db.prepare('UPDATE memory_audio SET created_at = 1 WHERE id IN (?, ?, ?)').bind(expired, attached, mailed).run();
  const worker = await env.mf.getWorker();
  assert.equal((await worker.scheduled({ cron: '0 * * * *' })).outcome, 'ok');
  const kv = await env.mf.getKVNamespace('PHOTOS');
  assert.equal(await kv.get(`audio/${expired}`), null);
  assert.equal(await kv.get(`audio/${discarded}`), null);
  assert.equal((await him.call(path(expired))).status, 404);
  assert.equal((await him.call(path(fresh))).status, 200);
  assert.equal((await him.call(path(attached))).status, 200);
  assert.equal((await him.call(path(mailed))).status, 200);
  assert.equal((await her.call(path(mailed))).status, 404);
});

describe('the shared desk', () => {
  const connect = async who => {
    const response = await env.mf.dispatchFetch(`${origin}/api/memory/desktop`, { headers: { Upgrade: 'websocket', Origin: origin, Cookie: who.cookie() } });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    const inbox = [];
    const waiters = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const waiter = waiters.findIndex(item => item.match(message));
      if (waiter >= 0) waiters.splice(waiter, 1)[0].resolve(message); else inbox.push(message);
    });
    socket.accept();
    const next = match => {
      const found = inbox.findIndex(match);
      if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0]);
      return new Promise((resolve, reject) => { waiters.push({ match, resolve }); setTimeout(() => reject(new Error('no message')), 4000); });
    };
    return { socket, next };
  };

  test('needs a session, a signature and the same origin', async () => {
    const visitor = await env.mf.dispatchFetch(`${origin}/api/memory/desktop`, { headers: { Upgrade: 'websocket', Origin: origin } });
    assert.equal(visitor.status, 401);
    const forged = await env.mf.dispatchFetch(`${origin}/api/memory/desktop`, { headers: { Upgrade: 'websocket', Origin: 'https://elsewhere.test', Cookie: him.cookie() } });
    assert.equal(forged.status, 403);
  });

  test('a move is saved for both, and a stale move is a conflict', async () => {
    const mine = await connect(him);
    const theirs = await connect(her);
    await mine.next(message => message.type === 'snapshot');
    await theirs.next(message => message.type === 'snapshot');
    const item = { id: 'desk-note', kind: 'note', refId: '', text: '便签', x: .2, y: .2, rotation: 0, version: 0 };
    mine.socket.send(JSON.stringify({ type: 'put', item, expectedVersion: 0, mutationId: 'm1' }));
    const saved = await mine.next(message => message.type === 'saved' && message.mutationId === 'm1');
    assert.equal(saved.state.items.find(entry => entry.id === 'desk-note').text, '便签');
    const seen = await theirs.next(message => message.type === 'saved');
    assert.ok(seen.state.items.some(entry => entry.id === 'desk-note'), 'the other side sees it too');
    theirs.socket.send(JSON.stringify({ type: 'put', item: { ...item, x: .9 }, expectedVersion: 0, mutationId: 'm2' }));
    const conflict = await theirs.next(message => message.type === 'conflict');
    assert.equal(conflict.mutationId, 'm2');
    mine.socket.close(); theirs.socket.close();
  });

  test('either signer can take down an item and the removing signer can undo it after reconnecting', async () => {
    const mine = await connect(him);
    let theirs = await connect(her);
    const send = (client, message) => client.socket.send(JSON.stringify(message));
    const snapshot = await mine.next(message => message.type === 'snapshot');
    const note = snapshot.state.items.find(item => item.id === 'desk-note');
    assert.ok(note);
    const remove = { type: 'remove', itemId: note.id, mutationId: 'remove-one' };
    send(theirs, { ...remove, expectedVersion: note.version - 1 });
    assert.equal((await theirs.next(message => message.type === 'conflict')).mutationId, 'remove-one');
    send(theirs, { ...remove, expectedVersion: note.version, mutationId: 'remove-two' });
    const removed = await theirs.next(message => message.type === 'removed');
    assert.ok(removed.undo.undoUntil > Date.now());
    const other = await mine.next(message => message.type === 'removed');
    assert.equal(other.undo, null);
    assert.ok(!other.state.items.some(item => item.id === note.id));
    send(mine, { type: 'put', item: note, expectedVersion: note.version, mutationId: 'stale-move' });
    assert.equal((await mine.next(message => message.type === 'conflict')).mutationId, 'stale-move');
    const restore = { type: 'restore', itemId: note.id, expectedVersion: removed.undo.version, mutationId: 'undo-one' };
    send(mine, restore);
    assert.equal((await mine.next(message => message.type === 'conflict')).mutationId, 'undo-one');
    theirs.socket.close();
    theirs = await connect(her);
    assert.deepEqual((await theirs.next(message => message.type === 'snapshot')).undo, removed.undo);
    send(theirs, restore);
    const restored = await mine.next(message => message.type === 'restored');
    assert.deepEqual(restored.state.items.find(item => item.id === note.id), { ...note, version: note.version + 2 });
    assert.equal((await theirs.next(message => message.type === 'restored')).undo, null);
    mine.socket.close(); theirs.socket.close();
  });
});
