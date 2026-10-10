import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.ts';
import { sessionCookieName } from '../worker/auth.ts';
import { emptyPhotoManifest, featuredPhotos, parsePhotoManifest, photoObjectKey } from '../src/lib/photos.ts';
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
  const store = { ...objects };
  const PHOTOS = {
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
  return { env, reads, writes, store, request, async login() {
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
  assert.ok(f.writes.includes('manifest.json'));
  assert.ok(f.writes.indexOf(photoObjectKey('cccccccccccccccc', 'thumb')) < f.writes.indexOf('manifest.json'));
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
