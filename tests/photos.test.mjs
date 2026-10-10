import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.ts';
import { sessionCookieName } from '../worker/auth.ts';
import { emptyPhotoManifest, featuredPhotos, parsePhotoManifest, photoObjectKey, maxPhotos, maxPhotoTitleLength } from '../src/lib/photos.ts';
import { manifestUpsertSql, parseArgs } from '../scripts/upload-photos.mjs';
import { exifDate, photoId } from '../scripts/prepare-photos.mjs';

const origin = 'https://journal.example';
const password = 'example-test-password-only';
const salt = '00112233445566778899aabbccddeeff';
const credential = `pbkdf2$100000$${salt}$${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100_000, 32, 'sha256').toString('hex')}`;
const photo = (id, extra = {}) => ({ id, title: '一起听歌', date: '2026-06-24', width: 831, height: 1800, ...extra });
const manifest = { version: 1, revision: 0, featured: ['bbbbbbbbbbbbbbbb'], photos: [photo('aaaaaaaaaaaaaaaa'), photo('bbbbbbbbbbbbbbbb', { date: null })] };

/** Tiny RIFF/WEBP header — enough for the Worker magic check. */
const tinyWebp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x0e, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d,
  0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
]);

function fixture(objects = { 'manifest.json': JSON.stringify(manifest), [photoObjectKey('aaaaaaaaaaaaaaaa', 'thumb')]: 'thumb-bytes' }) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_cloud_notebook.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_photo_manifest.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { return { meta: statement.run(...values) }; },
      };
    },
    async batch(statements) { for (const item of statements) await item.run(); },
  };
  const reads = [];
  const writes = [];
  const deletes = [];
  const store = { ...objects };
  const PHOTOS = {
    async delete(key) { deletes.push(key); delete store[key]; },
    async get(key, type) {
      reads.push(key);
      if (!(key in store)) return null;
      if (type === 'json') return typeof store[key] === 'string' ? JSON.parse(store[key]) : store[key];
      assert.equal(type, 'arrayBuffer');
      const value = store[key];
      if (value instanceof Uint8Array) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      if (value instanceof ArrayBuffer) return value.slice(0);
      return new TextEncoder().encode(String(value)).buffer;
    },
    async put(key, value) {
      writes.push(key);
      if (typeof value === 'string') store[key] = value;
      else if (value instanceof Uint8Array) store[key] = value.slice();
      else if (value instanceof ArrayBuffer) store[key] = new Uint8Array(value);
      else if (ArrayBuffer.isView(value)) store[key] = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      else store[key] = value;
    },
  };
  const env = { DB, PHOTOS, EDITOR_PASSWORD_HASH: credential, ASSETS: { fetch: async () => new Response('asset') } };
  const request = (path, method = 'GET', cookie, init = {}) => worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
    body: init.body,
  }), env);
  return { sqlite, env, reads, writes, deletes, store, request, async login() {
    const response = await worker.fetch(new Request(`${origin}/api/session`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
      body: JSON.stringify({ password, remember: false }) }), env);
    return response.headers.get('Set-Cookie').split(';')[0];
  } };
}

function uploadForm({ title = '海边那天', date = '2026-06-24', id = 'cccccccccccccccc', expectedRevision = '0', width = '1200', height = '1600', thumb = tinyWebp, large = tinyWebp } = {}) {
  const form = new FormData();
  form.set('title', title);
  form.set('date', date);
  form.set('id', id);
  form.set('expectedRevision', expectedRevision);
  form.set('width', width);
  form.set('height', height);
  form.set('thumb', new Blob([thumb], { type: 'image/webp' }), 'thumb.webp');
  form.set('large', new Blob([large], { type: 'image/webp' }), 'large.webp');
  return form;
}

test('photo manifest and images never leave KV without a session', async () => {
  const f = fixture();
  for (const path of ['/api/photos', '/api/photos/aaaaaaaaaaaaaaaa/thumb', '/api/photos/aaaaaaaaaaaaaaaa/large']) {
    for (const cookie of [undefined, `${sessionCookieName}=${'a'.repeat(64)}`]) {
      const response = await f.request(path, 'GET', cookie);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  }
  assert.deepEqual(f.reads, []);
  const denied = await f.request('/api/photos', 'POST', undefined, { body: uploadForm() });
  assert.equal(denied.status, 401);
  assert.deepEqual(f.writes, []);
});

test('signed-in readers get the manifest and private, uncached images', async () => {
  const f = fixture();
  const cookie = await f.login();
  const list = await f.request('/api/photos', 'GET', cookie);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await list.json(), manifest);
  const image = await f.request('/api/photos/aaaaaaaaaaaaaaaa/thumb', 'GET', cookie);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('Content-Type'), 'image/webp');
  assert.equal(image.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(await image.text(), 'thumb-bytes');
  for (const path of ['/api/photos/aaaaaaaaaaaaaaaa/large', '/api/photos/aaaaaaaaaaaaaaaa/original', '/api/photos/..%2Fmanifest.json/thumb', '/api/photos/AAAAAAAAAAAAAAAA/thumb']) {
    assert.equal((await f.request(path, 'GET', cookie)).status, 404);
  }
  assert.ok(f.reads.every(key => key === 'manifest.json' || /^photos\/[a-f0-9]{16}\/(thumb|large)\.webp$/.test(key)));
  for (const method of ['HEAD', 'PUT', 'DELETE']) {
    const response = await f.request('/api/photos', method, cookie);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, POST');
  }
  assert.equal((await f.request('/api/photos/aaaaaaaaaaaaaaaa/thumb', 'POST', cookie)).status, 405);
});

test('an empty bucket is an empty album; a missing binding or bad manifest fails closed', async () => {
  const empty = fixture({});
  assert.deepEqual(await (await empty.request('/api/photos', 'GET', await empty.login())).json(), emptyPhotoManifest());
  const unbound = fixture();
  delete unbound.env.PHOTOS;
  assert.equal((await unbound.request('/api/photos', 'GET', await unbound.login())).status, 503);
  const broken = fixture({ 'manifest.json': JSON.stringify({ ...manifest, featured: ['cccccccccccccccc'] }) });
  const response = await broken.request('/api/photos', 'GET', await broken.login());
  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(await response.json()), ['error']);
});

test('manifest parsing rejects malformed entries and resolves featured photos', () => {
  assert.deepEqual(featuredPhotos(parsePhotoManifest(manifest)).map(item => item.id), ['bbbbbbbbbbbbbbbb']);
  assert.deepEqual(featuredPhotos(parsePhotoManifest({ ...manifest, featured: [] })), []);
  assert.equal(parsePhotoManifest({ version: 1, featured: [], photos: [] }).revision, 0);
  assert.equal(parsePhotoManifest({ version: 1, revision: 3, featured: [], photos: [] }).revision, 3);
  for (const bad of [
    { ...manifest, version: 2 },
    { ...manifest, revision: -1 },
    { ...manifest, photos: [photo('aaaaaaaaaaaaaaaa'), photo('aaaaaaaaaaaaaaaa')] },
    { ...manifest, photos: [photo('../secret')] , featured: [] },
    { ...manifest, photos: [photo('aaaaaaaaaaaaaaaa', { title: ' ' })], featured: [] },
    { ...manifest, photos: [photo('aaaaaaaaaaaaaaaa', { date: '2026-13-40' })], featured: [] },
    { ...manifest, photos: [photo('aaaaaaaaaaaaaaaa', { width: 0 })], featured: [] },
    { ...manifest, featured: ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa'] },
  ]) assert.throws(() => parsePhotoManifest(bad));
});

test('photo preparation reads EXIF dates and hashes stable ids', () => {
  assert.equal(exifDate(Buffer.from('MM\0*....2026:07:01 04:11:59\0', 'latin1')), '2026-07-01');
  assert.equal(exifDate(Buffer.from('0000:00:00 00:00:00', 'latin1')), null);
  assert.equal(exifDate(undefined), null);
  assert.match(photoId(Buffer.from('a')), /^[a-f0-9]{16}$/);
  assert.equal(photoId(Buffer.from('a')), photoId(Buffer.from('a')));
});

test('signed-in upload adds one photo without changing featured', async () => {
  const f = fixture();
  const cookie = await f.login();
  const response = await f.request('/api/photos', 'POST', cookie, { body: uploadForm({ id: 'cccccccccccccccc', expectedRevision: '0' }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revision, 1);
  assert.deepEqual(body.featured, manifest.featured);
  assert.equal(body.photos.length, 3);
  assert.ok(body.photos.some(item => item.id === 'cccccccccccccccc' && item.title === '海边那天'));
  assert.ok(f.writes.includes(photoObjectKey('cccccccccccccccc', 'thumb')));
  assert.ok(f.writes.includes(photoObjectKey('cccccccccccccccc', 'large')));
  assert.deepEqual(f.writes, ['thumb', 'large'].map(size => photoObjectKey('cccccccccccccccc', size)));
  assert.deepEqual(await (await f.request('/api/photos', 'GET', cookie)).json(), body);
  assert.equal(f.sqlite.prepare('SELECT revision FROM photo_manifest').get().revision, 1);
});

test('upload into an empty featured album never invents homepage picks', async () => {
  const emptyFeatured = { version: 1, revision: 0, featured: [], photos: [photo('aaaaaaaaaaaaaaaa')] };
  const f = fixture({ 'manifest.json': JSON.stringify(emptyFeatured), [photoObjectKey('aaaaaaaaaaaaaaaa', 'thumb')]: 'thumb-bytes' });
  const cookie = await f.login();
  assert.deepEqual(featuredPhotos(parsePhotoManifest(emptyFeatured)), []);
  const response = await f.request('/api/photos', 'POST', cookie, {
    body: uploadForm({ id: 'cccccccccccccccc', expectedRevision: '0' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.featured, []);
  assert.deepEqual(featuredPhotos(parsePhotoManifest(body)), []);
  assert.equal(body.photos.length, 2);
  assert.ok(body.photos.some(item => item.id === 'cccccccccccccccc'));
});

test('upload rejects guests, non-webp bytes, and stale revisions', async () => {
  const f = fixture();
  const cookie = await f.login();
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal((await f.request('/api/photos', 'POST', cookie, { body: uploadForm({ thumb: png }) })).status, 415);
  assert.equal((await f.request('/api/photos', 'POST', cookie, {
    body: uploadForm({ expectedRevision: '99', id: 'dddddddddddddddd' }),
  })).status, 409);
  const again = await f.request('/api/photos', 'POST', cookie, {
    body: uploadForm({ id: 'aaaaaaaaaaaaaaaa', expectedRevision: '0' }),
  });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).revision, 0);
});

test('upload without a session is refused and does not write', async () => {
  const f = fixture({});
  const response = await f.request('/api/photos', 'POST', undefined, { body: uploadForm() });
  assert.equal(response.status, 401);
  assert.deepEqual(f.writes, []);
  assert.equal(f.store['manifest.json'], undefined);
});

async function assertAbsent(f, cookie, id) {
  for (const size of ['thumb', 'large']) {
    assert.equal(Object.hasOwn(f.store, photoObjectKey(id, size)), false);
    assert.equal((await f.request(`/api/photos/${id}/${size}`, 'GET', cookie)).status, 404);
  }
}

test('stale upload checks revision before writing any images', async () => {
  const f = fixture();
  const cookie = await f.login();
  const response = await f.request('/api/photos', 'POST', cookie, { body: uploadForm({ expectedRevision: '99' }) });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: '相册刚在其他设备更新，请刷新后再贴。' });
  assert.deepEqual(f.writes, []);
  await assertAbsent(f, cookie, 'cccccccccccccccc');
});

test('full album rejects upload without image writes', async () => {
  const full = { ...manifest, featured: [], photos: Array.from({ length: maxPhotos }, (_, i) => photo(i.toString(16).padStart(16, '0'))) };
  const f = fixture({ 'manifest.json': JSON.stringify(full) });
  const cookie = await f.login();
  const response = await f.request('/api/photos', 'POST', cookie, { body: uploadForm() });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: '相册已经贴满了，这本装不下更多了。' });
  assert.deepEqual(f.writes, []);
  await assertAbsent(f, cookie, 'cccccccccccccccc');
});

test('concurrent different-id uploads commit exactly one revision with no loser images', async () => {
  const f = fixture();
  const cookie = await f.login();
  await f.request('/api/photos', 'GET', cookie);
  const ids = ['cccccccccccccccc', 'dddddddddddddddd'];
  const responses = await Promise.all(ids.map(id => f.request('/api/photos', 'POST', cookie, { body: uploadForm({ id }) })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const winner = ids[responses.findIndex(r => r.status === 200)];
  const loser = ids.find(id => id !== winner);
  const final = await (await f.request('/api/photos', 'GET', cookie)).json();
  assert.equal(final.revision, manifest.revision + 1);
  assert.deepEqual(final.featured, manifest.featured);
  assert.deepEqual(final.photos.map(p => p.id).sort(), [...manifest.photos.map(p => p.id), winner].sort());
  await assertAbsent(f, cookie, loser);
  for (const size of ['thumb', 'large']) assert.ok(f.store[photoObjectKey(winner, size)]);
});

for (const committedSameId of [false, true]) {
  test(`lost CAS cleans images unless same id committed concurrently (${committedSameId})`, async () => {
    const f = fixture();
    const cookie = await f.login();
    await f.request('/api/photos', 'GET', cookie);
    const put = f.env.PHOTOS.put;
    f.env.PHOTOS.put = async (key, value) => {
      await put(key, value);
      if (key === photoObjectKey('cccccccccccccccc', 'large')) {
        const concurrent = { ...manifest, revision: 1, photos: committedSameId ? [...manifest.photos, photo('cccccccccccccccc')] : manifest.photos };
        f.sqlite.prepare('UPDATE photo_manifest SET manifest = ?, revision = 1 WHERE id = 1').run(JSON.stringify(concurrent));
      }
    };
    assert.equal((await f.request('/api/photos', 'POST', cookie, { body: uploadForm() })).status, 409);
    if (committedSameId) {
      assert.deepEqual(f.deletes, []);
      for (const size of ['thumb', 'large']) assert.ok(f.store[photoObjectKey('cccccccccccccccc', size)]);
    } else {
      assert.deepEqual(f.deletes.sort(), ['thumb', 'large'].map(size => photoObjectKey('cccccccccccccccc', size)).sort());
      await assertAbsent(f, cookie, 'cccccccccccccccc');
    }
  });
}

test('manifest commit errors clean up and delete failures preserve the original 503', async () => {
  for (const deleteFails of [false, true]) {
    const f = fixture();
    const cookie = await f.login();
    await f.request('/api/photos', 'GET', cookie);
    const prepare = f.env.DB.prepare;
    f.env.DB.prepare = sql => {
      if (sql.startsWith('UPDATE photo_manifest')) return { bind() { return this; }, async run() { throw new Error('write failed'); } };
      return prepare(sql);
    };
    if (deleteFails) f.env.PHOTOS.delete = async key => { f.deletes.push(key); throw new Error('delete failed'); };
    assert.equal((await f.request('/api/photos', 'POST', cookie, { body: uploadForm() })).status, 503);
    assert.equal(f.deletes.length, 2);
    if (!deleteFails) await assertAbsent(f, cookie, 'cccccccccccccccc');
  }
});

test('D1 initializes once from KV preserving featured and revision; column wins thereafter', async () => {
  const seed = { ...manifest, revision: 7 };
  const f = fixture({ 'manifest.json': JSON.stringify(seed) });
  const cookie = await f.login();
  assert.deepEqual(await (await f.request('/api/photos', 'GET', cookie)).json(), seed);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM photo_manifest').get().count, 1);
  f.store['manifest.json'] = 'invalid';
  f.sqlite.exec('UPDATE photo_manifest SET revision = 8');
  assert.deepEqual(await (await f.request('/api/photos', 'GET', cookie)).json(), { ...seed, revision: 8 });
  assert.equal(f.reads.filter(key => key === 'manifest.json').length, 1);
});

for (const seeded of [false, true]) {
  test(`concurrent initial GETs converge on a single D1 row (KV seed: ${seeded})`, async () => {
    const expected = seeded ? { ...manifest, revision: 4 } : emptyPhotoManifest();
    const f = fixture(seeded ? { 'manifest.json': JSON.stringify(expected) } : {});
    const cookie = await f.login();
    const responses = await Promise.all([f.request('/api/photos', 'GET', cookie), f.request('/api/photos', 'GET', cookie)]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM photo_manifest').get().count, 1);
  });
}

test('dedupe returns current manifest even with stale revision without writes or deletes', async () => {
  const f = fixture();
  const cookie = await f.login();
  const response = await f.request('/api/photos', 'POST', cookie, { body: uploadForm({ id: 'aaaaaaaaaaaaaaaa', expectedRevision: '99' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), manifest);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.deletes, []);
  assert.equal(f.store[photoObjectKey('aaaaaaaaaaaaaaaa', 'thumb')], 'thumb-bytes');
});

test('CLI SQL inserts then bumps revision; worker serves new featured and image, escaping quotes', async () => {
  const f = fixture({});
  const first = { ...manifest, revision: 5 };
  f.sqlite.exec(manifestUpsertSql(first));
  assert.equal(f.sqlite.prepare('SELECT revision FROM photo_manifest').get().revision, 5);
  const next = { version: 1, revision: 0, featured: ['cccccccccccccccc'], photos: [photo('cccccccccccccccc', { title: "a friend's photo" })] };
  f.sqlite.exec(manifestUpsertSql(next));
  assert.equal(f.sqlite.prepare('SELECT revision FROM photo_manifest').get().revision, 6);
  f.store[photoObjectKey('cccccccccccccccc', 'thumb')] = tinyWebp;
  const cookie = await f.login();
  assert.deepEqual(await (await f.request('/api/photos', 'GET', cookie)).json(), { ...next, revision: 6 });
  const image = await f.request('/api/photos/cccccccccccccccc/thumb', 'GET', cookie);
  assert.equal(image.status, 200);
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), tinyWebp);
  assert.deepEqual(f.reads, [photoObjectKey('cccccccccccccccc', 'thumb')]);
});

test('CLI chunks a full CJK album below D1 statement limits and preserves ordered JSON', async () => {
  const full = parsePhotoManifest({ version: 1, revision: 7, featured: [], photos: Array.from({ length: maxPhotos }, (_, i) =>
    photo(i.toString(16).padStart(16, '0'), { title: '照'.repeat(maxPhotoTitleLength) })) });
  assert.equal(full.photos.length, 2000);
  const sql = manifestUpsertSql(full);
  const statements = sql.trimEnd().split(';\n').map(statement => `${statement.replace(/;$/, '')};`);
  assert.ok(statements.filter(statement => statement.startsWith('INSERT INTO photo_manifest_upload')).length > 1);
  for (const statement of statements) assert.ok(Buffer.byteLength(statement, 'utf8') < 100_000);
  const f = fixture({});
  f.sqlite.exec(sql);
  assert.equal(f.sqlite.prepare('SELECT manifest FROM photo_manifest WHERE id = 1').get().manifest, JSON.stringify(full));
  assert.equal(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'photo_manifest_upload'").get(), undefined);
  const cookie = await f.login();
  const response = await f.request('/api/photos', 'GET', cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), full);
});

test('CLI single quotes round-trip exactly and staging is cleaned on insert and overwrite', () => {
  const f = fixture({});
  const quoted = parsePhotoManifest({ ...manifest, photos: manifest.photos.map(item => ({ ...item, title: "朋友的 '照片'; 一起听歌" })) });
  for (let revision = 0; revision < 2; revision++) {
    f.sqlite.exec(manifestUpsertSql(quoted));
    assert.equal(f.sqlite.prepare('SELECT manifest FROM photo_manifest WHERE id = 1').get().manifest, JSON.stringify(quoted));
    assert.equal(f.sqlite.prepare('SELECT revision FROM photo_manifest WHERE id = 1').get().revision, revision);
    assert.equal(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'photo_manifest_upload'").get(), undefined);
  }
});

test('CLI flags validate local persistence and source selection without executing wrangler', () => {
  assert.deepEqual(parseArgs(['--config', 'example.json']), { local: false, source: '.private-photos', config: 'example.json' });
  assert.deepEqual(parseArgs(['--config', 'example.json', '--local', '--persist-to', 'scratch', '--source', 'images']), { local: true, source: 'images', config: 'example.json', 'persist-to': 'scratch' });
  assert.throws(() => parseArgs(['--config', 'example.json', '--persist-to', 'scratch']), /requires --local/);
  assert.throws(() => parseArgs(['--source']), /Missing value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});
