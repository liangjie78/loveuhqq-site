// A real workerd with D1, KV and the shared-desk Durable Object, migrated from scratch.
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const origin = 'https://journal.test';
let script;

export function passwordHash(password) {
  const salt = randomBytes(16);
  return `pbkdf2$100000$${salt.toString('hex')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')}`;
}

export async function startWorker({ password = 'test-only-password', configured = true } = {}) {
  script ??= (await build({ entryPoints: [`${root}/worker/runtime.ts`], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'], logLevel: 'silent' })).outputFiles[0].text;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-09-12',
    d1Databases: ['DB'],
    kvNamespaces: ['PHOTOS'],
    durableObjects: { SHARED_DESKTOP: { className: 'SharedDesktop', useSQLite: true } },
    bindings: configured ? { EDITOR_PASSWORD_HASH: passwordHash(password) } : {},
    serviceBindings: { ASSETS: async () => new Response('static asset') },
  }));
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync(`${root}/migrations`).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${root}/migrations/${file}`, 'utf8').replace(/--[^\n]*/g, '');
    const statements = sql.split(';').map(part => part.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
  return { mf, db, password, client: () => client(mf) };
}

/** A browser-like client: same origin, JSON by default, and a cookie jar. */
let clients = 0;
export function client(mf) {
  const jar = new Map();
  // Each simulated reader gets its own address, so login rate limits stay per reader.
  const address = `198.51.100.${++clients % 250}`;
  const remember = response => {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const [name, value] = pair.split('=');
      if (/Max-Age=0/.test(line) || value === '') jar.delete(name); else jar.set(name, value);
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const call = async (path, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const init = { method, headers: { Origin: origin, 'CF-Connecting-IP': address, ...(jar.size ? { Cookie: cookie() } : {}), ...headers } };
    if (body instanceof FormData) {
      const encoded = new Request(origin, { method: 'POST', body });
      init.body = new Uint8Array(await encoded.arrayBuffer());
      init.headers['Content-Type'] = encoded.headers.get('Content-Type');
    }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    const response = remember(await mf.dispatchFetch(origin + path, init));
    if (raw) return response;
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* Not JSON. */ }
    return { status: response.status, json, headers: response.headers };
  };
  return {
    jar, cookie, call,
    login: password => call('/api/session', { method: 'POST', body: { password, remember: true } }),
    as: id => call('/api/memory/identity', { method: 'POST', body: { id } }),
  };
}
