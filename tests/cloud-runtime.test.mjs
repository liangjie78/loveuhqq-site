import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('actual workerd and D1 support password login, CAS, tombstones and server logout', async () => {
  const salt = '00112233445566778899aabbccddeeff';
  const password = 'artificial-runtime-password';
  const stored = `pbkdf2$100000$${salt}$${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`;
  const built = await build({ entryPoints: [fileURLToPath(new URL('../worker/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-09-12', d1Databases: ['DB'], bindings: { EDITOR_PASSWORD_HASH: stored },
    serviceBindings: { ASSETS: async () => new Response('asset') } }));
  try {
    const db = await mf.getD1Database('DB');
    const migration = readFileSync(new URL('../migrations/0001_cloud_notebook.sql', import.meta.url), 'utf8');
    await db.batch(migration.split(';').map((sql) => sql.trim()).filter(Boolean).map((sql) => db.prepare(sql)));
    const origin = 'https://journal.example';
    const request = (path, method = 'GET', value, cookie) => mf.dispatchFetch(origin + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const login = await request('/api/session', 'POST', { password, remember: false });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('Set-Cookie').split(';')[0];
    const saved = await request('/api/notes/2026-10-02', 'PUT', { expectedVersion: 0, text: 'runtime check' }, cookie);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revisions.notes['2026-10-02'], 1);
    assert.equal((await request('/api/notes/2026-10-02', 'PUT', { expectedVersion: 0, text: 'stale' }, cookie)).status, 409);
    const removed = await request('/api/notes/2026-10-02', 'DELETE', { expectedVersion: 1 }, cookie);
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).revisions.notes['2026-10-02'], 2);
    assert.equal((await request('/api/session', 'DELETE', undefined, cookie)).status, 200);
    assert.equal((await request('/api/notebook', 'GET', undefined, cookie)).status, 401);
  } finally { await mf.dispose(); }
});
