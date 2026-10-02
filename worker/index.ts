import { isCalendarDate, parseNotebook } from '../src/lib/notebook.ts';
import type { CloudNotebook } from '../src/lib/notebook.ts';
import { getAnniversaryDay } from '../src/lib/anniversary.ts';
import { digest, isPasswordHash, randomToken, readSessionToken, sessionCookie, verifyPassword } from './auth.ts';
import { hundredDayLetter } from './letter.ts';

type Env = Cloudflare.Env & { EDITOR_PASSWORD_HASH?: string };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const known = path === '/api/session' || path === '/api/notebook' || path === '/api/letter' || /^\/api\/(notes|wishes)\/[^/]+$/.test(path);
      if (!known) return json({ error: '接口不存在。' }, 404);
      if (path === '/api/letter' && request.method !== 'GET') return json({ error: '方法不支持。' }, 405, { Allow: 'GET' });
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
      if (path === '/api/letter') {
        if (getAnniversaryDay(new Date(Date.now())) < 100) return json({ error: '百日信还未到拆信的日子。' }, 403);
        return json(hundredDayLetter);
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
