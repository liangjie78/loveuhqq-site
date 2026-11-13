import { digest, randomToken, readSessionToken } from './auth.ts';
import { isCalendarDate } from '../src/lib/notebook.ts';
import { getShanghaiDate } from '../src/lib/anniversary.ts';
import { ensureAlbum, readAlbum } from './album.ts';
import { albumClock, albumRevisionSql } from './album-sql.ts';
import { audioMaxBytes, audioMaxSeconds } from '../src/lib/memory-book.ts';
import type { MemoryBootstrap, MemoryLetter, MemoryMember, MemoryStory, MemorySync, MemberId, StoryPart } from '../src/lib/memory-book.ts';

interface MemoryEnv { DB: D1Database; PHOTOS?: KVNamespace }
export interface MemoryActor extends MemoryMember { sessionHash: string; parentHash: string; expiresAt: number }
type Row = Record<string, any>;
const personalCookie = '__Host-loveuhqq_member';
const validId = /^[a-zA-Z0-9-]{1,80}$/;
class Failure extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const fail = (status: number, message: string): never => { throw new Failure(status, message); };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const cookie = (token: string, age: number) => `${personalCookie}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const memberId = (id: unknown): id is MemberId => id === 'one' || id === 'two';
const arr = (value: string): string[] => JSON.parse(value);
const today = () => getShanghaiDate(new Date());
const audioGraceMs = 7 * 24 * 60 * 60 * 1000;
const audioAvailable = 'NOT EXISTS (SELECT value FROM json_each(?) WHERE value NOT IN (SELECT id FROM memory_audio WHERE reclaiming = 0))';
function tokenFrom(request: Request): string | null {
  const tokens = (request.headers.get('Cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${personalCookie}=`));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(personalCookie.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
async function parentSession(request: Request, db: D1Database) {
  const token = readSessionToken(request);
  if (!token) return null;
  const hash = await digest(token);
  const row = await db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(hash, Date.now()).first<Row>();
  return row ? { hash, expiresAt: Number(row.expires_at) } : null;
}
/** Requires the caller to validate the shared credential tag before dispatching. Parent expiry/logout is checked again here. */
export async function memoryActor(request: Request, db: D1Database): Promise<MemoryActor | null> {
  const token = tokenFrom(request);
  if (!token) return null;
  const parent = await parentSession(request, db);
  if (!parent) return null;
  const sessionHash = await digest(token);
  const row = await db.prepare(`SELECT m.id, m.name, s.expires_at FROM memory_sessions s JOIN memory_members m ON m.id = s.member_id
    WHERE s.token_hash = ? AND s.parent_hash = ? AND s.expires_at > ?`).bind(sessionHash, parent.hash, Date.now()).first<Row>();
  return row ? { id: row.id, name: row.id === 'one' ? '男生' : '女生', sessionHash, parentHash: parent.hash, expiresAt: Math.min(row.expires_at, parent.expiresAt) } : null;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(400, '文字为空或过长。');
  return value as string;
}
function ids(value: unknown, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max || !value.every(x => typeof x === 'string' && validId.test(x)) || new Set(value).size !== value.length) fail(400, '关联编号无效。');
  return value as string[];
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) fail(400, '版本号无效。');
  return Number(value);
}
async function bytes(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) fail(413, '内容过大。');
  const reader = request.body?.getReader();
  if (!reader) return fail(400, '缺少内容。');
  const parts: Uint8Array[] = []; let length = 0;
  try { for (;;) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > limit) { await reader.cancel(); fail(413, '内容过大。'); } parts.push(result.value); } }
  finally { reader.releaseLock(); }
  const output = new Uint8Array(length); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
async function body(request: Request, keys: string[], optional: string[] = []): Promise<Row> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) fail(415, '请使用 JSON 格式。');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await bytes(request, 65536))); }
  catch (error) { if (error instanceof Failure) throw error; return fail(400, '内容格式无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keys.every(k => Object.hasOwn(value, k)) || !Object.keys(value).every(k => [...keys, ...optional].includes(k))) fail(400, '内容字段无效。');
  return value as Row;
}
async function rows(db: D1Database, sql: string, ...values: unknown[]): Promise<Row[]> { return (await db.prepare(sql).bind(...values).all<Row>()).results; }
async function one(db: D1Database, sql: string, ...values: unknown[]): Promise<Row | null> { return db.prepare(sql).bind(...values).first<Row>(); }
async function ensureStory(db: D1Database, id: string) { return await one(db, 'SELECT * FROM memory_stories WHERE id = ?', id) ?? fail(404, '故事不存在。'); }
async function checkStories(db: D1Database, values: string[]) { for (const id of values) await ensureStory(db, id); }
async function checkWishes(db: D1Database, values: string[]) { for (const id of values) if (!await one(db, "SELECT entry_key FROM notebook_entries WHERE kind = 'wish' AND entry_key = ? AND deleted = 0", id)) fail(400, '愿望不存在或已取下。'); }
async function checkPhotos(db: D1Database, store: KVNamespace | undefined, values: string[]) {
  if (!values.length) return;
  await ensureAlbum(db, store);
  const result = await one(db, `SELECT COUNT(*) AS count FROM album_photos
    WHERE removed_at IS NULL AND id IN (SELECT value FROM json_each(?))`, JSON.stringify(values));
  if (result?.count !== values.length) fail(400, '关联照片不存在。');
}
async function checkAudio(db: D1Database, values: string[], actor: MemoryActor, kind: 'story' | 'letter', id: string) {
  if (!values.length) return;
  const result = await one(db, `SELECT COUNT(*) AS count FROM memory_audio WHERE owner_id = ? AND ${kind}_id = ? AND reclaiming = 0
    AND id IN (SELECT value FROM json_each(?))`, actor.id, id, JSON.stringify(values));
  if (result?.count !== values.length) fail(400, '语音与当前内容不匹配或已清理。');
}
async function cas(db: D1Database, table: string, id: string, expected: number, fields: Record<string, unknown>, extraWhere = '', extraArgs: unknown[] = [], insertCondition?: { sql: string; args: unknown[] }) {
  // Table/column names come only from hard-coded internal call sites.
  const keys = Object.keys(fields);
  const result = expected === 0
    ? await db.prepare(`INSERT INTO ${table} (id,version,${keys.join(',')}) SELECT ?,1,${keys.map(() => '?').join(',')}
      WHERE ${insertCondition?.sql ?? '1'} ON CONFLICT(id) DO NOTHING RETURNING version`).bind(id, ...Object.values(fields), ...(insertCondition?.args ?? [])).first()
    : await db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(',')}, version = version + 1 WHERE id = ? AND version = ? ${extraWhere} RETURNING version`).bind(...Object.values(fields), id, expected, ...extraArgs).first();
  if (!result) fail(409, '内容已在其他设备更新，请刷新后重试。');
}
function projectedStory(row: Row, parts: Row[], actor: MemoryActor): MemoryStory {
  const opened = !row.reveal_together || row.opened_at !== null;
  return { id: row.id, version: row.version, title: row.title, date: row.date, text: row.text, photoIds: arr(row.photo_ids), wishIds: arr(row.wish_ids), layout: row.layout,
    revealTogether: !!row.reveal_together, openedAt: row.opened_at, parts: parts.map((part): StoryPart => ({ memberId: part.member_id, version: part.version, submitted: !!part.submitted,
      ...(opened || part.member_id === actor.id ? { text: part.text, reply: part.reply, audioIds: arr(part.audio_ids) } : {}) })) };
}
function letterReady(row: Row, all: Row[], day = today()): boolean {
  if (row.status !== 'sealed' || row.open_date > day) return false;
  if (!row.pair_key) return true;
  return all.some(other => other.id !== row.id && other.pair_key === row.pair_key && other.sender_id === row.recipient_id && other.recipient_id === row.sender_id && other.status === 'sealed' && other.open_date === row.open_date);
}
function projectedLetter(row: Row, all: Row[], actor: MemoryActor, day = today()): MemoryLetter {
  const readable = row.sender_id === actor.id || row.recipient_id === actor.id && letterReady(row, all, day);
  return { id: row.id, version: row.version, senderId: row.sender_id, recipientId: row.recipient_id, title: row.title, openDate: row.open_date, pairKey: row.pair_key, status: row.status,
    sealedAt: row.sealed_at, readable, ...(readable ? { text: row.text, audioIds: arr(row.audio_ids) } : {}) };
}
async function memoryBootstrap(request: Request, db: D1Database, actor: MemoryActor | null = null): Promise<MemoryBootstrap> {
  actor ??= await memoryActor(request, db);
  const members = await rows(db, "SELECT id, CASE id WHEN 'one' THEN '男生' ELSE '女生' END AS name FROM memory_members ORDER BY id") as MemoryMember[];
  if (!actor) return { member: null, members, stories: [], letters: [], places: [], wishPlans: [] };
  const day = today();
  const [stories, parts, letters, places, plans, wishes, revisions] = (await db.batch<Row>([
    db.prepare('SELECT * FROM memory_stories ORDER BY date DESC,id'), db.prepare('SELECT * FROM memory_parts'), db.prepare('SELECT * FROM memory_letters ORDER BY open_date,id'),
    db.prepare('SELECT * FROM memory_places ORDER BY year DESC,name'), db.prepare('SELECT * FROM memory_wish_plans'),
    db.prepare("SELECT entry_key, text, done, version FROM notebook_entries WHERE kind = 'wish' AND deleted = 0 ORDER BY rowid"),
    db.prepare('SELECT revision FROM memory_change WHERE id = 1'),
  ])).map(result => result.results);
  const partsByStory = new Map<string, Row[]>();
  for (const part of parts) {
    const group = partsByStory.get(part.story_id);
    if (group) group.push(part);
    else partsByStory.set(part.story_id, [part]);
  }
  return { member: { id: actor.id, name: actor.name }, members, revision: revisions[0].revision, day,
    wishes: wishes.map(wish => ({ id: wish.entry_key, text: wish.text, done: !!wish.done })),
    wishRevisions: Object.fromEntries(wishes.map(wish => [wish.entry_key, wish.version])),
    stories: stories.map(story => projectedStory(story, partsByStory.get(story.id) ?? [], actor)),
    letters: letters.filter(letter => letter.sender_id === actor.id || letter.status === 'sealed' && letter.recipient_id === actor.id).map(letter => projectedLetter(letter, letters, actor, day)),
    places: places.map(place => ({ id: place.id, version: place.version, name: place.name, lat: place.lat, lng: place.lng, year: place.year, storyIds: arr(place.story_ids), wishIds: arr(place.wish_ids) })),
    wishPlans: plans.map(plan => ({ id: plan.id, version: plan.version, plannedDate: plan.planned_date, storyId: plan.story_id })) };
}

async function syncMemory(request: Request, env: MemoryEnv): Promise<Response> {
  const { DB: db, PHOTOS: store } = env;
  const actor = await memoryActor(request, db);
  const query = new URL(request.url).searchParams;
  const day = today();
  if (!actor) {
    const book = query.get('member') === '' ? undefined : await memoryBootstrap(request, db);
    return json({ memberId: null, revision: 0, day, photoRevision: null, book } satisfies MemorySync);
  }
  const [state, photos] = await db.batch<{ revision: number }>([
    db.prepare('SELECT revision FROM memory_change WHERE id = 1'), db.prepare(albumRevisionSql),
  ]);
  const revision = state.results[0].revision;
  const photoRevision = photos.results[0]?.revision ?? null;
  const sameMember = query.get('member') === actor.id;
  const book = sameMember && query.get('revision') === String(revision) && query.get('day') === day
    ? undefined : await memoryBootstrap(request, db, actor);
  const album = store && (photoRevision === null || !sameMember || query.get('photos') !== String(photoRevision)) ? await readAlbum(db, store) : undefined;
  return json({ memberId: actor.id, revision: book?.revision ?? revision, day: book?.day ?? day, photoRevision: album?.revision ?? photoRevision, book, album } satisfies MemorySync);
}
async function identity(request: Request, db: D1Database): Promise<Response> {
  if (request.method === 'GET') return json(await memoryBootstrap(request, db));
  if (request.method === 'DELETE') {
    const parent = await parentSession(request, db);
    if (parent) await db.prepare('DELETE FROM memory_sessions WHERE parent_hash = ?').bind(parent.hash).run();
    return json(await memoryBootstrap(request, db), 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (request.method !== 'POST') return fail(405, '方法不支持。');
  const parent = await parentSession(request, db);
  if (!parent) return fail(401, '请先登录手账。');
  const now = Date.now();
  const value = await body(request, ['id']);
  if (!memberId(value.id)) return fail(400, '请选择男生或女生。');
  // These are selectable signatures within the shared gate, not separate security identities.
  await db.batch(['one', 'two'].map(id => db.prepare('INSERT INTO memory_members(id,name,password_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(id, id === 'one' ? '男生' : '女生', 'disabled')));
  const token = randomToken(); const hash = await digest(token); const age = Math.max(0, Math.floor((parent.expiresAt - now) / 1000));
  await db.batch([db.prepare('DELETE FROM memory_sessions WHERE parent_hash = ? OR expires_at <= ?').bind(parent.hash, now),
    db.prepare('INSERT INTO memory_sessions(token_hash,parent_hash,member_id,expires_at) VALUES(?,?,?,?)').bind(hash, parent.hash, value.id, parent.expiresAt)]);
  // Read using an explicit single fresh cookie, avoiding stale-cookie ambiguity.
  const headers = new Headers(request.headers);
  headers.set('Cookie', (request.headers.get('Cookie') ?? '').split(';').map(x => x.trim()).filter(x => !x.startsWith(`${personalCookie}=`)).concat(`${personalCookie}=${token}`).join('; '));
  return json(await memoryBootstrap(new Request(request.url, { headers }), db), 200, { 'Set-Cookie': cookie(token, age) });
}
async function saveStory(request: Request, env: MemoryEnv, id: string) {
  const value = await body(request, ['expectedVersion', 'title', 'date', 'text', 'photoIds', 'wishIds', 'layout', 'revealTogether']);
  const expected = version(value.expectedVersion); const title = text(value.title, 120); const content = text(value.text, 10000, true);
  if (!isCalendarDate(value.date) || !['journal', 'album', 'letter'].includes(value.layout) || typeof value.revealTogether !== 'boolean') fail(400, '故事日期或排版无效。');
  const photos = ids(value.photoIds); const wishes = ids(value.wishIds);
  const current = await one(env.DB, 'SELECT * FROM memory_stories WHERE id = ?', id);
  if ((current?.version ?? 0) !== expected) fail(409, '内容已在其他设备更新，请刷新后重试。');
  const oldPhotos = new Set(current ? arr(current.photo_ids) : []);
  const oldWishes = new Set(current ? arr(current.wish_ids) : []);
  await checkPhotos(env.DB, env.PHOTOS, photos.filter(photo => !oldPhotos.has(photo)));
  await checkWishes(env.DB, wishes.filter(wish => !oldWishes.has(wish)));
  // Revelation mode cannot change once anyone has written, preventing a metadata edit from exposing a private draft.
  if (current && !!current.reveal_together !== value.revealTogether && await one(env.DB, 'SELECT story_id FROM memory_parts WHERE story_id = ? LIMIT 1', id)) fail(409, '已有双人段落后不能更改揭晓模式。');
  await cas(env.DB, 'memory_stories', id, expected, { title, date: value.date, text: content, photo_ids: JSON.stringify(photos), wish_ids: JSON.stringify(wishes), layout: value.layout, reveal_together: value.revealTogether ? 1 : 0 },
    'AND (reveal_together = ? OR NOT EXISTS (SELECT 1 FROM memory_parts WHERE story_id = ?))', [value.revealTogether ? 1 : 0, id]);
}
async function savePart(request: Request, db: D1Database, actor: MemoryActor, id: string) {
  await ensureStory(db, id);
  const value = await body(request, ['expectedVersion', 'text', 'reply', 'submitted', 'audioIds']);
  const expected = version(value.expectedVersion); const content = text(value.text, 10000, true); const reply = text(value.reply, 3000, true); const audio = ids(value.audioIds, 10);
  if (typeof value.submitted !== 'boolean' || value.submitted && !content.trim() && !audio.length) fail(400, '请先写下内容或保存语音再提交。');
  await checkAudio(db, audio, actor, 'story', id);
  const audioIds = JSON.stringify(audio);
  const statements = [db.prepare(`INSERT INTO memory_parts(story_id,member_id,version,text,reply,submitted,audio_ids)
    SELECT ?,?,1,?,?,?,? WHERE COALESCE((SELECT version FROM memory_parts WHERE story_id = ? AND member_id = ?),0) = ?
    AND ${audioAvailable}
    ON CONFLICT(story_id,member_id) DO UPDATE SET version=version+1,text=excluded.text,reply=excluded.reply,submitted=excluded.submitted,audio_ids=excluded.audio_ids WHERE version = ? RETURNING version`)
    .bind(id, actor.id, content, reply, value.submitted ? 1 : 0, audioIds, id, actor.id, expected, audioIds, expected),
    db.prepare(`UPDATE memory_stories SET opened_at = ? WHERE id = ? AND reveal_together = 1 AND opened_at IS NULL AND changes() = 1
      AND (SELECT COUNT(*) FROM memory_parts WHERE story_id = ? AND submitted = 1) = 2`).bind(Date.now(), id, id)];
  const result = await db.batch(statements);
  if (!result[0].results.length) fail(409, '你的段落已更新，请刷新后重试。');
}
async function saveLetter(request: Request, db: D1Database, actor: MemoryActor, id: string) {
  const value = await body(request, ['expectedVersion', 'title', 'text', 'recipientId', 'openDate', 'pairKey', 'audioIds']);
  const expected = version(value.expectedVersion); const title = text(value.title, 120); const content = text(value.text, 20000, true); const pair = text(value.pairKey, 80, true);
  if (!memberId(value.recipientId) || !isCalendarDate(value.openDate)) fail(400, '收件人或日期无效。');
  const audio = ids(value.audioIds, 10); await checkAudio(db, audio, actor, 'letter', id);
  const current = await one(db, 'SELECT sender_id,status FROM memory_letters WHERE id = ?', id);
  if (current && current.sender_id !== actor.id) fail(403, '只能修改自己写的信。');
  if (current?.status === 'sealed') fail(409, '封存后的信不能修改，请先撤回。');
  const audioIds = JSON.stringify(audio);
  await cas(db, 'memory_letters', id, expected, { sender_id: actor.id, recipient_id: value.recipientId, title, text: content, open_date: value.openDate, pair_key: pair, audio_ids: audioIds, status: 'draft' },
    `AND sender_id = ? AND status = 'draft' AND ${audioAvailable}`, [actor.id, audioIds], { sql: audioAvailable, args: [audioIds] });
}
async function letterAction(request: Request, db: D1Database, actor: MemoryActor, id: string, action: string) {
  const value = await body(request, ['expectedVersion']); const expected = version(value.expectedVersion);
  const current = await one(db, 'SELECT * FROM memory_letters WHERE id = ?', id) ?? fail(404, '信件不存在。');
  if (current.sender_id !== actor.id) fail(403, '只能操作自己写的信。');
  if (action === 'seal') {
    if (current.status !== 'draft' || !current.text.trim() && !arr(current.audio_ids).length) fail(409, '请写好信再封存。');
    if (!await one(db, 'SELECT id FROM memory_members WHERE id = ?', current.recipient_id)) fail(400, '请先让收件人设置个人身份。');
    await cas(db, 'memory_letters', id, expected, { status: 'sealed', sealed_at: Date.now() }, "AND sender_id = ? AND status = 'draft'", [actor.id]);
  } else {
    if (current.status !== 'sealed' || current.open_date <= today()) fail(409, '只有拆信日前可以撤回封存。');
    await cas(db, 'memory_letters', id, expected, { status: 'draft', sealed_at: null }, "AND sender_id = ? AND status = 'sealed' AND open_date > ?", [actor.id, today()]);
  }
}
async function savePlace(request: Request, db: D1Database, id: string) {
  const value = await body(request, ['expectedVersion', 'name', 'lat', 'lng', 'year', 'storyIds', 'wishIds']);
  const expected = version(value.expectedVersion); const name = text(value.name, 120);
  const coordinatesValid = value.lat === null && value.lng === null ||
    typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 &&
    typeof value.lng === 'number' && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
  if (!coordinatesValid || !Number.isInteger(value.year) || value.year < 1900 || value.year > 9999) fail(400, '地点坐标或年份无效。');
  const stories = ids(value.storyIds); const wishes = ids(value.wishIds);
  const current = expected > 0 ? await one(db, 'SELECT story_ids, wish_ids FROM memory_places WHERE id = ? AND version = ?', id, expected) : null;
  if (expected > 0 && !current) fail(409, '内容已在其他设备更新，请刷新后重试。');
  const oldStories = new Set(current ? arr(current.story_ids) : []);
  const oldWishes = new Set(current ? arr(current.wish_ids) : []);
  await checkStories(db, stories.filter(story => !oldStories.has(story)));
  await checkWishes(db, wishes.filter(wish => !oldWishes.has(wish)));
  await cas(db, 'memory_places', id, expected, { name, lat: value.lat, lng: value.lng, year: value.year, story_ids: JSON.stringify(stories), wish_ids: JSON.stringify(wishes) });
}
async function saveWishPlan(request: Request, db: D1Database, id: string) {
  const value = await body(request, ['expectedVersion', 'plannedDate', 'storyId'], ['expectedWishVersion', 'done']);
  const expected = version(value.expectedVersion);
  if (value.plannedDate !== null && !isCalendarDate(value.plannedDate) || value.storyId !== null && (typeof value.storyId !== 'string' || !validId.test(value.storyId))) fail(400, '计划日期或故事编号无效。');
  if (value.storyId) await ensureStory(db, value.storyId);
  const withCompletion = Object.hasOwn(value, 'expectedWishVersion') || Object.hasOwn(value, 'done');
  if (withCompletion && typeof value.done !== 'boolean') fail(400, '请选择愿望的完成状态。');
  const expectedWish = withCompletion ? version(value.expectedWishVersion) : null;
  // The second statement uses changes() from the guarded first write in this same D1 transaction.
  const plan = db.prepare(`INSERT INTO memory_wish_plans (id, version, planned_date, story_id)
    SELECT ?, 1, ?, ? WHERE COALESCE((SELECT version FROM memory_wish_plans WHERE id = ?), 0) = ?
      AND EXISTS (SELECT 1 FROM notebook_entries WHERE kind = 'wish' AND entry_key = ? AND deleted = 0 AND (? IS NULL OR version = ?))
    ON CONFLICT(id) DO UPDATE SET version = memory_wish_plans.version + 1, planned_date = excluded.planned_date, story_id = excluded.story_id`)
    .bind(id, value.plannedDate, value.storyId, id, expected, id, expectedWish, expectedWish);
  const writes = [plan];
  if (withCompletion) writes.push(db.prepare(`UPDATE notebook_entries SET done = ?, version = version + 1
    WHERE kind = 'wish' AND entry_key = ? AND done <> ? AND changes() = 1`).bind(Number(value.done), id, Number(value.done)));
  const [saved] = await db.batch(writes);
  if (!saved.meta.changes) fail(409, '愿望或安排已更新，请刷新后重试。');
}
async function canHear(db: D1Database, audio: Row, actor: MemoryActor): Promise<boolean> {
  if (audio.owner_id === actor.id) return true;
  if (audio.story_id) {
    const part = await one(db, `SELECT s.reveal_together,s.opened_at,p.audio_ids FROM memory_stories s
      JOIN memory_parts p ON p.story_id = s.id WHERE s.id = ? AND p.member_id = ?`, audio.story_id, audio.owner_id);
    return !!part && (!part.reveal_together || part.opened_at !== null) && arr(part.audio_ids).includes(audio.id);
  }
  const letter = await one(db, 'SELECT * FROM memory_letters WHERE id = ?', audio.letter_id);
  return !!letter && letter.recipient_id === actor.id && arr(letter.audio_ids).includes(audio.id) && letterReady(letter, await rows(db, 'SELECT * FROM memory_letters'));
}
function audioSignature(data: Uint8Array, mime: string): boolean {
  const ascii = (start: number, count: number) => String.fromCharCode(...data.slice(start, start + count));
  if (mime === 'audio/webm') return data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime === 'audio/mp4') return ascii(4, 4) === 'ftyp';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
  if (mime === 'audio/mpeg') return ascii(0, 3) === 'ID3' || data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
  return false;
}
const audioUnattached = `NOT EXISTS (
  SELECT 1 FROM memory_parts p, json_each(p.audio_ids) link
  WHERE p.story_id = memory_audio.story_id AND p.member_id = memory_audio.owner_id AND link.value = memory_audio.id
) AND NOT EXISTS (
  SELECT 1 FROM memory_letters l, json_each(l.audio_ids) link
  WHERE l.id = memory_audio.letter_id AND l.sender_id = memory_audio.owner_id AND link.value = memory_audio.id
)`;
async function deleteAudioBytes(db: D1Database, store: KVNamespace, id: string) {
  await store.delete(`audio/${id}`);
  await db.prepare('DELETE FROM memory_audio WHERE id = ?').bind(id).run();
}
export async function sweepOrphanAudio(db: D1Database, store: KVNamespace) {
  const { results } = await db.prepare(`UPDATE memory_audio SET reclaiming = 1 WHERE id IN (
    SELECT id FROM memory_audio WHERE reclaiming = 1 OR (created_at <= ${albumClock} - ? AND ${audioUnattached})
    ORDER BY reclaiming DESC, created_at LIMIT 8
  ) RETURNING id`).bind(audioGraceMs).all<{ id: string }>();
  const deleted = await Promise.allSettled(results.map(({ id }) => deleteAudioBytes(db, store, id)));
  if (deleted.some(result => result.status === 'rejected')) throw new Error('Some audio objects could not be reclaimed');
}
async function audioRequest(request: Request, env: MemoryEnv, actor: MemoryActor, id?: string): Promise<Response> {
  const { DB: db, PHOTOS: store } = env;
  if (!store) return fail(503, '语音存储暂时不可用。');
  if (request.method === 'GET' && id) {
    const audio = await one(db, 'SELECT * FROM memory_audio WHERE id = ? AND reclaiming = 0', id) ?? fail(404, '语音不存在。');
    if (!await canHear(db, audio, actor)) fail(404, '语音不存在或尚未开放。');
    const output = await store.get(`audio/${id}`, 'arrayBuffer');
    if (!output || output.byteLength !== audio.bytes) fail(503, '语音仍在同步，请稍后重试。');
    return new Response(output, { headers: { 'Content-Type': audio.mime, 'Content-Length': String(output!.byteLength), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method === 'DELETE' && id) {
    const claimed = await one(db, `UPDATE memory_audio SET reclaiming = 1 WHERE id = ? AND owner_id = ? AND ${audioUnattached} RETURNING id`, id, actor.id);
    if (!claimed) {
      if (await one(db, 'SELECT id FROM memory_audio WHERE id = ? AND owner_id = ?', id, actor.id)) fail(409, '已经收进正文的录音不能从草稿丢弃。');
      fail(404, '录音不存在。');
    }
    await deleteAudioBytes(db, store, id);
    return json({ deleted: true });
  }
  if (request.method !== 'POST' || id) return fail(405, '方法不支持。');
  const url = new URL(request.url); const story = url.searchParams.get('storyId'); const letterId = url.searchParams.get('letterId');
  if ((!story === !letterId) || !validId.test(story ?? letterId ?? '')) fail(400, '请选择语音所属的故事或信件。');
  if (story) await ensureStory(db, story);
  else {
    const letter = await one(db, 'SELECT sender_id,status FROM memory_letters WHERE id = ?', letterId) ?? fail(404, '请先保存信件草稿。');
    if (letter.sender_id !== actor.id || letter.status !== 'draft') fail(403, '只能为自己的信件草稿保存语音。');
  }
  const duration = Number(request.headers.get('X-Audio-Duration'));
  const mime = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!Number.isFinite(duration) || duration <= 0 || duration > audioMaxSeconds) fail(400, '语音时长应在 60 秒内。');
  const data = await bytes(request, audioMaxBytes);
  if (data.length < 12 || !audioSignature(data, mime)) fail(415, '请上传 WebM、Ogg、M4A、MP3 或 WAV 录音。');
  const audioId = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO memory_audio(id,owner_id,story_id,letter_id,mime,bytes,duration,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM memory_audio) < 300 AND
    (SELECT COALESCE(SUM(bytes),0) FROM memory_audio) + ? <= ? RETURNING id`)
    .bind(audioId, actor.id, story, letterId, mime, data.length, duration, Date.now(), data.length, 256 * 1024 * 1024).first();
  if (!inserted) fail(422, '语音空间已达到当前上限。');
  try {
    await store.put(`audio/${audioId}`, data);
  } catch (error) {
    await db.prepare('UPDATE memory_audio SET reclaiming = 1 WHERE id = ?').bind(audioId).run();
    await deleteAudioBytes(db, store, audioId);
    throw error;
  }
  return json({ id: audioId, mime, bytes: data.length, duration }, 201);
}
/** Dispatch only after the existing shared-session gate. This module additionally checks individual identity. */
export async function handleMemoryRequest(request: Request, env: MemoryEnv): Promise<Response> {
  try {
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')) fail(403, '请从手账页面提交修改。');
    if (!await parentSession(request, env.DB)) fail(401, '请先登录手账。');
    if (path === '/api/memory/identity') return await identity(request, env.DB);
    if (path === '/api/memory/bootstrap' && request.method === 'GET') return json(await memoryBootstrap(request, env.DB));
    if (path === '/api/memory/sync' && request.method === 'GET') return await syncMemory(request, env);
    const actor = await memoryActor(request, env.DB);
    if (!actor) fail(403, '请先进入自己的个人身份。');
    const match = /^\/api\/memory\/(stories|letters|places|wishPlans|audio)(?:\/([a-zA-Z0-9-]{1,80}))?(?:\/(part|seal|withdraw))?$/.exec(path);
    if (!match) fail(404, '接口不存在。');
    const [, collection, id, action] = match!;
    if (collection === 'audio') return await audioRequest(request, env, actor!, id);
    if (!id) fail(404, '缺少内容编号。');
    if (collection === 'letters' && request.method === 'GET' && !action) {
      const all = await rows(env.DB, 'SELECT * FROM memory_letters'); const row = all.find(x => x.id === id);
      if (!row || row.sender_id !== actor!.id && (row.recipient_id !== actor!.id || row.status !== 'sealed')) fail(404, '信件不存在。');
      return json(projectedLetter(row!, all, actor!));
    }
    if (request.method === 'PUT' && collection === 'stories' && !action) await saveStory(request, env, id);
    else if (request.method === 'PUT' && collection === 'stories' && action === 'part') await savePart(request, env.DB, actor!, id);
    else if (request.method === 'PUT' && collection === 'letters' && !action) await saveLetter(request, env.DB, actor!, id);
    else if (request.method === 'POST' && collection === 'letters' && (action === 'seal' || action === 'withdraw')) await letterAction(request, env.DB, actor!, id, action);
    else if (request.method === 'PUT' && collection === 'places' && !action) await savePlace(request, env.DB, id);
    else if (request.method === 'PUT' && collection === 'wishPlans' && !action) await saveWishPlan(request, env.DB, id);
    else fail(405, '方法不支持。');
    return json(await memoryBootstrap(request, env.DB, actor));
  } catch (error) { return error instanceof Failure ? json({ error: error.message }, error.status) : json({ error: '回忆册暂时不可用，请稍后重试。' }, 503); }
}
