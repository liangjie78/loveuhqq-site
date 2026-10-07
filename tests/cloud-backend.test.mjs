import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.ts';
import { digest, isPasswordHash, readSessionToken, sessionCookieName, verifyPassword } from '../worker/auth.ts';
import { hundredDayLetter, hundredDayLetterKey } from '../worker/letter.ts';

const origin = 'https://journal.example';
const password = 'example-test-password-only';
const salt = '00112233445566778899aabbccddeeff';
const credential = `pbkdf2$100000$${salt}$${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100_000, 32, 'sha256').toString('hex')}`;

// Execute the production SQL in SQLite; no SQL parsing or canned query results.
function fixture() {
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
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const item of statements) result.push(await item.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, EDITOR_PASSWORD_HASH: credential, ASSETS: { fetch: async () => new Response('asset') } };
  const request = (path, method = 'GET', value, cookie, headers = {}) => worker.fetch(new Request(`${origin}${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }), env);
  return { sqlite, env, request, async login(remember = false) {
    const response = await request('/api/session', 'POST', { password, remember });
    assert.equal(response.status, 200);
    return response.headers.get('Set-Cookie').split(';')[0];
  } };
}

test('PBKDF2 verifier validates exact supported format and passwords', async () => {
  assert.equal(isPasswordHash(credential), true);
  for (const value of ['', credential.replace('100000', '100001'), credential.replace(salt, 'ab'), undefined]) assert.equal(isPasswordHash(value), false);
  assert.equal(await verifyPassword(password, credential), true);
  assert.equal(await verifyPassword('wrong-test-password', credential), false);
});

test('unconfigured backend fails closed and unknown APIs never become assets', async () => {
  const f = fixture();
  f.env.EDITOR_PASSWORD_HASH = undefined;
  assert.deepEqual(await (await f.request('/api/session')).json(), { authenticated: false, configured: false });
  assert.equal((await f.request('/api/notebook')).status, 503);
  assert.equal((await f.request('/api/missing')).status, 404);
  assert.equal(await (await f.request('/photos/')).text(), 'asset');
  f.env.EDITOR_PASSWORD_HASH = credential;
  delete f.env.DB;
  assert.equal((await f.request('/api/notebook')).status, 503);
});

test('private notebook requires a current server session; API responses are uncached', async () => {
  const f = fixture();
  const response = await f.request('/api/notebook');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.deepEqual(await (await f.request('/api/session')).json(), { authenticated: false, configured: true });
  const cookie = await f.login();
  assert.deepEqual(await (await f.request('/api/session', 'GET', undefined, cookie)).json(), { authenticated: true, configured: true });
  assert.equal((await f.request('/api/notebook', 'GET', undefined, `${sessionCookieName}=${'a'.repeat(64)}`)).status, 401);
});

test('letter opens at the hundredth Shanghai midnight and stays open afterward', async (t) => {
  const unlock = Date.parse('2026-10-08T00:00:00+08:00');
  t.mock.timers.enable({ apis: ['Date'], now: unlock - 1 });
  const f = fixture();
  const cookie = await f.login(true);
  for (const [now, status] of [[unlock - 1, 403], [unlock, 200], [unlock + 86400000, 200]]) {
    t.mock.timers.setTime(now);
    const response = await f.request('/api/letter', 'GET', undefined, cookie);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const result = await response.json();
    if (status === 200) assert.deepEqual(result, hundredDayLetter);
    else {
      assert.deepEqual(Object.keys(result), ['error']);
      assert.ok(!JSON.stringify(result).includes(hundredDayLetter.paragraphs[0]));
    }
  }
});

test('letter rejects missing, invalid, expired, rotated and logged-out sessions after opening', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T00:00:00+08:00') });
  const f = fixture();
  const denied = async (cookie) => {
    const response = await f.request('/api/letter', 'GET', undefined, cookie);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: '请先登录手账。' });
  };
  await denied();
  await denied(`${sessionCookieName}=${'a'.repeat(64)}`);
  const cookie = await f.login();
  f.env.EDITOR_PASSWORD_HASH = credential.replace(salt, 'ffeeddccbbaa99887766554433221100');
  await denied(cookie);
  f.env.EDITOR_PASSWORD_HASH = credential;
  f.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now());
  await denied(cookie);
  const fresh = await f.login();
  assert.equal((await f.request('/api/letter', 'GET', undefined, fresh)).status, 200);
  assert.equal((await f.request('/api/session', 'DELETE', undefined, fresh)).status, 200);
  await denied(fresh);
});

test('letter fails closed when unconfigured and accepts only GET', async () => {
  const f = fixture();
  for (const [binding, value] of [['EDITOR_PASSWORD_HASH', undefined], ['DB', undefined]]) {
    const previous = f.env[binding];
    f.env[binding] = value;
    const response = await f.request('/api/letter');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: '云端手账尚未配置完成。' });
    f.env[binding] = previous;
  }
  for (const method of ['HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH']) {
    const response = await f.request('/api/letter', method, undefined, undefined, { Origin: '' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: '方法不支持。' });
  }
});

test('cloud letter storage is read only after session and date gates, and invalid content fails closed', async (t) => {
  const unlock = Date.parse('2026-10-08T00:00:00+08:00');
  t.mock.timers.enable({ apis: ['Date'], now: unlock - 1 });
  const f = fixture();
  const formal = { salutation: '测试称呼', paragraphs: ['合成正式信件第一段', '<script>synthetic only</script>'], closing: '测试落款' };
  let stored = formal;
  let reads = 0;
  f.env.PHOTOS = { async get(key, type) {
    assert.equal(key, hundredDayLetterKey);
    assert.equal(type, 'text');
    reads++;
    if (stored instanceof Error) throw stored;
    return stored === null ? null : stored === undefined ? 'null' : JSON.stringify(stored);
  } };
  assert.equal((await f.request('/api/letter')).status, 401);
  assert.equal((await f.request('/api/letter', 'GET', undefined, `${sessionCookieName}=${'a'.repeat(64)}`)).status, 401);
  const cookie = await f.login(true);
  assert.equal((await f.request('/api/letter', 'GET', undefined, cookie)).status, 403);
  assert.equal(reads, 0);
  t.mock.timers.setTime(unlock);
  const response = await f.request('/api/letter', 'GET', undefined, cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), formal);
  stored = null;
  assert.deepEqual(await (await f.request('/api/letter', 'GET', undefined, cookie)).json(), hundredDayLetter);
  for (stored of [undefined, {}, { ...formal, paragraphs: [] }, { ...formal, paragraphs: [' '] }, { ...formal, paragraphs: [3] },
    { ...formal, extra: 'private extra' }, new Error('synthetic storage error containing private text')]) {
    const unavailable = await f.request('/api/letter', 'GET', undefined, cookie);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await unavailable.json(), { error: '云端手账暂时不可用，请稍后重试。' });
  }
  await f.request('/api/session', 'DELETE', undefined, cookie);
  const beforeLogoutRead = reads;
  assert.equal((await f.request('/api/letter', 'GET', undefined, cookie)).status, 401);
  assert.equal(reads, beforeLogoutRead);
});

test('login accepts six-character passwords and rejects shorter passwords', async () => {
  const shortPassword = 'xQ9m2P';
  const shortSalt = '11223344556677889900aabbccddeeff';
  const shortCredential = `pbkdf2$100000$${shortSalt}$${pbkdf2Sync(shortPassword, Buffer.from(shortSalt, 'hex'), 100_000, 32, 'sha256').toString('hex')}`;
  const f = fixture();
  f.env.EDITOR_PASSWORD_HASH = shortCredential;

  const accepted = await f.request('/api/session', 'POST', { password: shortPassword, remember: false });
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get('Set-Cookie'), new RegExp(`^${sessionCookieName}=[a-f0-9]{64};`));

  const rejected = await f.request('/api/session', 'POST', { password: shortPassword.slice(0, 5), remember: false });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: '密码应为 6–128 个字符。' });
});

test('session tokens are 32 random bytes, hash-only in D1, with exact cookie protections and lifetimes', async () => {
  const f = fixture();
  for (const [remember, age] of [[false, 43200], [true, 2592000]]) {
    const before = Date.now();
    const response = await f.request('/api/session', 'POST', { password, remember });
    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie, new RegExp(`^${sessionCookieName}=[a-f0-9]{64}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}$`));
    const token = cookie.split(';')[0].split('=')[1];
    const row = f.sqlite.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(await digest(token));
    assert.notEqual(row.token_hash, token);
    assert.equal(row.credential_tag, await digest(credential));
    assert.ok(row.expires_at >= before + age * 1000 && row.expires_at <= Date.now() + age * 1000);
  }
});

test('expiry, password rotation and logout invalidate copied tokens at the server', async () => {
  const f = fixture();
  const cookie = await f.login();
  f.env.EDITOR_PASSWORD_HASH = credential.replace(salt, 'ffeeddccbbaa99887766554433221100');
  assert.equal((await f.request('/api/notebook', 'GET', undefined, cookie)).status, 401);
  f.env.EDITOR_PASSWORD_HASH = credential;
  f.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await f.request('/api/notebook', 'GET', undefined, cookie)).status, 401);
  const fresh = await f.login();
  const logout = await f.request('/api/session', 'DELETE', undefined, fresh);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0$/);
  assert.equal((await f.request('/api/notebook', 'GET', undefined, fresh)).status, 401);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('all writes require exact same origin including login and logout', async () => {
  const f = fixture();
  const cookie = await f.login();
  for (const [path, method, value] of [['/api/session', 'POST', { password, remember: false }], ['/api/session', 'DELETE'], ['/api/notes/2026-10-02', 'PUT', { expectedVersion: 0, text: 'a' }]]) {
    for (const headers of [{ Origin: '' }, { Origin: 'https://attacker.example' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await f.request(path, method, value, cookie, headers)).status, 403);
    }
  }
  assert.equal((await f.request('/api/notebook', 'GET', undefined, cookie)).status, 200);
});

test('login atomically limits to ten attempts per 15 minutes, including missing IPs', async () => {
  const f = fixture();
  for (const headers of [{}, { 'CF-Connecting-IP': '' }]) {
    for (let attempt = 0; attempt < 10; attempt++) assert.equal((await f.request('/api/session', 'POST', { password: 'wrong-test-password', remember: false }, undefined, headers)).status, 401);
    const blocked = await f.request('/api/session', 'POST', { password, remember: false }, undefined, headers);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('Retry-After'), '900');
  }
  f.sqlite.prepare('UPDATE login_limits SET window_until = ?').run(Date.now() - 1);
  assert.equal((await f.request('/api/session', 'POST', { password, remember: false })).status, 200);
});

test('strict JSON schema, dates, IDs, lengths and versions reject invalid mutations', async () => {
  const f = fixture();
  const cookie = await f.login();
  for (const path of ['/api/notes/2026-02-30', '/api/notes/1899-12-31', '/api/wishes/__proto__', '/api/wishes/' + 'x'.repeat(81)]) {
    assert.equal((await f.request(path, 'PUT', { expectedVersion: 0, text: 'a', done: false }, cookie)).status, 400);
  }
  for (const value of [{ expectedVersion: -1, text: 'a' }, { expectedVersion: 0.1, text: 'a' }, { expectedVersion: Number.MAX_SAFE_INTEGER, text: 'a' }, { expectedVersion: 0, text: '' }, { expectedVersion: 0, text: ' ' }, { expectedVersion: 0, text: 'x'.repeat(2001) }, { expectedVersion: 0, text: 'a', extra: true }, { text: 'a' }]) {
    assert.equal((await f.request('/api/notes/2026-10-02', 'PUT', value, cookie)).status, 400);
  }
  for (const value of [{ expectedVersion: 0, text: 'a', done: 'false' }, { expectedVersion: 0, text: 'x'.repeat(121), done: false }]) assert.equal((await f.request('/api/wishes/valid-id', 'PUT', value, cookie)).status, 400);
  assert.equal((await f.request('/api/notes/2026-10-02', 'PUT', { expectedVersion: 0, text: 'x'.repeat(20000) }, cookie)).status, 413);
  assert.equal((await f.request('/api/notes/2026-10-02', 'PUT', { expectedVersion: 0, text: 'a' }, cookie, { 'Content-Type': 'text/plain' })).status, 415);
});

test('streamed bodies enforce actual bytes without trusting Content-Length', async () => {
  const f = fixture();
  const cookie = await f.login();
  const streamed = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(17000))); controller.close(); } });
  const response = await worker.fetch(new Request(`${origin}/api/notes/2026-10-02`, { method: 'PUT', body: streamed, duplex: 'half', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'Content-Length': '1' } }), f.env);
  assert.equal(response.status, 413);
});

test('CAS rejects concurrent writes and tombstones prevent ABA, while restore advances version', async () => {
  const f = fixture();
  const cookie = await f.login();
  const path = '/api/notes/2026-10-02';
  const responses = await Promise.all(['first', 'second'].map((text) => f.request(path, 'PUT', { expectedVersion: 0, text }, cookie)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  let book = await (await f.request(path, 'DELETE', { expectedVersion: 1 }, cookie)).json();
  assert.equal(book.notes['2026-10-02'], undefined);
  assert.equal(book.revisions.notes['2026-10-02'], 2);
  for (const expectedVersion of [0, 1]) assert.equal((await f.request(path, 'PUT', { expectedVersion, text: 'stale' }, cookie)).status, 409);
  book = await (await f.request(path, 'PUT', { expectedVersion: 2, text: 'restored\n原文' }, cookie)).json();
  assert.equal(book.notes['2026-10-02'], 'restored\n原文');
  assert.equal(book.revisions.notes['2026-10-02'], 3);
});

test('wish updates and delete retain revisions and preserve completion', async () => {
  const f = fixture();
  const cookie = await f.login();
  const path = '/api/wishes/wish-1';
  let book = await (await f.request(path, 'PUT', { expectedVersion: 0, text: '测试心愿', done: false }, cookie)).json();
  assert.deepEqual(book.wishes, [{ id: 'wish-1', text: '测试心愿', done: false }]);
  book = await (await f.request(path, 'PUT', { expectedVersion: 1, text: '测试心愿', done: true }, cookie)).json();
  assert.equal(book.wishes[0].done, true);
  assert.equal(book.revisions.wishes['wish-1'], 2);
  assert.equal((await f.request(path, 'DELETE', { expectedVersion: 1 }, cookie)).status, 409);
  book = await (await f.request(path, 'DELETE', { expectedVersion: 2 }, cookie)).json();
  assert.deepEqual(book.wishes, []);
  assert.equal(book.revisions.wishes['wish-1'], 3);
});

test('atomic quota permits updates and tombstone deletion but rejects new active entries', async () => {
  const f = fixture();
  const cookie = await f.login();
  const insert = f.sqlite.prepare('INSERT INTO notebook_entries VALUES (?, ?, ?, 0, 1, 0)');
  for (let i = 0; i < 300; i++) insert.run('wish', `wish-${i}`, 'a');
  assert.equal((await f.request('/api/wishes/extra', 'PUT', { expectedVersion: 0, text: 'new', done: false }, cookie)).status, 422);
  assert.equal((await f.request('/api/wishes/wish-0', 'PUT', { expectedVersion: 1, text: 'updated', done: true }, cookie)).status, 200);
  assert.equal((await f.request('/api/wishes/wish-0', 'DELETE', { expectedVersion: 2 }, cookie)).status, 200);
  const responses = await Promise.all(['extra-a', 'extra-b'].map((id) => f.request(`/api/wishes/${id}`, 'PUT', { expectedVersion: 0, text: 'new', done: false }, cookie)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 422]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM notebook_entries WHERE kind = 'wish' AND deleted = 0").get().count, 300);
  assert.equal((await f.request('/api/wishes/wish-0', 'PUT', { expectedVersion: 3, text: 'restore', done: false }, cookie)).status, 422);
});

test('malformed and duplicate session cookies are never accepted', () => {
  for (const value of [`${sessionCookieName}=x`, `${sessionCookieName}=${'a'.repeat(64)}; ${sessionCookieName}=${'b'.repeat(64)}`]) {
    assert.equal(readSessionToken(new Request(origin, { headers: { Cookie: value } })), null);
  }
});
