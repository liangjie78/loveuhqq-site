import { digest, hex, passwordIterations, randomToken, readSessionToken, verifyPassword } from './auth.ts';
import { isCalendarDate } from '../src/lib/notebook.ts';
import { audioMaxBytes, audioMaxSeconds } from '../src/lib/memory-book.ts';
import type { MemoryBootstrap, MemoryLetter, MemoryMember, MemoryStory, MemberId, StoryPart } from '../src/lib/memory-book.ts';

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
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
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
  return row ? { id: row.id, name: row.name, sessionHash, parentHash: parent.hash, expiresAt: Math.min(row.expires_at, parent.expiresAt) } : null;
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
  const row = await one(db, 'SELECT manifest FROM photo_manifest WHERE id = 1');
  const manifest = row ? JSON.parse(row.manifest) : store ? await store.get('manifest.json', 'json') as Row | null : null;
  const existing = new Set((manifest?.photos ?? []).map((x: Row) => x.id));
  if (values.some(id => !existing.has(id))) fail(400, '关联照片不存在。');
}
async function checkAudio(db: D1Database, values: string[], actor: MemoryActor, kind: 'story' | 'letter', id: string) {
  for (const audioId of values) if (!await one(db, `SELECT id FROM memory_audio WHERE id = ? AND owner_id = ? AND ${kind}_id = ?`, audioId, actor.id, id)) fail(400, '语音与当前内容不匹配。');
}
async function cas(db: D1Database, table: string, id: string, expected: number, fields: Record<string, unknown>, extraWhere = '', extraArgs: unknown[] = []) {
  // Table/column names come only from hard-coded internal call sites.
  const keys = Object.keys(fields);
  const result = expected === 0
    ? await db.prepare(`INSERT INTO ${table} (id,version,${keys.join(',')}) VALUES (?,1,${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO NOTHING RETURNING version`).bind(id, ...Object.values(fields)).first()
    : await db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(',')}, version = version + 1 WHERE id = ? AND version = ? ${extraWhere} RETURNING version`).bind(...Object.values(fields), id, expected, ...extraArgs).first();
  if (!result) fail(409, '内容已在其他设备更新，请刷新后重试。');
}
function projectedStory(row: Row, parts: Row[], actor: MemoryActor): MemoryStory {
  const opened = !row.reveal_together || row.opened_at !== null;
  return { id: row.id, version: row.version, title: row.title, date: row.date, text: row.text, photoIds: arr(row.photo_ids), wishIds: arr(row.wish_ids), layout: row.layout,
    revealTogether: !!row.reveal_together, openedAt: row.opened_at, parts: parts.map((part): StoryPart => ({ memberId: part.member_id, version: part.version, submitted: !!part.submitted,
      ...(opened || part.member_id === actor.id ? { text: part.text, reply: part.reply, audioIds: arr(part.audio_ids) } : {}) })) };
}
function letterReady(row: Row, all: Row[]): boolean {
  if (row.status !== 'sealed' || row.open_date > today()) return false;
  if (!row.pair_key) return true;
  return all.some(other => other.id !== row.id && other.pair_key === row.pair_key && other.sender_id === row.recipient_id && other.recipient_id === row.sender_id && other.status === 'sealed' && other.open_date === row.open_date);
}
function projectedLetter(row: Row, all: Row[], actor: MemoryActor): MemoryLetter {
  const readable = row.sender_id === actor.id || row.recipient_id === actor.id && letterReady(row, all);
  return { id: row.id, version: row.version, senderId: row.sender_id, recipientId: row.recipient_id, title: row.title, openDate: row.open_date, pairKey: row.pair_key, status: row.status,
    sealedAt: row.sealed_at, readable, ...(readable ? { text: row.text, audioIds: arr(row.audio_ids) } : {}) };
}
export async function memoryBootstrap(request: Request, db: D1Database): Promise<MemoryBootstrap> {
  const actor = await memoryActor(request, db);
  const members = await rows(db, 'SELECT id,name FROM memory_members ORDER BY id') as MemoryMember[];
  if (!actor) return { member: null, members, stories: [], letters: [], places: [], wishPlans: [] };
  const [stories, parts, letters, places, plans] = await Promise.all([
    rows(db, 'SELECT * FROM memory_stories ORDER BY date DESC,id'), rows(db, 'SELECT * FROM memory_parts'), rows(db, 'SELECT * FROM memory_letters ORDER BY open_date,id'),
    rows(db, 'SELECT * FROM memory_places ORDER BY year DESC,name'), rows(db, 'SELECT * FROM memory_wish_plans'),
  ]);
  return { member: { id: actor.id, name: actor.name }, members,
    stories: stories.map(story => projectedStory(story, parts.filter(p => p.story_id === story.id), actor)),
    letters: letters.filter(letter => letter.sender_id === actor.id || letter.status === 'sealed' && letter.recipient_id === actor.id).map(letter => projectedLetter(letter, letters, actor)),
    places: places.map(place => ({ id: place.id, version: place.version, name: place.name, lat: place.lat, lng: place.lng, year: place.year, storyIds: arr(place.story_ids), wishIds: arr(place.wish_ids) })),
    wishPlans: plans.map(plan => ({ id: plan.id, version: plan.version, plannedDate: plan.planned_date, storyId: plan.story_id })) };
}
async function passwordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: passwordIterations, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${passwordIterations}$${hex(salt)}$${hex(new Uint8Array(hash))}`;
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
  // Use the existing atomic rate-limit table, independently from shared-password attempts.
  const now = Date.now(); const client = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
  const permitted = await db.prepare(`INSERT INTO login_limits(client_hash,window_until,attempts) VALUES(?,?,1) ON CONFLICT(client_hash) DO UPDATE SET
    window_until = CASE WHEN window_until <= ? THEN excluded.window_until ELSE window_until END,
    attempts = CASE WHEN window_until <= ? THEN 1 ELSE attempts + 1 END WHERE window_until <= ? OR attempts < 10 RETURNING attempts`)
    .bind(await digest(`memory-login:${client}`), now + 900000, now, now, now).first();
  if (!permitted) return fail(429, '尝试次数过多，请 15 分钟后再试。');
  const value = await body(request, ['action', 'id', 'password'], ['name']);
  if (!memberId(value.id) || !['register', 'login'].includes(value.action)) return fail(400, '身份操作无效。');
  const password = text(value.password, 128);
  if (password.length < 8) return fail(400, '个人口令应为 8–128 个字符。');
  if (value.action === 'register') {
    const name = text(value.name, 30).trim();
    const created = await db.prepare('INSERT INTO memory_members(id,name,password_hash) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(value.id, name, await passwordHash(password)).first();
    if (!created) return fail(409, '这个身份已设置，请用个人口令登录。');
  } else {
    const member = await one(db, 'SELECT password_hash FROM memory_members WHERE id = ?', value.id);
    if (!member || !await verifyPassword(password, member.password_hash)) return fail(401, '身份或个人口令不正确。');
  }
  const token = randomToken(); const hash = await digest(token); const age = Math.max(0, Math.floor((parent.expiresAt - now) / 1000));
  await db.batch([db.prepare('DELETE FROM memory_sessions WHERE parent_hash = ? OR expires_at <= ?').bind(parent.hash, now),
    db.prepare('INSERT INTO memory_sessions(token_hash,parent_hash,member_id,expires_at) VALUES(?,?,?,?)').bind(hash, parent.hash, value.id, parent.expiresAt)]);
  // Read using an explicit single fresh cookie, avoiding stale-cookie ambiguity.
  const headers = new Headers(request.headers);
  headers.set('Cookie', (request.headers.get('Cookie') ?? '').split(';').map(x => x.trim()).filter(x => !x.startsWith(`${personalCookie}=`)).concat(`${personalCookie}=${token}`).join('; '));
  return json(await memoryBootstrap(new Request(request.url, { headers }), db), 200, { 'Set-Cookie': cookie(token, age) });
}
async function saveStory(request: Request, env: MemoryEnv, actor: MemoryActor, id: string) {
  const value = await body(request, ['expectedVersion', 'title', 'date', 'text', 'photoIds', 'wishIds', 'layout', 'revealTogether']);
  const expected = version(value.expectedVersion); const title = text(value.title, 120); const content = text(value.text, 10000, true);
  if (!isCalendarDate(value.date) || !['journal', 'album', 'letter'].includes(value.layout) || typeof value.revealTogether !== 'boolean') fail(400, '故事日期或排版无效。');
  const photos = ids(value.photoIds); const wishes = ids(value.wishIds);
  await checkPhotos(env.DB, env.PHOTOS, photos); await checkWishes(env.DB, wishes);
  const current = await one(env.DB, 'SELECT * FROM memory_stories WHERE id = ?', id);
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
  const statements = [db.prepare(`INSERT INTO memory_parts(story_id,member_id,version,text,reply,submitted,audio_ids)
    SELECT ?,?,1,?,?,?,? WHERE COALESCE((SELECT version FROM memory_parts WHERE story_id = ? AND member_id = ?),0) = ?
    ON CONFLICT(story_id,member_id) DO UPDATE SET version=version+1,text=excluded.text,reply=excluded.reply,submitted=excluded.submitted,audio_ids=excluded.audio_ids WHERE version = ? RETURNING version`)
    .bind(id, actor.id, content, reply, value.submitted ? 1 : 0, JSON.stringify(audio), id, actor.id, expected, expected),
    db.prepare(`UPDATE memory_stories SET opened_at = ? WHERE id = ? AND reveal_together = 1 AND opened_at IS NULL
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
  await cas(db, 'memory_letters', id, expected, { sender_id: actor.id, recipient_id: value.recipientId, title, text: content, open_date: value.openDate, pair_key: pair, audio_ids: JSON.stringify(audio), status: 'draft' }, 'AND sender_id = ? AND status = ?', [actor.id, 'draft']);
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
  if (!Number.isFinite(value.lat) || Math.abs(value.lat) > 90 || !Number.isFinite(value.lng) || Math.abs(value.lng) > 180 || !Number.isInteger(value.year) || value.year < 1900 || value.year > 9999) fail(400, '地点坐标或年份无效。');
  const stories = ids(value.storyIds); const wishes = ids(value.wishIds); await checkStories(db, stories); await checkWishes(db, wishes);
  await cas(db, 'memory_places', id, expected, { name, lat: value.lat, lng: value.lng, year: value.year, story_ids: JSON.stringify(stories), wish_ids: JSON.stringify(wishes) });
}
async function saveWishPlan(request: Request, db: D1Database, id: string) {
  const value = await body(request, ['expectedVersion', 'plannedDate', 'storyId']);
  const expected = version(value.expectedVersion); await checkWishes(db, [id]);
  if (value.plannedDate !== null && !isCalendarDate(value.plannedDate) || value.storyId !== null && (typeof value.storyId !== 'string' || !validId.test(value.storyId))) fail(400, '计划日期或故事编号无效。');
  if (value.storyId) await ensureStory(db, value.storyId);
  await cas(db, 'memory_wish_plans', id, expected, { planned_date: value.plannedDate, story_id: value.storyId });
}
async function canHear(db: D1Database, audio: Row, actor: MemoryActor): Promise<boolean> {
  if (audio.owner_id === actor.id) return true;
  if (audio.story_id) {
    const story = await ensureStory(db, audio.story_id);
    const part = await one(db, 'SELECT audio_ids FROM memory_parts WHERE story_id = ? AND member_id = ?', audio.story_id, audio.owner_id);
    return (!story.reveal_together || story.opened_at !== null) && !!part && arr(part.audio_ids).includes(audio.id);
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
async function audioRequest(request: Request, env: MemoryEnv, actor: MemoryActor, id?: string): Promise<Response> {
  const { DB: db, PHOTOS: store } = env;
  if (!store) fail(503, '语音存储暂时不可用。');
  if (request.method === 'GET' && id) {
    const audio = await one(db, 'SELECT * FROM memory_audio WHERE id = ?', id) ?? fail(404, '语音不存在。');
    if (!await canHear(db, audio, actor)) fail(404, '语音不存在或尚未开放。');
    const output = await store!.get(`audio/${id}`, 'arrayBuffer');
    if (!output || output.byteLength !== audio.bytes) fail(503, '语音仍在同步，请稍后重试。');
    return new Response(output, { headers: { 'Content-Type': audio.mime, 'Content-Length': String(output!.byteLength), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
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
  const count = await one(db, 'SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS total FROM memory_audio');
  if (count && (count.count >= 300 || count.total + data.length > 256 * 1024 * 1024)) fail(422, '语音空间已达到当前上限。');
  const audioId = crypto.randomUUID();
  await store!.put(`audio/${audioId}`, data);
  try {
    const inserted = await db.prepare(`INSERT INTO memory_audio(id,owner_id,story_id,letter_id,mime,bytes,duration)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM memory_audio) < 300 AND
      (SELECT COALESCE(SUM(bytes),0) FROM memory_audio) + ? <= ? RETURNING id`)
      .bind(audioId, actor.id, story, letterId, mime, data.length, duration, data.length, 256 * 1024 * 1024).first();
    if (!inserted) fail(422, '语音空间已达到当前上限。');
  } catch (error) { await store!.delete(`audio/${audioId}`); throw error; }
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
    if (request.method === 'PUT' && collection === 'stories' && !action) await saveStory(request, env, actor!, id);
    else if (request.method === 'PUT' && collection === 'stories' && action === 'part') await savePart(request, env.DB, actor!, id);
    else if (request.method === 'PUT' && collection === 'letters' && !action) await saveLetter(request, env.DB, actor!, id);
    else if (request.method === 'POST' && collection === 'letters' && (action === 'seal' || action === 'withdraw')) await letterAction(request, env.DB, actor!, id, action);
    else if (request.method === 'PUT' && collection === 'places' && !action) await savePlace(request, env.DB, id);
    else if (request.method === 'PUT' && collection === 'wishPlans' && !action) await saveWishPlan(request, env.DB, id);
    else fail(405, '方法不支持。');
    return json(await memoryBootstrap(request, env.DB));
  } catch (error) { return error instanceof Failure ? json({ error: error.message }, error.status) : json({ error: '回忆册暂时不可用，请稍后重试。' }, 503); }
}
