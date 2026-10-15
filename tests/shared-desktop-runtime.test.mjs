import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://desktop.example';
const sharedPassword = 'synthetic-desktop-shared-password';
const salt = '00112233445566778899aabbccddeeff';
const credential = `pbkdf2$100000$${salt}$${pbkdf2Sync(sharedPassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`;

function inbox(ws) {
  const messages = [], waiters = new Set();
  let closed = null;
  const closedWaiters = new Set();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data); messages.push(message);
    for (const waiter of [...waiters]) if (messages.length > waiter.after && waiter.predicate(message)) {
      waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(message);
    }
  });
  ws.addEventListener('close', event => {
    closed = { code: event.code, reason: event.reason };
    for (const waiter of closedWaiters) { clearTimeout(waiter.timer); waiter.resolve(closed); }
    closedWaiters.clear();
  });
  ws.accept();
  return { ws, messages,
    wait(predicate, after = 0) {
      const found = messages.slice(after).find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, after, resolve, timer: setTimeout(() => { waiters.delete(waiter); reject(new Error('Desktop message timed out')); }, 6000) };
        waiters.add(waiter);
      });
    },
    waitClosed() {
      if (closed) return Promise.resolve(closed);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, timer: setTimeout(() => { closedWaiters.delete(waiter); reject(new Error('Revoked desktop socket did not close')); }, 6000) };
        closedWaiters.add(waiter);
      });
    },
    dispose() { for (const waiter of waiters) clearTimeout(waiter.timer); for (const waiter of closedWaiters) clearTimeout(waiter.timer); try { ws.close(1000); } catch { /* Already closed. */ } },
  };
}
const note = (id, text = id, extra = {}) => ({ id, kind: 'note', refId: '', text, x: 0.3, y: 0.4, rotation: 0, version: 0, ...extra });
const put = (socket, item, mutationId, expectedVersion = 0) => socket.ws.send(JSON.stringify({ type: 'put', item, mutationId, expectedVersion }));

test('real shared desktop WebSockets persist, coordinate CAS, reconnect and revoke broadcast access', { timeout: 45000 }, async () => {
  const built = await build({ entryPoints: [fileURLToPath(new URL('../worker/runtime.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-09-12', d1Databases: ['DB'], kvNamespaces: ['PHOTOS'],
    durableObjects: { SHARED_DESKTOP: { className: 'SharedDesktop', useSQLite: true } },
    bindings: { EDITOR_PASSWORD_HASH: credential }, serviceBindings: { ASSETS: async () => new Response('asset') } }));
  const sockets = [];
  try {
    const db = await mf.getD1Database('DB');
    for (const file of ['0001_cloud_notebook.sql', '0002_photo_manifest.sql', '0003_shared_memory_book.sql', '0004_optional_place_coordinates.sql']) {
      const migration = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
    }
    const cookies = {};
    const request = (path, method = 'GET', value, who, headers = {}) => mf.dispatchFetch(origin + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(who ? { Cookie: cookies[who] } : {}), ...headers },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    for (const id of ['one', 'two']) {
      const shared = await request('/api/session', 'POST', { password: sharedPassword, remember: false });
      assert.equal(shared.status, 200); cookies[id] = shared.headers.get('Set-Cookie').split(';')[0];
      const personal = await request('/api/memory/identity', 'POST', { id }, id);
      assert.equal(personal.status, 200); cookies[id] += `; ${personal.headers.get('Set-Cookie').split(';')[0]}`;
    }
    assert.equal((await request('/api/memory/desktop', 'GET', undefined, undefined, { Upgrade: 'websocket' })).status, 401);
    assert.equal((await request('/api/memory/desktop', 'GET', undefined, 'one', { Upgrade: 'websocket', Origin: 'https://forged.example' })).status, 403);
    assert.equal((await request('/api/memory/desktop', 'GET', undefined, 'one', { Upgrade: 'websocket', Origin: '' })).status, 403);
    const connect = async who => {
      const response = await request('/api/memory/desktop', 'GET', undefined, who, { Upgrade: 'websocket' });
      assert.equal(response.status, 101); assert.ok(response.webSocket);
      const socket = inbox(response.webSocket); sockets.push(socket); return socket;
    };
    const one = await connect('one'), two = await connect('two');
    assert.deepEqual((await one.wait(message => message.type === 'snapshot')).state, { revision: 0, items: [], current: null });
    assert.equal((await two.wait(message => message.type === 'snapshot')).state.revision, 0);

    put(one, note('first-note', 'saved together'), 'first-save');
    const ack = await one.wait(message => message.type === 'saved' && message.mutationId === 'first-save');
    const broadcast = await two.wait(message => message.type === 'saved' && message.mutationId === 'first-save');
    assert.equal(ack.state.items[0].version, 1); assert.deepEqual(broadcast.state, ack.state);

    // Item-level versions permit simultaneous operations on different objects.
    put(one, note('one-note'), 'parallel-one'); put(two, note('two-note'), 'parallel-two');
    await Promise.all([one.wait(message => message.type === 'saved' && message.mutationId === 'parallel-one'), two.wait(message => message.type === 'saved' && message.mutationId === 'parallel-two')]);
    const cursor = two.messages.length; two.ws.send(JSON.stringify({ type: 'sync' }));
    const synced = await two.wait(message => message.type === 'snapshot', cursor);
    assert.deepEqual(synced.state.items.map(item => item.id).sort(), ['first-note', 'one-note', 'two-note']);

    // Same-object writes with the same expected version have exactly one winner.
    const cursorOne = one.messages.length, cursorTwo = two.messages.length;
    put(one, note('first-note', 'writer one'), 'race-one', 1); put(two, note('first-note', 'writer two'), 'race-two', 1);
    const [outcomeOne, outcomeTwo] = await Promise.all([
      one.wait(message => ['saved', 'conflict'].includes(message.type) && message.mutationId === 'race-one', cursorOne),
      two.wait(message => ['saved', 'conflict'].includes(message.type) && message.mutationId === 'race-two', cursorTwo),
    ]);
    assert.deepEqual([outcomeOne.type, outcomeTwo.type].sort(), ['conflict', 'saved']);
    const winner = outcomeOne.type === 'saved' ? outcomeOne : outcomeTwo;
    assert.equal(winner.state.items.find(item => item.id === 'first-note').version, 2);

    one.ws.close(1000); await one.waitClosed();
    const reopened = await connect('one');
    const recovered = await reopened.wait(message => message.type === 'snapshot');
    assert.deepEqual(recovered.state, winner.state);
    const beforeSync = reopened.messages.length; reopened.ws.send(JSON.stringify({ type: 'sync' }));
    assert.deepEqual((await reopened.wait(message => message.type === 'snapshot', beforeSync)).state, winner.state);

    // Revoke one parent over HTTP, then ensure a partner broadcast closes it before private data is sent.
    assert.equal((await request('/api/session', 'DELETE', undefined, 'one')).status, 200);
    const beforeRevoke = reopened.messages.length;
    const closed = reopened.waitClosed();
    put(two, note('after-revoke', 'SYNTHETIC_POST_REVOCATION_CONTENT'), 'after-revoke');
    await two.wait(message => message.type === 'saved' && message.mutationId === 'after-revoke');
    assert.equal((await closed).code, 4401);
    assert.equal(JSON.stringify(reopened.messages.slice(beforeRevoke)).includes('SYNTHETIC_POST_REVOCATION_CONTENT'), false);
    assert.equal((await request('/api/memory/desktop', 'GET', undefined, 'one', { Upgrade: 'websocket' })).status, 401);
    const finalCursor = two.messages.length; two.ws.send(JSON.stringify({ type: 'sync' }));
    assert.ok((await two.wait(message => message.type === 'snapshot', finalCursor)).state.items.some(item => item.id === 'after-revoke'));
  } finally { for (const socket of sockets) socket.dispose(); await mf.dispose(); }
});
