import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const bundled = await build({
  stdin: {
    contents: `${await readFile(new URL('../src/lib/member.ts', import.meta.url), 'utf8')}\nexport { memberStore, sessionStore };`,
    resolveDir: fileURLToPath(new URL('../src/lib/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
});

let fixtureId = 0;
async function fixture(t) {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (_path, options) => new Promise((resolve, reject) => requests.push({
    options,
    respond(memberId) {
      resolve(Response.json({ member: { id: memberId }, members: [], stories: [], letters: [], places: [], wishPlans: [] }));
    },
    fail(error = new Error('request failed')) { reject(error); },
  }));
  t.after(() => { globalThis.fetch = previousFetch; });
  const source = `${bundled.outputFiles[0].text}\n// fixture ${fixtureId++}`;
  const member = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  member.sessionStore.setState({ authenticated: true });
  return { member, requests };
}

test('the latest identity choice wins when responses resolve out of order', async t => {
  const { member, requests } = await fixture(t);
  const older = member.selectMember('one');
  const newer = member.selectMember('two');
  assert.equal(requests.length, 2);

  requests[1].respond('two');
  assert.equal((await newer).member.id, 'two');
  requests[0].respond('one');
  assert.equal(await older, null);
  assert.equal(member.memberStore.getState().memberId, 'two');
});

test('a late identity response after logout cannot restore the selected member', async t => {
  const { member, requests } = await fixture(t);
  const pending = member.selectMember('one');
  member.sessionStore.setState({ authenticated: false });
  requests[0].respond('one');

  assert.equal(await pending, null);
  assert.equal(member.memberStore.getState().memberId, null);
});

test('a stale bootstrap cannot overwrite an identity request started later', async t => {
  const { member, requests } = await fixture(t);
  const bootstrapGeneration = member.beginMemberRequest();
  const choice = member.selectMember('two');
  requests[0].respond('two');
  assert.equal((await choice).member.id, 'two');

  assert.equal(member.setCurrentMember('one', bootstrapGeneration), false);
  assert.equal(member.memberStore.getState().memberId, 'two');
});
