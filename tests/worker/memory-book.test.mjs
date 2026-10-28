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
});
