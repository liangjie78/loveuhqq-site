import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.ts';
import { sessionCookieName } from '../worker/auth.ts';
import { featuredPhotos, parsePhotoManifest, photoObjectKey } from '../src/lib/photos.ts';
import { exifDate, photoId } from '../scripts/prepare-photos.mjs';

const origin = 'https://journal.example';
const password = 'example-test-password-only';
const salt = '00112233445566778899aabbccddeeff';
const credential = `pbkdf2$100000$${salt}$${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100_000, 32, 'sha256').toString('hex')}`;
const photo = (id, extra = {}) => ({ id, title: '一起听歌', date: '2026-06-24', width: 831, height: 1800, ...extra });
const manifest = { version: 1, featured: ['bbbbbbbbbbbbbbbb'], photos: [photo('aaaaaaaaaaaaaaaa'), photo('bbbbbbbbbbbbbbbb', { date: null })] };

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
  const PHOTOS = {
    async get(key, type) {
      reads.push(key);
      if (!(key in objects)) return null;
      if (type === 'json') return JSON.parse(objects[key]);
      assert.equal(type, 'arrayBuffer');
      return new TextEncoder().encode(objects[key]).buffer;
    },
  };
  const env = { DB, PHOTOS, EDITOR_PASSWORD_HASH: credential, ASSETS: { fetch: async () => new Response('asset') } };
  const request = (path, method = 'GET', cookie) => worker.fetch(new Request(`${origin}${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}) },
  }), env);
  return { env, reads, request, async login() {
    const response = await worker.fetch(new Request(`${origin}/api/session`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
      body: JSON.stringify({ password, remember: false }) }), env);
    return response.headers.get('Set-Cookie').split(';')[0];
  } };
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
  for (const method of ['HEAD', 'POST', 'PUT', 'DELETE']) {
    const response = await f.request('/api/photos', method, cookie);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
  }
});

test('an empty bucket is an empty album; a missing binding or bad manifest fails closed', async () => {
  const empty = fixture({});
  assert.deepEqual(await (await empty.request('/api/photos', 'GET', await empty.login())).json(), { version: 1, featured: [], photos: [] });
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
  assert.equal(featuredPhotos(parsePhotoManifest({ ...manifest, featured: [] }))[0].id, 'aaaaaaaaaaaaaaaa');
  for (const bad of [
    { ...manifest, version: 2 },
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
