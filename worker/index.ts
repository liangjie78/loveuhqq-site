import { isCalendarDate, parseNotebook } from '../src/lib/notebook.ts';
import type { CloudNotebook } from '../src/lib/notebook.ts';
import { getAnniversaryDay } from '../src/lib/anniversary.ts';
import { digest, isPasswordHash, randomToken, readSessionToken, sessionCookie, verifyPassword } from './auth.ts';
import { hundredDayLetter, hundredDayLetterKey, parseLetter } from './letter.ts';
import {
  maxPhotoEdge, maxPhotos, maxPhotoLargeBytes, maxPhotoThumbBytes, photoRestoreMs,
  featuredPhotoCount, maxPhotoTitleLength, maxPhotoUploadBytes, photoIdPattern,
  photoObjectKey, photoSizes,
} from '../src/lib/photos.ts';
import type { PhotoSize } from '../src/lib/photos.ts';
import { activePhotoObject, ensureAlbum, readAlbum, sweepAlbum } from './album.ts';
import { albumClock, uploadGraceMs } from './album-sql.ts';
import { handleMemoryRequest, memoryActor, sweepOrphanAudio } from './memory-book.ts';

type Env = Omit<Cloudflare.Env, "PHOTOS" | "SHARED_DESKTOP"> & { EDITOR_PASSWORD_HASH?: string; PHOTOS?: KVNamespace; SHARED_DESKTOP?: DurableObjectNamespace };
type Entry = { kind: 'note' | 'wish'; entry_key: string; text: string; done: number; version: number; deleted: number };
type JsonObject = Record<string, unknown>;
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}

function assertOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403, '请从手账页面提交修改。');
  }
}

async function body(request: Request, allowed: string[], limit: number): Promise<JsonObject> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, '请使用 JSON 格式。');
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new HttpError(413, '内容过长。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '缺少内容。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, '内容过长。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new HttpError(400, '内容格式无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== allowed.length ||
      !allowed.every((key) => Object.hasOwn(value, key))) throw new HttpError(400, '内容格式无效。');
  return value as JsonObject;
}

async function authenticated(request: Request, db: D1Database, credential: string): Promise<boolean> {
  const token = readSessionToken(request);
  if (!token) return false;
  const row = await db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ? AND credential_tag = ? AND expires_at > ?')
    .bind(await digest(token), await digest(credential), Date.now()).first();
  return row !== null;
}

async function notebook(db: D1Database): Promise<CloudNotebook> {
  const { results } = await db.prepare('SELECT kind, entry_key, text, done, version, deleted FROM notebook_entries ORDER BY kind, rowid').all<Entry>();
  const book: CloudNotebook = { version: 1, notes: {}, wishes: [], revisions: { notes: {}, wishes: {} } };
  for (const entry of results) {
    if (entry.kind === 'note') {
      book.revisions.notes[entry.entry_key] = entry.version;
      if (!entry.deleted) book.notes[entry.entry_key] = entry.text;
    } else {
      book.revisions.wishes[entry.entry_key] = entry.version;
      if (!entry.deleted) book.wishes.push({ id: entry.entry_key, text: entry.text, done: !!entry.done });
    }
  }
  return book;
}

async function login(request: Request, db: D1Database, credential: string): Promise<Response> {
  // Cloudflare overwrites this header at the edge. Missing IPs share a restricted bucket.
  const client = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const limit = await db.prepare(`INSERT INTO login_limits (client_hash, window_until, attempts) VALUES (?, ?, 1)
    ON CONFLICT(client_hash) DO UPDATE SET
      window_until = CASE WHEN login_limits.window_until <= ? THEN excluded.window_until ELSE login_limits.window_until END,
      attempts = CASE WHEN login_limits.window_until <= ? THEN 1 ELSE login_limits.attempts + 1 END
    WHERE login_limits.window_until <= ? OR login_limits.attempts < 10
    RETURNING attempts`).bind(await digest(`login:${client}`), now + windowMs, now, now, now).first();
  if (!limit) return json({ error: '尝试次数过多，请 15 分钟后再试。' }, 429, { 'Retry-After': '900' });
  const value = await body(request, ['password', 'remember'], 2048);
  if (typeof value.password !== 'string' || value.password.length < 6 || value.password.length > 128 || typeof value.remember !== 'boolean') {
    throw new HttpError(400, '密码应为 6–128 个字符。');
  }
  if (!await verifyPassword(value.password, credential)) throw new HttpError(401, '密码不正确。');
  const age = value.remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
  const token = randomToken();
  const previous = readSessionToken(request);
  const statements = [db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM login_limits WHERE window_until <= ?').bind(now)];
  if (previous) statements.push(db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(previous)));
  statements.push(db.prepare('INSERT INTO sessions (token_hash, credential_tag, expires_at) VALUES (?, ?, ?)')
    .bind(await digest(token), await digest(credential), now + age * 1000));
  await db.batch(statements);
  return json({ authenticated: true, configured: true }, 200, { 'Set-Cookie': sessionCookie(token, age) });
}

async function mutate(request: Request, db: D1Database, kind: 'note' | 'wish', key: string): Promise<Response> {
  if (kind === 'note' ? !isCalendarDate(key) : !/^[a-zA-Z0-9-]{1,80}$/.test(key)) throw new HttpError(400, '日期或清单编号无效。');
  const deleted = request.method === 'DELETE' ? 1 : 0;
  const value = await body(request, deleted ? ['expectedVersion'] : kind === 'note' ? ['expectedVersion', 'text'] : ['expectedVersion', 'text', 'done'], kind === 'note' ? 16_384 : 2048);
  if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0 || Number(value.expectedVersion) >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, '版本号无效。');
  }
  if (!deleted) {
    try {
      parseNotebook(JSON.stringify({ version: 1, notes: kind === 'note' ? { [key]: value.text } : {},
        wishes: kind === 'wish' ? [{ id: key, text: value.text, done: value.done }] : [] }));
    } catch { throw new HttpError(400, '内容为空、过长或格式无效。'); }
  }
  const version = Number(value.expectedVersion);
  const text = deleted ? '' : value.text as string;
  const done = kind === 'wish' && !deleted && value.done ? 1 : 0;
  const cap = kind === 'note' ? 3000 : 300;
  // Both CAS and the active-record quota are evaluated inside the same SQLite write.
  const changed = await db.prepare(`INSERT INTO notebook_entries (kind, entry_key, text, done, version, deleted)
    SELECT ?, ?, ?, ?, 1, ? WHERE
      COALESCE((SELECT version FROM notebook_entries WHERE kind = ? AND entry_key = ?), 0) = ? AND
      (? = 1 OR EXISTS (SELECT 1 FROM notebook_entries WHERE kind = ? AND entry_key = ? AND deleted = 0)
        OR (SELECT COUNT(*) FROM notebook_entries WHERE kind = ? AND deleted = 0) < ?)
    ON CONFLICT(kind, entry_key) DO UPDATE SET text = excluded.text, done = excluded.done,
      version = notebook_entries.version + 1, deleted = excluded.deleted
    WHERE notebook_entries.version = ? RETURNING version`)
    .bind(kind, key, text, done, deleted, kind, key, version, deleted, kind, key, kind, cap, version).first();
  if (!changed) {
    const current = await db.prepare('SELECT version FROM notebook_entries WHERE kind = ? AND entry_key = ?').bind(kind, key).first<{ version: number }>();
    if ((current?.version ?? 0) !== version) throw new HttpError(409, '这条记录已在其他设备修改，请刷新后再试。');
    throw new HttpError(422, kind === 'note' ? '备注已达到 3000 条上限。' : '清单已达到 300 条上限。');
  }
  return json(await notebook(db));
}

function expectedPhotoRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, '相册版本号无效。');
  }
  return Number(value);
}

function albumConflict(): never {
  throw new HttpError(409, '相册刚在其他设备更新，请刷新后再改。');
}

async function changePhoto(request: Request, db: D1Database, store: KVNamespace, id: string, action: string | undefined): Promise<Response> {
  if (!photoIdPattern.test(id)) throw new HttpError(404, '照片不存在。');
  const remove = request.method === 'DELETE';
  const value = await body(request, action === 'featured' ? ['expectedRevision', 'featured']
    : action === 'restore' || remove ? ['expectedRevision'] : ['expectedRevision', 'title'], 4096);
  const expected = expectedPhotoRevision(value.expectedRevision);
  await ensureAlbum(db, store);
  let mutation: D1PreparedStatement;
  const guard = 'id = ? AND (SELECT revision FROM album_state WHERE id = 1) = ?';
  if (action === 'restore') {
    mutation = db.prepare(`UPDATE album_photos SET removed_at = NULL
      WHERE ${guard} AND removed_at > ${albumClock} - ?
        AND (SELECT COUNT(*) FROM album_photos WHERE removed_at IS NULL) < ? RETURNING id`)
      .bind(id, expected, photoRestoreMs, maxPhotos);
  } else if (remove) {
    mutation = db.prepare(`UPDATE album_photos SET removed_at = ${albumClock}, featured_rank = NULL
      WHERE ${guard} AND removed_at IS NULL RETURNING id`).bind(id, expected);
  } else if (action === 'featured') {
    if (typeof value.featured !== 'boolean') throw new HttpError(400, '请选好这张照片要不要留在首页。');
    mutation = db.prepare(`UPDATE album_photos SET featured_rank = CASE WHEN ? = 0 THEN NULL
      WHEN featured_rank IS NOT NULL THEN featured_rank ELSE (SELECT COALESCE(MAX(featured_rank), 0) + 1 FROM album_photos) END
      WHERE ${guard} AND removed_at IS NULL
        AND (? = 0 OR featured_rank IS NOT NULL OR (SELECT COUNT(*) FROM album_photos WHERE featured_rank IS NOT NULL) < ?) RETURNING id`)
      .bind(Number(value.featured), id, expected, Number(value.featured), featuredPhotoCount);
  } else {
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!title || title.length > maxPhotoTitleLength) throw new HttpError(400, '标题要有内容，最多 80 个字。');
    mutation = db.prepare(`UPDATE album_photos SET title = ? WHERE ${guard} AND removed_at IS NULL RETURNING id`)
      .bind(title, id, expected);
  }
  if (!await mutation.first()) {
    const state = await db.prepare('SELECT revision FROM album_state WHERE id = 1').first<{ revision: number }>();
    if (state?.revision !== expected) albumConflict();
    const row = await db.prepare('SELECT removed_at FROM album_photos WHERE id = ?').bind(id).first<{ removed_at: number | null }>();
    if (action === 'restore' && row?.removed_at != null && row.removed_at + photoRestoreMs > Date.now()) {
      throw new HttpError(422, '相册已满，取下一张后再恢复。');
    }
    if (action === 'featured' && row?.removed_at === null) throw new HttpError(422, '首页已经留了三张，先收下一张再选吧。');
    throw new HttpError(404, action === 'restore' ? '这张照片已超过恢复期限。' : '照片不存在。');
  }
  return json(await readAlbum(db, store, true));
}

async function photo(db: D1Database, store: KVNamespace, id: string, size: string): Promise<Response> {
  if (!photoIdPattern.test(id) || !photoSizes.includes(size as PhotoSize)) return json({ error: '照片不存在。' }, 404);
  const objectId = await activePhotoObject(db, store, id);
  if (!objectId) return json({ error: '照片不存在。' }, 404);
  const stream = await store.get(photoObjectKey(objectId, size as PhotoSize), 'stream');
  if (!stream) return json({ error: '照片暂时还没同步，请稍后再试。' }, 404);
  return new Response(stream, { headers: { 'Content-Type': 'image/webp',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

async function readUploadPart(value: unknown, limit: number, label: string): Promise<Uint8Array> {
  if (!(value instanceof Blob) || value.size === 0) throw new HttpError(400, `缺少${label}。`);
  if (value.size > limit) throw new HttpError(413, '这张图有点大，压缩后再贴。');
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!isWebp(bytes)) throw new HttpError(415, '请贴 WebP 照片。');
  return bytes;
}

function parseUploadDimension(raw: unknown, label: string): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new HttpError(400, `${label}无效。`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maxPhotoEdge) throw new HttpError(400, `${label}无效。`);
  return value;
}

async function uploadPhoto(request: Request, db: D1Database, store: KVNamespace): Promise<Response> {
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxPhotoUploadBytes)) {
    throw new HttpError(413, '这张图有点大，压缩后再贴。');
  }
  if (!/multipart\/form-data/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new HttpError(415, '请使用表单上传。');
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { throw new HttpError(400, '内容格式无效。'); }

  const titleRaw = form.get('title');
  if (typeof titleRaw !== 'string') throw new HttpError(400, '给这张写个名字再贴。');
  const title = titleRaw.trim();
  if (!title || title.length > maxPhotoTitleLength) throw new HttpError(400, '给这张写个名字再贴。');

  const dateRaw = form.get('date');
  let date: string | null = null;
  if (dateRaw !== null && dateRaw !== '') {
    if (!isCalendarDate(dateRaw)) throw new HttpError(400, '拍摄日期无效。');
    date = dateRaw;
  }

  const idRaw = form.get('id');
  if (typeof idRaw !== 'string' || !photoIdPattern.test(idRaw)) throw new HttpError(400, '照片编号无效。');
  const id = idRaw;

  const revisionRaw = form.get('expectedRevision');
  if (typeof revisionRaw !== 'string' || !/^\d+$/.test(revisionRaw)) throw new HttpError(400, '版本号无效。');
  const expectedRevision = Number(revisionRaw);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new HttpError(400, '版本号无效。');

  const width = parseUploadDimension(form.get('width'), '宽度');
  const height = parseUploadDimension(form.get('height'), '高度');
  const thumb = await readUploadPart(form.get('thumb'), maxPhotoThumbBytes, '缩略图');
  const large = await readUploadPart(form.get('large'), maxPhotoLargeBytes, '大图');
  if (thumb.byteLength + large.byteLength > maxPhotoUploadBytes) {
    throw new HttpError(413, '这张图有点大，压缩后再贴。');
  }

  await ensureAlbum(db, store);
  const existing = await db.prepare('SELECT removed_at FROM album_photos WHERE id = ?').bind(id).first<{ removed_at: number | null }>();
  if (existing?.removed_at === null) return json(await readAlbum(db, store, true));
  if (existing && existing.removed_at! + photoRestoreMs > Date.now()) throw new HttpError(409, '这张照片可在最近取下中恢复。');

  const objectId = crypto.randomUUID();
  await db.prepare(`INSERT INTO album_uploads (object_id, expires_at) VALUES (?, ${albumClock} + ?)`)
    .bind(objectId, uploadGraceMs).run();
  const writes = await Promise.allSettled([
    store.put(photoObjectKey(objectId, 'thumb'), thumb),
    store.put(photoObjectKey(objectId, 'large'), large),
  ]);
  if (writes.some(result => result.status === 'rejected')) throw new Error('Photo upload incomplete');

  const [added] = await db.batch([
    db.prepare(`INSERT INTO album_photos (id, object_id, title, date, width, height)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE (SELECT revision FROM album_state WHERE id = 1) = ?
        AND EXISTS (SELECT 1 FROM album_uploads WHERE object_id = ? AND expires_at > ${albumClock})
        AND (SELECT COUNT(*) FROM album_photos WHERE removed_at IS NULL) < ?
      ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id, objectId, title, date, width, height, expectedRevision, objectId, maxPhotos),
    db.prepare('DELETE FROM album_uploads WHERE object_id = ? AND EXISTS (SELECT 1 FROM album_photos WHERE object_id = ?)').bind(objectId, objectId),
  ]);
  const current = await readAlbum(db, store, true);
  if (added.results.length || current.photos.some(photo => photo.id === id)) return json(current);
  if (current.revision !== expectedRevision) albumConflict();
  if (current.photos.length >= maxPhotos) throw new HttpError(422, '相册已经贴满了，这本装不下更多了。');
  throw new HttpError(409, '这张照片正在等待清理，请稍后再贴。');
}

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (!env.PHOTOS) return;
    const results = await Promise.allSettled([sweepAlbum(env.DB, env.PHOTOS), sweepOrphanAudio(env.DB, env.PHOTOS)]);
    if (results.some(result => result.status === 'rejected')) throw new Error('Media cleanup will retry on the next run');
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const photoPath = path === '/api/photos' || /^\/api\/photos\/[^/]+(?:\/[^/]+)?$/.test(path);
      const memoryPath = path.startsWith('/api/memory/');
      const known = memoryPath || path === '/api/session' || path === '/api/notebook' || path === '/api/letter' || photoPath || /^\/api\/(notes|wishes)\/[^/]+$/.test(path);
      if (!known) return json({ error: '接口不存在。' }, 404);
      if (path === '/api/letter' && request.method !== 'GET') return json({ error: '方法不支持。' }, 405, { Allow: 'GET' });
      if (photoPath) {
        const [, , , photoId, action] = path.split('/');
        const allowed = path === '/api/photos' ? ['GET', 'POST']
          : !action && photoId ? ['PUT', 'DELETE']
            : action === 'featured' || action === 'restore' ? ['PUT']
              : ['GET'];
        if (!allowed.includes(request.method)) return json({ error: '方法不支持。' }, 405, { Allow: allowed.join(', ') });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assertOrigin(request);
      const configured = !!env.DB && isPasswordHash(env.EDITOR_PASSWORD_HASH);
      if (path === '/api/session' && request.method === 'GET') {
        return json({ authenticated: configured && await authenticated(request, env.DB, env.EDITOR_PASSWORD_HASH!), configured });
      }
      if (!configured) return json({ error: '云端手账尚未配置完成。' }, 503);
      if (path === '/api/session') {
        if (request.method === 'POST') return await login(request, env.DB, env.EDITOR_PASSWORD_HASH!);
        if (request.method === 'DELETE') {
          const token = readSessionToken(request);
          if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
          return json({ authenticated: false, configured: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
        }
        return json({ error: '方法不支持。' }, 405, { Allow: 'GET, POST, DELETE' });
      }
      if (!await authenticated(request, env.DB, env.EDITOR_PASSWORD_HASH!)) return json({ error: '请先登录手账。' }, 401);
      if (path === '/api/memory/desktop') {
        assertOrigin(request);
        const actor = await memoryActor(request, env.DB);
        if (!actor) return json({ error: '请先验证自己的个人身份。' }, 403);
        if (!env.SHARED_DESKTOP) return json({ error: '共同桌面尚未配置，请稍后再来。' }, 503);
        const headers = new Headers(request.headers);
        headers.set('X-Memory-Actor', JSON.stringify({
          id: actor.id, sessionHash: actor.sessionHash, parentHash: actor.parentHash, expiresAt: actor.expiresAt,
        }));
        return env.SHARED_DESKTOP.getByName('shared-memory-book').fetch(new Request(request, { headers }));
      }
      if (memoryPath) return handleMemoryRequest(request, env);
      if (path === '/api/letter') {
        if (getAnniversaryDay(new Date(Date.now())) < 100) return json({ error: '百日信还未到拆信的日子。' }, 403);
        // Read private storage only after both server-side gates have passed.
        const letter = env.PHOTOS ? await env.PHOTOS.get(hundredDayLetterKey, 'text') : null;
        return json(letter === null ? hundredDayLetter : parseLetter(JSON.parse(letter)));
      }
      if (photoPath) {
        if (!env.PHOTOS) return json({ error: '相册暂时打不开，请稍后再来。' }, 503);
        if (path === '/api/photos' && request.method === 'POST') return await uploadPhoto(request, env.DB, env.PHOTOS);
        if (path === '/api/photos') return json(await readAlbum(env.DB, env.PHOTOS, new URL(request.url).searchParams.has('removed')));
        const [, , , id, action] = path.split('/');
        if (!action || action === 'featured' || action === 'restore') return await changePhoto(request, env.DB, env.PHOTOS, id, action);
        return await photo(env.DB, env.PHOTOS, id, action);
      }
      if (path === '/api/notebook') {
        return request.method === 'GET' ? json(await notebook(env.DB)) : json({ error: '方法不支持。' }, 405, { Allow: 'GET' });
      }
      if (!['PUT', 'DELETE'].includes(request.method)) return json({ error: '方法不支持。' }, 405, { Allow: 'PUT, DELETE' });
      const [, , collection, key] = path.split('/');
      return await mutate(request, env.DB, collection === 'notes' ? 'note' : 'wish', key);
    } catch (error) {
      // Never log passwords, request bodies, SQL parameters, or database error text.
      return error instanceof HttpError ? json({ error: error.message }, error.status) : json({ error: '云端手账暂时不可用，请稍后重试。' }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
