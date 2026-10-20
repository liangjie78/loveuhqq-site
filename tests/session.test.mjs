import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let moduleId = 0;
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/session.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
});

async function fixture(t) {
  const previous = { fetch: globalThis.fetch };
  const requests = [];
  const published = [];
  globalThis.fetch = () => new Promise((resolve, reject) => requests.push({
    respond(state) { resolve(Response.json(state)); },
    fail() { reject(new TypeError('Network unavailable')); },
  }));
  t.after(() => {
    globalThis.fetch = previous.fetch;
  });
  // Each case imports the real bundled module with independent module state.
  const source = `${bundled.outputFiles[0].text}\n// fixture ${moduleId++}`;
  const session = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  session.onSessionChange(state => published.push(state));
  return { session, requests, published };
}

const loggedIn = { authenticated: true, configured: true };
const loggedOut = { authenticated: false, configured: true };

test('an initial session response arriving after logout cannot revive authentication', async t => {
  const { session, requests, published } = await fixture(t);
  const initial = session.getSession();
  session.publishSession(loggedOut);
  requests[0].respond(loggedIn);
  assert.deepEqual(await initial, loggedOut);
  assert.deepEqual(await session.getSession(), loggedOut);
  assert.deepEqual(published, [loggedOut]);
});

test('a newer refresh wins when session requests resolve out of order', async t => {
  const { session, requests, published } = await fixture(t);
  const older = session.getSession();
  const newer = session.refreshSession();
  requests[1].respond(loggedOut);
  assert.deepEqual(await newer, loggedOut);
  requests[0].respond(loggedIn);
  assert.deepEqual(await older, loggedOut);
  assert.deepEqual(await session.getSession(), loggedOut);
  assert.deepEqual(published, [loggedOut]);
});

test('a failed stale request cannot erase a successful login or reject the current state', async t => {
  const { session, requests, published } = await fixture(t);
  const initial = session.getSession();
  session.publishSession(loggedIn);
  requests[0].fail();
  assert.deepEqual(await initial, loggedIn);
  assert.deepEqual(await session.getSession(), loggedIn);
  assert.equal(requests.length, 1);
  assert.deepEqual(published, [loggedIn]);
});

test('a current network failure leaves the session retryable without publishing authentication', async t => {
  const { session, requests, published } = await fixture(t);
  const initial = session.getSession();
  requests[0].fail();
  await assert.rejects(initial, /Network unavailable/);
  const retry = session.getSession();
  assert.equal(requests.length, 2);
  requests[1].respond(loggedOut);
  assert.deepEqual(await retry, loggedOut);
  assert.deepEqual(published, [loggedOut]);
});

test('a late session subscriber receives current logout state instead of a cached login snapshot', async t => {
  const { session } = await fixture(t);
  session.publishSession(loggedIn);
  const oldSnapshot = session.getSession();
  session.publishSession(loggedOut);
  const received = [];
  session.onSessionChange(state => received.push(state));
  assert.deepEqual(await oldSnapshot, loggedIn);
  assert.deepEqual(received, [loggedOut]);
  session.publishSession(loggedIn);
  assert.deepEqual(received, [loggedOut, loggedIn]);
});

test('a subscriber added before the initial response sees only real published state', async t => {
  const { session, requests } = await fixture(t);
  const received = [];
  session.onSessionChange(state => received.push(state));
  assert.deepEqual(received, []);
  const initial = session.getSession();
  requests[0].respond(loggedIn);
  await initial;
  assert.deepEqual(received, [loggedIn]);
});
