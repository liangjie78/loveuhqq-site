import { DurableObject } from 'cloudflare:workers';
import { digest } from './auth';
import type { MemoryActor } from './memory-book';
import type { DesktopItem, DesktopSnapshot } from '../src/lib/shared-desktop';

type DeskEnv = { DB: D1Database; EDITOR_PASSWORD_HASH?: string };
const empty = (): DesktopSnapshot => ({ revision: 0, items: [], current: null });

/** One private table for this couple. SQLite transactions make object updates durable before acknowledgement. */
export class SharedDesktop extends DurableObject<DeskEnv> {
  constructor(ctx: DurableObjectState, env: DeskEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS desk (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL)');
  }
  private snapshot(): DesktopSnapshot {
    const row = this.ctx.storage.sql.exec<{ snapshot: string }>('SELECT snapshot FROM desk WHERE id=1').toArray()[0];
    return row ? JSON.parse(row.snapshot) : empty();
  }
  private save(state: DesktopSnapshot) {
    this.ctx.storage.sql.exec('INSERT INTO desk(id,snapshot) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot', JSON.stringify(state));
  }
  private async authorized(actor: MemoryActor): Promise<boolean> {
    if (!actor || actor.expiresAt <= Date.now() || !this.env.EDITOR_PASSWORD_HASH) return false;
    const tag = await digest(this.env.EDITOR_PASSWORD_HASH);
    const row = await this.env.DB.prepare(`SELECT m.token_hash FROM memory_sessions m JOIN sessions s ON s.token_hash=m.parent_hash
      WHERE m.token_hash=? AND m.parent_hash=? AND m.member_id=? AND m.expires_at>? AND s.expires_at>? AND s.credential_tag=?`)
      .bind(actor.sessionHash, actor.parentHash, actor.id, Date.now(), Date.now(), tag).first();
    return !!row;
  }
  async fetch(request: Request): Promise<Response> {
    let actor: MemoryActor;
    try { actor = JSON.parse(request.headers.get('X-Memory-Actor') ?? 'null'); }
    catch { return new Response('Unauthorized', { status: 401 }); }
    if (!await this.authorized(actor)) return new Response('Unauthorized', { status: 401 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.ctx.getWebSockets().length >= 8) return new Response('Too many connections', { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment(actor);
    pair[1].send(JSON.stringify({ type: 'snapshot', state: this.snapshot() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  private async broadcast(message: unknown) {
    const text = JSON.stringify(message);
    await Promise.all(this.ctx.getWebSockets().map(async ws => {
      try { if (await this.authorized(ws.deserializeAttachment())) ws.send(text); else ws.close(4401, '身份已失效'); }
      catch { ws.close(1011, '连接暂时不可用'); }
    }));
  }
  private async exists(kind: string, id: string) {
    if (kind === 'story') return !!await this.env.DB.prepare('SELECT id FROM memory_stories WHERE id=?').bind(id).first();
    if (kind === 'photo') {
      const row = await this.env.DB.prepare('SELECT manifest FROM photo_manifest WHERE id=1').first<{ manifest: string }>();
      return !!row && JSON.parse(row.manifest).photos.some((p: { id: string }) => p.id === id);
    }
    return true;
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      const actor = ws.deserializeAttachment() as MemoryActor;
      if (!await this.authorized(actor)) { ws.close(4401, '身份已失效'); return; }
      if (typeof raw !== 'string' || raw.length > 6000) { ws.send(JSON.stringify({ type: 'error', error: '桌面消息过长。' })); return; }
      const msg = JSON.parse(raw) as Record<string, unknown>;
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (msg.type === 'sync') { ws.send(JSON.stringify({ type: 'snapshot', state: this.snapshot() })); return; }
      if (msg.type === 'view') {
        if (!['story', 'photo'].includes(String(msg.kind)) || typeof msg.id !== 'string' || !await this.exists(String(msg.kind), msg.id)) throw new Error();
        const state = this.snapshot();
        state.current = { kind: msg.kind as 'story' | 'photo', id: msg.id, memberId: actor.id };
        state.revision++; this.save(state);
        await this.broadcast({ type: 'snapshot', state }); return;
      }
      if (msg.type !== 'put' || !msg.item || typeof msg.item !== 'object' || typeof msg.mutationId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(msg.mutationId)) throw new Error();
      const item = msg.item as DesktopItem;
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || !['story', 'photo', 'note', 'ticket'].includes(item.kind) ||
        typeof item.refId !== 'string' || item.refId.length > 80 || typeof item.text !== 'string' || item.text.length > 500 ||
        ![item.x, item.y, item.rotation].every(Number.isFinite) || item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1 ||
        Math.abs(item.rotation) > 20 || !Number.isSafeInteger(msg.expectedVersion) || Number(msg.expectedVersion) < 0) throw new Error();
      if (!await this.exists(item.kind, item.refId)) { ws.send(JSON.stringify({ type: 'error', error: '这件物品已经不在手账里了。' })); return; }
      const state = this.snapshot(), existing = state.items.find(i => i.id === item.id);
      if ((existing?.version ?? 0) !== msg.expectedVersion) { ws.send(JSON.stringify({ type: 'conflict', state, itemId: item.id, mutationId: msg.mutationId })); return; }
      if (!existing && state.items.length >= 40) { ws.send(JSON.stringify({ type: 'error', error: '桌面最多摆 40 件物品。' })); return; }
      const next: DesktopItem = { id: item.id, kind: item.kind, refId: item.refId,
        text: item.kind === 'note' || item.kind === 'ticket' ? item.text : '',
        x: item.x, y: item.y, rotation: item.rotation, version: Number(msg.expectedVersion) + 1 };
      if (existing) state.items[state.items.indexOf(existing)] = next; else state.items.push(next);
      state.revision++; this.save(state);
      await this.broadcast({ type: 'saved', state, itemId: item.id, mutationId: msg.mutationId });
    } catch {
      try { ws.send(JSON.stringify({ type: 'error', error: '这次操作没有保存，请重新连接后再试。' })); } catch { /* Closed socket. */ }
    }
  }
  async webSocketClose(ws: WebSocket, code: number) { ws.close(code, ''); }
  async webSocketError(ws: WebSocket) { ws.close(1011, '连接暂时不可用'); }
}
