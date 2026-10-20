import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleMemoryRequest, memoryActor } from '../worker/memory-book.ts';
import { digest, sessionCookieName } from '../worker/auth.ts';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

const origin = 'https://memory.example';
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_cloud_notebook.sql', '0002_photo_manifest.sql', '0003_shared_memory_book.sql', '0004_optional_place_coordinates.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql); let values = [];
      return { bind(...args) { values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; },
        async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; },
        async run() { if (/^\s*SELECT\b|\bRETURNING\b/i.test(sql)) return { results: statement.all(...values), meta: {} }; return { results: [], meta: statement.run(...values) }; } };
    },
    async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  const objects = new Map(); const reads = [];
  const env = { DB, PHOTOS: { async put(key, value) { objects.set(key, new Uint8Array(value).slice().buffer); }, async get(key, type) { reads.push(key); return objects.get(key) ?? null; }, async delete(key) { objects.delete(key); } } };
  const parents = { one: 'a'.repeat(64), two: 'b'.repeat(64) };
  for (const token of Object.values(parents)) sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest(token), 'synthetic-credential-tag', Date.now() + 3600_000);
  const cookies = { one: `${sessionCookieName}=${parents.one}`, two: `${sessionCookieName}=${parents.two}` };
  const request = (path, method = 'GET', value, who = 'one', headers = {}) => handleMemoryRequest(new Request(origin + '/api/memory' + path, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookies[who], ...headers },
    ...(value === undefined ? {} : { body: value instanceof Uint8Array ? value : JSON.stringify(value) }),
  }), env);
  const register = async (who) => { const response = await request('/identity', 'POST', { id: who }, who); assert.equal(response.status, 200, await response.clone().text()); cookies[who] += `; ${response.headers.get('Set-Cookie').split(';')[0]}`; return response; };
  return { sqlite, env, objects, reads, parents, cookies, request, register };
}
const story = (extra = {}) => ({ expectedVersion: 0, title: '合成故事', date: '2026-10-15', text: '公开给双方的故事正文', photoIds: [], wishIds: [], layout: 'journal', revealTogether: true, ...extra });
const part = (text, extra = {}) => ({ expectedVersion: 0, text, reply: '', submitted: false, audioIds: [], ...extra });
const letter = (extra = {}) => ({ expectedVersion: 0, title: '合成信件', text: 'SYNTHETIC_SECRET_LETTER', recipientId: 'two', openDate: '2099-01-01', pairKey: '', audioIds: [], ...extra });

function interleaveStoryWrite(f, write) {
  const prepare = f.env.DB.prepare.bind(f.env.DB), batch = f.env.DB.batch.bind(f.env.DB);
  let written = false;
  const commit = () => { if (!written) { written = true; write(); } };
  f.env.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (/FROM memory_stories\b/.test(sql)) {
      for (const method of ['first', 'all']) {
        const read = statement[method].bind(statement);
        statement[method] = (...args) => { const result = read(...args); commit(); return result; };
      }
    }
    return statement;
  };
  f.env.DB.batch = async (statements) => { const result = await batch(statements); commit(); return result; };
  return () => assert.equal(written, true, 'the concurrent story write must execute');
}

test('bootstrap never combines a public story snapshot with a newly private part', async (t) => {
  const f = await fixture(); t.after(() => f.sqlite.close());
  await f.register('one'); await f.register('two');
  assert.equal((await f.request('/stories/race-story', 'PUT', story({ revealTogether: false }))).status, 200);
  const assertWritten = interleaveStoryWrite(f, () => {
    f.sqlite.exec(`BEGIN;
      UPDATE memory_stories SET reveal_together=1,version=2 WHERE id='race-story';
      INSERT INTO memory_parts VALUES('race-story','two',1,'SYNTHETIC_PRIVATE_PART','SYNTHETIC_PRIVATE_REPLY',0,'["private-audio"]');
      COMMIT;`);
  });
  const response = await f.request('/bootstrap');
  assert.equal(response.status, 200); assertWritten();
  const snapshot = await response.json();
  assert.equal(JSON.stringify(snapshot).includes('SYNTHETIC_PRIVATE'), false, 'unrevealed partner text and reply must stay hidden');
  assert.equal(JSON.stringify(snapshot).includes('private-audio'), false, 'unrevealed partner audio IDs must stay hidden');
  const latest = await (await f.request('/bootstrap')).json();
  assert.equal(latest.stories[0].revealTogether, true); assert.equal(latest.stories[0].parts.length, 1);
  assert.equal(latest.stories[0].parts[0].text, undefined);
});

test('audio authorization never combines a public story snapshot with a newly private attachment', async (t) => {
  const f = await fixture(); t.after(() => f.sqlite.close());
  await f.register('one'); await f.register('two');
  assert.equal((await f.request('/stories/race-story', 'PUT', story({ revealTogether: false }))).status, 200);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  const upload = await f.request('/audio?storyId=race-story', 'POST', webm, 'two', { 'Content-Type': 'audio/webm', 'X-Audio-Duration': '1' });
  assert.equal(upload.status, 201); const audio = await upload.json();
  const assertWritten = interleaveStoryWrite(f, () => {
    f.sqlite.exec("UPDATE memory_stories SET reveal_together=1,version=2 WHERE id='race-story'");
    f.sqlite.prepare('INSERT INTO memory_parts VALUES(?,?,?,?,?,?,?)').run('race-story', 'two', 1, 'private', '', 0, JSON.stringify([audio.id]));
  });
  const reads = f.reads.length;
  const response = await f.request(`/audio/${audio.id}`);
  assertWritten(); assert.equal(response.status, 404, 'unrevealed partner audio must remain inaccessible during a story-mode change');
  assert.equal(f.reads.length, reads, 'denied audio must never read KV');
  assert.equal((await f.request(`/audio/${audio.id}`, 'GET', undefined, 'two')).status, 200);
});

test('signature selection binds to a live parent session and supports switching without a password', async () => {
  const f = await fixture();
  assert.deepEqual((await (await f.request('/bootstrap')).json()).member, null);
  assert.equal((await f.request('/stories/a', 'PUT', story())).status, 403);
  await f.register('one');
  assert.equal((await (await f.request('/bootstrap')).json()).member.id, 'one');
  const switched = await f.request('/identity', 'POST', { id: 'two' });
  assert.equal(switched.status, 200); assert.equal((await switched.json()).member.name, '女生');
  f.cookies.one = `${sessionCookieName}=${f.parents.one}; ${switched.headers.get('Set-Cookie').split(';')[0]}`;
  const request = new Request(origin, { headers: { Cookie: f.cookies.one } });
  assert.equal((await memoryActor(request, f.env.DB)).id, 'two');
  const personal = f.cookies.one.split('; ')[1];
  assert.equal(await memoryActor(new Request(origin, { headers: { Cookie: `${f.cookies.two}; ${personal}` } }), f.env.DB), null);
  f.sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(await digest(f.parents.one));
  assert.equal(await memoryActor(request, f.env.DB), null);
});

test('signature selection and clearing preserve the other shared session', async () => {
  const f = await fixture(); await f.register('one'); await f.register('two');
  assert.equal((await f.request('/identity', 'DELETE')).status, 200);
  assert.equal((await (await f.request('/bootstrap')).json()).member, null);
  assert.equal((await (await f.request('/bootstrap', 'GET', undefined, 'two')).json()).member.id, 'two');
  const login = await f.request('/identity', 'POST', { id: 'one' });
  assert.equal(login.status, 200); assert.equal((await login.json()).member.id, 'one');
});

test('separate story parts keep private text out of the other response until both submit and revelation latches', async () => {
  const f = await fixture(); await f.register('one'); await f.register('two');
  assert.equal((await f.request('/stories/story-a', 'PUT', story())).status, 200);
  assert.equal((await f.request('/stories/story-a/part', 'PUT', part('FIRST_PRIVATE', { submitted: true }))).status, 200);
  let book = await (await f.request('/bootstrap', 'GET', undefined, 'two')).json();
  assert.equal(book.stories[0].parts[0].text, undefined); assert.equal(JSON.stringify(book).includes('FIRST_PRIVATE'), false);
  assert.equal((await f.request('/stories/story-a', 'PUT', story({ expectedVersion: 1, revealTogether: false }), 'two')).status, 409);
  assert.equal((await f.request('/stories/story-a/part', 'PUT', part('SECOND_PRIVATE', { submitted: true }), 'two')).status, 200);
  book = await (await f.request('/bootstrap')).json();
  assert.equal(book.stories[0].parts.length, 2); assert.ok(book.stories[0].openedAt); assert.ok(JSON.stringify(book).includes('SECOND_PRIVATE'));
  assert.equal((await f.request('/stories/story-a/part', 'PUT', part('updated', { expectedVersion: 1, submitted: false }), 'two')).status, 200);
  assert.ok((await (await f.request('/bootstrap')).json()).stories[0].openedAt);
  assert.equal((await f.request('/stories/story-a/part', 'PUT', part('stale', { expectedVersion: 1 }), 'two')).status, 409);
});

test('letters hide drafts and sealed future bodies, enforce sender and version, and support pre-date withdrawal', async () => {
  const f = await fixture(); await f.register('one'); await f.register('two');
  assert.equal((await f.request('/letters/letter-a', 'PUT', letter())).status, 200);
  assert.equal((await (await f.request('/bootstrap', 'GET', undefined, 'two')).json()).letters.length, 0);
  assert.equal((await f.request('/letters/letter-a', 'GET', undefined, 'two')).status, 404);
  assert.equal((await f.request('/letters/letter-a/seal', 'POST', { expectedVersion: 1 })).status, 200);
  const envelope = await (await f.request('/letters/letter-a', 'GET', undefined, 'two')).json();
  assert.equal(envelope.readable, false); assert.equal(envelope.text, undefined); assert.equal(envelope.audioIds, undefined);
  assert.equal((await f.request('/letters/letter-a', 'PUT', letter({ expectedVersion: 2 }))).status, 409);
  assert.equal((await f.request('/letters/letter-a/withdraw', 'POST', { expectedVersion: 2 }, 'two')).status, 403);
  assert.equal((await f.request('/letters/letter-a/withdraw', 'POST', { expectedVersion: 1 })).status, 409);
  assert.equal((await f.request('/letters/letter-a/withdraw', 'POST', { expectedVersion: 2 })).status, 200);
  assert.equal((await f.request('/letters/letter-a', 'GET', undefined, 'two')).status, 404);
});

test('paired letters open only after reciprocal seal with the same date; due letters cannot be withdrawn', async () => {
  const f = await fixture(); await f.register('one'); await f.register('two');
  await f.request('/letters/pair-a', 'PUT', letter({ pairKey: 'pair', openDate: '2000-01-01' }));
  await f.request('/letters/pair-a/seal', 'POST', { expectedVersion: 1 });
  assert.equal((await (await f.request('/letters/pair-a', 'GET', undefined, 'two')).json()).readable, false);
  await f.request('/letters/pair-b', 'PUT', letter({ recipientId: 'one', pairKey: 'pair', openDate: '2000-01-01' }), 'two');
  await f.request('/letters/pair-b/seal', 'POST', { expectedVersion: 1 }, 'two');
  assert.equal((await (await f.request('/letters/pair-a', 'GET', undefined, 'two')).json()).text, 'SYNTHETIC_SECRET_LETTER');
  assert.equal((await f.request('/letters/pair-a/withdraw', 'POST', { expectedVersion: 2 })).status, 409);
});

test('audio KV access follows attached private parts and letter date gates, checking signatures and byte limits', async () => {
  const f = await fixture(); await f.register('one'); await f.register('two');
  await f.request('/stories/story-a', 'PUT', story());
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  const headers = { 'Content-Type': 'audio/webm;codecs=opus', 'X-Audio-Duration': '2' };
  const response = await f.request('/audio?storyId=story-a', 'POST', webm, 'one', headers);
  assert.equal(response.status, 201, await response.clone().text()); const audio = await response.json();
  const key = `audio/${audio.id}`; assert.ok(f.objects.has(key));
  assert.equal((await f.request(`/audio/${audio.id}`)).status, 200);
  const reads = f.reads.length;
  assert.equal((await f.request(`/audio/${audio.id}`, 'GET', undefined, 'two')).status, 404); assert.equal(f.reads.length, reads);
  await f.request('/stories/story-a/part', 'PUT', part('one', { audioIds: [audio.id], submitted: true }));
  await f.request('/stories/story-a/part', 'PUT', part('two', { submitted: true }), 'two');
  assert.deepEqual(new Uint8Array(await (await f.request(`/audio/${audio.id}`, 'GET', undefined, 'two')).arrayBuffer()), webm);
  assert.equal((await f.request('/audio?storyId=story-a', 'POST', new Uint8Array(12), 'one', headers)).status, 415);
  assert.equal((await f.request('/audio?storyId=story-a', 'POST', webm, 'one', { ...headers, 'X-Audio-Duration': '61' })).status, 400);
  assert.equal((await f.request('/audio?storyId=story-a', 'POST', webm, 'one', { ...headers, 'Content-Length': '5000000' })).status, 413);
  f.objects.delete(key); assert.equal((await f.request(`/audio/${audio.id}`)).status, 503);
  await f.request('/letters/letter-a', 'PUT', letter());
  const letterAudio = await (await f.request('/audio?letterId=letter-a', 'POST', webm, 'one', headers)).json();
  await f.request('/letters/letter-a', 'PUT', letter({ expectedVersion: 1, audioIds: [letterAudio.id] }));
  await f.request('/letters/letter-a/seal', 'POST', { expectedVersion: 2 });
  assert.equal((await f.request(`/audio/${letterAudio.id}`, 'GET', undefined, 'two')).status, 404);
});

test('places and wish plans validate relations, use CAS, and preserve stories after wish completion changes', async () => {
  const f = await fixture(); await f.register('one');
  f.sqlite.prepare("INSERT INTO notebook_entries VALUES('wish','wish-a','合成愿望',0,1,0)").run();
  await f.request('/stories/story-a', 'PUT', story({ wishIds: ['wish-a'] }));
  assert.equal((await f.request('/wishPlans/wish-a', 'PUT', { expectedVersion: 0, plannedDate: '2026-11-01', storyId: 'story-a' })).status, 200);
  assert.equal((await f.request('/wishPlans/wish-a', 'PUT', { expectedVersion: 0, plannedDate: null, storyId: null })).status, 409);
  assert.equal((await f.request('/wishPlans/missing', 'PUT', { expectedVersion: 0, plannedDate: null, storyId: null })).status, 400);
  const place = { expectedVersion: 0, name: '手选地点', lat: 23.1, lng: 113.2, year: 2026, storyIds: ['story-a'], wishIds: ['wish-a'] };
  assert.equal((await f.request('/places/place-a', 'PUT', place)).status, 200);
  assert.equal((await f.request('/places/place-b', 'PUT', { ...place, lat: 91 })).status, 400);
  f.sqlite.prepare("UPDATE notebook_entries SET done=1,version=2 WHERE entry_key='wish-a'").run();
  f.sqlite.prepare("UPDATE notebook_entries SET done=0,version=3 WHERE entry_key='wish-a'").run();
  const book = await (await f.request('/bootstrap')).json();
  assert.equal(book.wishPlans[0].storyId, 'story-a'); assert.equal(book.stories[0].id, 'story-a'); assert.equal(book.places[0].storyIds[0], 'story-a');
});

test('optional-place migration preserves existing coordinates, versions and associations', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../migrations/0003_shared_memory_book.sql', import.meta.url), 'utf8'));
    const original = { id: 'legacy-place', version: 7, name: '已有地点', lat: 23.1, lng: 113.2, year: 2026, story_ids: '["story-a"]', wish_ids: '["wish-a"]' };
    sqlite.prepare('INSERT INTO memory_places VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(original));
    sqlite.exec('BEGIN');
    try { sqlite.exec(readFileSync(new URL('../migrations/0004_optional_place_coordinates.sql', import.meta.url), 'utf8')); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    assert.deepEqual({ ...sqlite.prepare('SELECT * FROM memory_places').get() }, original);
    sqlite.prepare('INSERT INTO memory_places VALUES(?,?,?,?,?,?,?,?)').run('no-coordinates', 1, '地点备忘', null, null, 2026, '[]', '[]');
    assert.equal(sqlite.prepare("SELECT lat FROM memory_places WHERE id='no-coordinates'").get().lat, null);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='memory_places_optional'").get(), undefined);
  } finally { sqlite.close(); }
});

test('place memos keep omitted coordinates null, validate optional pairs and preserve associations under concurrent CAS', async () => {
  const f = await fixture(); await f.register('one');
  f.sqlite.prepare("INSERT INTO notebook_entries VALUES('wish','memo-wish','合成愿望',0,1,0)").run();
  await f.request('/stories/memo-story', 'PUT', story());
  const memo = { expectedVersion: 0, name: '以后想去的地方', lat: null, lng: null, year: 2027, storyIds: ['memo-story'], wishIds: ['memo-wish'] };
  const saved = await f.request('/places/memo', 'PUT', memo);
  assert.equal(saved.status, 200); const initial = (await saved.json()).places[0];
  assert.equal(initial.lat, null); assert.equal(initial.lng, null);
  for (const coords of [{ lat: null, lng: 113.2 }, { lat: 23.1, lng: null }, { lat: '23.1', lng: 113.2 }, { lat: 91, lng: 113.2 }, { lat: 23.1, lng: -181 }]) {
    assert.equal((await f.request('/places/invalid', 'PUT', { ...memo, ...coords })).status, 400);
  }
  assert.equal((await f.request('/places/missing-story', 'PUT', { ...memo, storyIds: ['missing'] })).status, 404);
  assert.equal((await f.request('/places/missing-wish', 'PUT', { ...memo, wishIds: ['missing'] })).status, 400);
  const updates = await Promise.all(['第一种备忘', '第二种备忘'].map(name => f.request('/places/memo', 'PUT', { ...memo, expectedVersion: 1, name })));
  assert.deepEqual(updates.map(response => response.status).sort(), [200, 409]);
  const current = (await (await f.request('/bootstrap')).json()).places[0];
  assert.equal(current.version, 2); assert.equal(current.lat, null); assert.equal(current.lng, null);
  assert.deepEqual(current.storyIds, ['memo-story']); assert.deepEqual(current.wishIds, ['memo-wish']);
  assert.equal((await f.request('/places/memo', 'PUT', { ...memo, expectedVersion: 2, lat: 23.1, lng: 113.2 })).status, 200);
  assert.equal((await f.request('/places/memo', 'PUT', { ...memo, expectedVersion: 3 })).status, 200);
  assert.equal((await (await f.request('/bootstrap')).json()).places[0].lat, null);
});

test('all mutations including signature selection require same origin and strict payloads', async () => {
  const f = await fixture(); await f.register('one');
  assert.equal((await f.request('/stories/a', 'PUT', story(), 'one', { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.request('/stories/a', 'PUT', { ...story(), extra: true })).status, 400);
  assert.equal((await f.request('/stories/a', 'PUT', story({ date: '2026-02-30' }))).status, 400);
  assert.equal((await f.request('/stories/a', 'PUT', story({ text: 'x'.repeat(70000) }))).status, 413);
  assert.equal((await f.request('/identity', 'POST', { id: 'other' })).status, 400);
  assert.equal((await f.request('/identity', 'POST', { id: 'one', password: 'obsolete' })).status, 400);
  assert.equal((await f.request('/identity', 'POST', { id: 'two' }, 'one', { Origin: 'https://other.example' })).status, 403);

});

test('actual workerd D1 and KV run signature selection, revelation and authenticated audio', async () => {
  const built = await build({ stdin: { contents: "import { handleMemoryRequest } from './worker/memory-book.ts'; export default { fetch: handleMemoryRequest };", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-12', d1Databases: ['DB'], kvNamespaces: ['PHOTOS'] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of ['0001_cloud_notebook.sql', '0002_photo_manifest.sql', '0003_shared_memory_book.sql', '0004_optional_place_coordinates.sql']) {
      const migration = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
    }
    const cookies = {};
    for (const [id, parent] of [['one', 'c'.repeat(64)], ['two', 'd'.repeat(64)]]) {
      await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(parent), 'synthetic-tag', Date.now() + 3600_000).run();
      cookies[id] = `${sessionCookieName}=${parent}`;
    }
    const request = (path, method = 'GET', value, who = 'one', headers = {}) => mf.dispatchFetch(origin + '/api/memory' + path, { method, headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json', ...headers }, ...(value === undefined ? {} : { body: value instanceof Uint8Array ? value : JSON.stringify(value) }) });
    for (const id of ['one', 'two']) {
      const response = await request('/identity', 'POST', { id }, id);
      assert.equal(response.status, 200, await response.clone().text()); cookies[id] += `; ${response.headers.get('Set-Cookie').split(';')[0]}`;
    }
    assert.equal((await request('/stories/runtime-story', 'PUT', story())).status, 200);
    const memo = await request('/places/runtime-memo', 'PUT', { expectedVersion: 0, name: '没有坐标的地点备忘', lat: null, lng: null, year: 2027, storyIds: ['runtime-story'], wishIds: [] });
    assert.equal(memo.status, 200); assert.equal((await memo.json()).places[0].lat, null);
    const wav = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]);
    const upload = await request('/audio?storyId=runtime-story', 'POST', wav, 'one', { 'Content-Type': 'audio/wav', 'X-Audio-Duration': '1' });
    assert.equal(upload.status, 201, await upload.clone().text()); const audio = await upload.json();
    assert.equal((await request('/stories/runtime-story/part', 'PUT', part('runtime-private', { submitted: true, audioIds: [audio.id] }))).status, 200);
    assert.equal((await request(`/audio/${audio.id}`, 'GET', undefined, 'two')).status, 404);
    assert.equal((await request('/stories/runtime-story/part', 'PUT', part('partner-private', { submitted: true }), 'two')).status, 200);
    assert.equal((await request('/stories/runtime-story/part', 'PUT', part('stale'))).status, 409);
    const result = await request(`/audio/${audio.id}`, 'GET', undefined, 'two');
    assert.equal(result.status, 200); assert.deepEqual(new Uint8Array(await result.arrayBuffer()), wav);
    const races = await Promise.all(['first', 'second'].map(content => request('/stories/runtime-story/part', 'PUT', part(content, { expectedVersion: 1, submitted: true, audioIds: [audio.id] }))));
    assert.deepEqual(races.map(response => response.status).sort(), [200, 409]);
  } finally { await mf.dispose(); }
});
