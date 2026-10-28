// The journal's private API, exercised against the real Worker runtime.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { origin, startWorker } from '../helpers/worker.mjs';

let env;
before(async () => { env = await startWorker(); });
after(async () => { await env.mf.dispose(); });

describe('session', () => {
  test('reports whether the journal is configured before anyone signs in', async () => {
    const guest = env.client();
    const state = await guest.call('/api/session');
    assert.deepEqual(state.json, { authenticated: false, configured: true });
  });

  test('a wrong password is refused and sets no cookie', async () => {
    const guest = env.client();
    const result = await guest.login('not-the-password');
    assert.equal(result.status, 401);
    assert.equal(guest.jar.size, 0);
  });

  test('signing in issues a strict, http-only session that private routes accept', async () => {
    const reader = env.client();
    const result = await reader.login(env.password);
    assert.equal(result.status, 200);
    const setCookie = result.headers.get('Set-Cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.equal((await reader.call('/api/notebook')).status, 200);
  });

  test('signing out revokes the session on the server, not just in the browser', async () => {
    const reader = env.client();
    await reader.login(env.password);
    const stolen = reader.cookie();
    assert.equal((await reader.call('/api/session', { method: 'DELETE' })).status, 200);
    const replay = await env.mf.dispatchFetch(`${origin}/api/notebook`, { headers: { Cookie: stolen } });
    assert.equal(replay.status, 401);
  });

  test('writes from another origin are rejected before any work is done', async () => {
    const reader = env.client();
    await reader.login(env.password);
    const forged = await reader.call('/api/notes/2026-07-02', { method: 'PUT', body: { expectedVersion: 0, text: 'x' }, headers: { Origin: 'https://elsewhere.test' } });
    assert.equal(forged.status, 403);
  });

  test('unknown API paths and wrong methods answer plainly', async () => {
    const guest = env.client();
    assert.equal((await guest.call('/api/nothing-here')).status, 404);
    assert.equal((await guest.call('/api/letter', { method: 'POST', body: {} })).status, 405);
  });

  test('an unconfigured journal says so instead of failing open', async () => {
    const bare = await startWorker({ configured: false });
    try {
      const guest = bare.client();
      assert.deepEqual((await guest.call('/api/session')).json, { authenticated: false, configured: false });
      assert.equal((await guest.login('anything')).status, 503);
    } finally { await bare.mf.dispose(); }
  });

  test('repeated wrong passwords are slowed down', async () => {
    const limited = await startWorker();
    try {
      const guest = limited.client();
      const statuses = [];
      for (let attempt = 0; attempt < 11; attempt++) statuses.push((await guest.login('wrong')).status);
      assert.equal(statuses.at(-1), 429);
      assert.equal((await guest.login(limited.password)).status, 429, 'even the right password waits out the window');
    } finally { await limited.mf.dispose(); }
  });
});

describe('notebook', () => {
  test('private notes are never served to visitors', async () => {
    assert.equal((await env.client().call('/api/notebook')).status, 401);
  });

  test('notes save with revisions, refuse stale writes and leave tombstones', async () => {
    const reader = env.client();
    await reader.login(env.password);
    const first = await reader.call('/api/notes/2026-08-01', { method: 'PUT', body: { expectedVersion: 0, text: '第一句' } });
    assert.equal(first.status, 200);
    assert.equal(first.json.notes['2026-08-01'], '第一句');
    assert.equal(first.json.revisions.notes['2026-08-01'], 1);
    const stale = await reader.call('/api/notes/2026-08-01', { method: 'PUT', body: { expectedVersion: 0, text: '旧草稿' } });
    assert.equal(stale.status, 409);
    const removed = await reader.call('/api/notes/2026-08-01', { method: 'DELETE', body: { expectedVersion: 1 } });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.notes['2026-08-01'], undefined);
    assert.equal(removed.json.revisions.notes['2026-08-01'], 2, 'the revision survives so other tabs see the removal');
    const undo = await reader.call('/api/notes/2026-08-01', { method: 'PUT', body: { expectedVersion: 2, text: '第一句' } });
    assert.equal(undo.json.revisions.notes['2026-08-01'], 3);
  });

  test('bad dates, empty text and unknown fields are rejected', async () => {
    const reader = env.client();
    await reader.login(env.password);
    assert.equal((await reader.call('/api/notes/2026-02-30', { method: 'PUT', body: { expectedVersion: 0, text: 'x' } })).status, 400);
    assert.equal((await reader.call('/api/notes/2026-08-02', { method: 'PUT', body: { expectedVersion: 0, text: '   ' } })).status, 400);
    assert.equal((await reader.call('/api/notes/2026-08-02', { method: 'PUT', body: { expectedVersion: 0, text: 'x', extra: true } })).status, 400);
  });

  test('wishes keep their done state and their own revisions', async () => {
    const reader = env.client();
    await reader.login(env.password);
    const added = await reader.call('/api/wishes/w-test', { method: 'PUT', body: { expectedVersion: 0, text: '一起看海', done: false } });
    assert.equal(added.status, 200);
    const done = await reader.call('/api/wishes/w-test', { method: 'PUT', body: { expectedVersion: 1, text: '一起看海', done: true } });
    assert.deepEqual(done.json.wishes.find(wish => wish.id === 'w-test'), { id: 'w-test', text: '一起看海', done: true });
    assert.equal(done.json.revisions.wishes['w-test'], 2);
  });
});

describe('photos', () => {
  const webp = (width, height) => sharp({ create: { width, height, channels: 3, background: '#f4c9a8' } }).webp().toBuffer();
  const upload = async (reader, { id, title, revision, date = '2026-07-20' }) => {
    const form = new FormData();
    form.set('title', title); form.set('date', date); form.set('id', id);
    form.set('expectedRevision', String(revision)); form.set('width', '40'); form.set('height', '50');
    form.set('thumb', new Blob([await webp(20, 25)], { type: 'image/webp' }), 'thumb.webp');
    form.set('large', new Blob([await webp(40, 50)], { type: 'image/webp' }), 'large.webp');
    return reader.call('/api/photos', { method: 'POST', body: form });
  };

  test('uploads land in the manifest, sorted by date, and only signed-in readers can fetch them', async () => {
    const reader = env.client();
    await reader.login(env.password);
    const empty = await reader.call('/api/photos');
    const later = await upload(reader, { id: 'a000000000000001', title: '后来', revision: empty.json.revision, date: '2026-09-01' });
    assert.equal(later.status, 200);
    const earlier = await upload(reader, { id: 'a000000000000002', title: '早些', revision: later.json.revision, date: '2026-07-02' });
    assert.deepEqual(earlier.json.photos.map(photo => photo.title).slice(0, 2), ['早些', '后来']);
    const image = await reader.call('/api/photos/a000000000000002/thumb', { raw: true });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await env.client().call('/api/photos/a000000000000002/thumb')).status, 401);
  });

  test('a stale revision is a conflict, and non-WebP bytes are refused', async () => {
    const reader = env.client();
    await reader.login(env.password);
    const current = await reader.call('/api/photos');
    assert.equal((await upload(reader, { id: 'b000000000000001', title: '迟到', revision: current.json.revision - 1 })).status, 409);
    const form = new FormData();
    form.set('title', '不是图'); form.set('date', ''); form.set('id', 'b000000000000002');
    form.set('expectedRevision', String(current.json.revision)); form.set('width', '1'); form.set('height', '1');
    form.set('thumb', new Blob(['plain text pretending']), 'thumb.webp');
    form.set('large', new Blob(['plain text pretending']), 'large.webp');
    assert.equal((await reader.call('/api/photos', { method: 'POST', body: form })).status, 415);
  });

  test('the home page keeps at most three featured photos; titles and removal update the manifest', async () => {
    const reader = env.client();
    await reader.login(env.password);
    let manifest = (await reader.call('/api/photos')).json;
    for (let index = 0; index < 3; index++) {
      manifest = (await upload(reader, { id: `c00000000000000${index}`, title: `第${index}张`, revision: manifest.revision })).json;
    }
    const ids = manifest.photos.map(photo => photo.id);
    for (const id of ids.slice(0, 3)) {
      manifest = (await reader.call(`/api/photos/${id}/featured`, { method: 'PUT', body: { featured: true, expectedRevision: manifest.revision } })).json;
    }
    assert.equal(manifest.featured.length, 3);
    const fourth = await reader.call(`/api/photos/${ids[3]}/featured`, { method: 'PUT', body: { featured: true, expectedRevision: manifest.revision } });
    assert.notEqual(fourth.status, 200);
    manifest = (await reader.call(`/api/photos/${ids[0]}`, { method: 'PUT', body: { title: '改过的名字', expectedRevision: manifest.revision } })).json;
    assert.equal(manifest.photos.find(photo => photo.id === ids[0]).title, '改过的名字');
    manifest = (await reader.call(`/api/photos/${ids[0]}`, { method: 'DELETE', body: { expectedRevision: manifest.revision } })).json;
    assert.ok(!manifest.photos.some(photo => photo.id === ids[0]));
    assert.ok(!manifest.featured.includes(ids[0]), 'removing a photo also takes it off the home page');
  });
});

describe('the hundred-day letter', () => {
  test('is only read through a signed-in session', async () => {
    assert.equal((await env.client().call('/api/letter')).status, 401);
    const reader = env.client();
    await reader.login(env.password);
    const letter = await reader.call('/api/letter');
    // Day 100 (2026-10-08) has passed, so the letter is open to its readers.
    assert.equal(letter.status, 200);
    assert.equal(typeof letter.json.salutation, 'string');
    assert.ok(Array.isArray(letter.json.paragraphs) && letter.json.paragraphs.length > 0);
    assert.equal(typeof letter.json.closing, 'string');
  });

  test('a privately uploaded letter replaces the draft', async () => {
    const kv = await env.mf.getKVNamespace('PHOTOS');
    await kv.put('letters/hundred-day.json', JSON.stringify({ salutation: '测试称呼', paragraphs: ['测试段落'], closing: '测试落款' }));
    const reader = env.client();
    await reader.login(env.password);
    assert.deepEqual((await reader.call('/api/letter')).json, { salutation: '测试称呼', paragraphs: ['测试段落'], closing: '测试落款' });
    await kv.delete('letters/hundred-day.json');
  });
});
