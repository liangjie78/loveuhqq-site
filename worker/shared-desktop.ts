import { DurableObject } from 'cloudflare:workers';
import { digest } from './auth';
import { activePhotoObject } from './album';
import type { MemoryActor } from './memory-book';
import type { MemberId } from '../src/lib/memory-book';
import type { DesktopItem, DesktopSnapshot, DesktopUndo } from '../src/lib/shared-desktop';

type DeskEnv = { DB: D1Database; EDITOR_PASSWORD_HASH?: string; PHOTOS?: KVNamespace };
type DeskActor = Omit<MemoryActor, 'name'>;
type StoredDesk = DesktopSnapshot & { removed?: Partial<Record<MemberId, { item: DesktopItem; undoUntil: number }>> };
const empty = (): StoredDesk => ({ revision: 0, items: [], current: null });
const itemLimit = 40;
const undoMs = 30_000;
const validId = /^[a-zA-Z0-9-]{1,80}$/;

/** One private table for this couple. SQLite transactions make object updates durable before acknowledgement. */
export class SharedDesktop extends DurableObject<DeskEnv> {
  constructor(ctx: DurableObjectState, env: DeskEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS desk (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL)');
  }
  private snapshot(): StoredDesk {
    const row = this.ctx.storage.sql.exec<{ snapshot: string }>('SELECT snapshot FROM desk WHERE id=1').toArray()[0];
    return row ? JSON.parse(row.snapshot) : empty();
  }
  private save(state: StoredDesk) {
    this.ctx.storage.sql.exec('INSERT INTO desk(id,snapshot) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot', JSON.stringify(state));
  }
  private async authorized(actor: DeskActor): Promise<boolean> {
    if (!actor || actor.expiresAt <= Date.now() || !this.env.EDITOR_PASSWORD_HASH) return false;
    const tag = await digest(this.env.EDITOR_PASSWORD_HASH);
    const row = await this.env.DB.prepare(`SELECT m.token_hash FROM memory_sessions m JOIN sessions s ON s.token_hash=m.parent_hash
      WHERE m.token_hash=? AND m.parent_hash=? AND m.member_id=? AND m.expires_at>? AND s.expires_at>? AND s.credential_tag=?`)
      .bind(actor.sessionHash, actor.parentHash, actor.id, Date.now(), Date.now(), tag).first();
    return !!row;
  }
  async fetch(request: Request): Promise<Response> {
    let actor: DeskActor;
    try { actor = JSON.parse(request.headers.get('X-Memory-Actor') ?? 'null'); }
    catch { return new Response('Unauthorized', { status: 401 }); }
    if (!await this.authorized(actor)) return new Response('Unauthorized', { status: 401 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.ctx.getWebSockets().length >= 8) return new Response('Too many connections', { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment(actor);
    this.sendState(pair[1], this.snapshot(), actor.id);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  private sendState(ws: WebSocket, state: StoredDesk, actor: MemberId, type = 'snapshot', mutationId?: string, itemId?: string) {
    const { revision, items, current } = state;
    const receipt = state.removed?.[actor];
    const undo: DesktopUndo | null = receipt && receipt.undoUntil > Date.now()
      ? { itemId: receipt.item.id, version: receipt.item.version, undoUntil: receipt.undoUntil } : null;
    ws.send(JSON.stringify({ type, state: { revision, items, current }, undo, mutationId, itemId }));
  }
  private async broadcast(state: StoredDesk, type?: string, mutationId?: string, itemId?: string) {
    await Promise.all(this.ctx.getWebSockets().map(async ws => {
      try {
        const actor = ws.deserializeAttachment() as DeskActor;
        if (await this.authorized(actor)) this.sendState(ws, state, actor.id, type, mutationId, itemId);
        else ws.close(4401, '身份已失效');
      }
      catch { ws.close(1011, '连接暂时不可用'); }
    }));
  }
  private async exists(kind: string, id: string) {
    if (kind === 'story') return !!await this.env.DB.prepare('SELECT id FROM memory_stories WHERE id=?').bind(id).first();
    if (kind === 'photo') return !!await activePhotoObject(this.env.DB, this.env.PHOTOS, id);
    return true;
  }
  private async changePresence(ws: WebSocket, actor: MemberId, type: 'remove' | 'restore', itemId: string, expectedVersion: number, mutationId: string) {
    const state = this.snapshot();
    const index = state.items.findIndex(item => item.id === itemId);
    const removed = state.removed ??= {};
    const now = Date.now();
    for (const id of ['one', 'two'] as const) if (removed[id] && removed[id]!.undoUntil <= now) delete removed[id];
    if (type === 'remove') {
      const item = state.items[index];
      if (!item || item.version !== expectedVersion) {
        this.sendState(ws, state, actor, 'conflict', mutationId, itemId);
        return;
      }
      state.items.splice(index, 1);
      removed[actor] = { item: { ...item, version: item.version + 1 }, undoUntil: now + undoMs };
    } else {
      const receipt = removed[actor];
      if (index !== -1 || !receipt || receipt.item.id !== itemId || receipt.item.version !== expectedVersion) {
        this.sendState(ws, state, actor, 'conflict', mutationId, itemId);
        return;
      }
      if (state.items.length >= itemLimit) {
        ws.send(JSON.stringify({ type: 'error', mutationId, error: '桌面已经摆满，腾出一个位置后再撤销。' }));
        return;
      }
      state.items.push({ ...receipt.item, version: receipt.item.version + 1 });
      delete removed[actor];
    }
    state.revision++;
    this.save(state);
    await this.broadcast(state, type === 'remove' ? 'removed' : 'restored', mutationId, itemId);
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let mutationId: string | undefined;
    try {
      const actor = ws.deserializeAttachment() as DeskActor;
      if (!await this.authorized(actor)) { ws.close(4401, '身份已失效'); return; }
      if (typeof raw !== 'string' || raw.length > 6000) { ws.send(JSON.stringify({ type: 'error', error: '桌面消息过长。' })); return; }
      const msg = JSON.parse(raw) as Record<string, unknown>;
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (msg.type === 'sync') { this.sendState(ws, this.snapshot(), actor.id); return; }
      if (msg.type === 'view') {
        if (!['story', 'photo'].includes(String(msg.kind)) || typeof msg.id !== 'string' || !await this.exists(String(msg.kind), msg.id)) throw new Error();
        const state = this.snapshot();
        state.current = { kind: msg.kind as 'story' | 'photo', id: msg.id, memberId: actor.id };
        state.revision++; this.save(state);
        await this.broadcast(state); return;
      }
      if (typeof msg.mutationId !== 'string' || !validId.test(msg.mutationId) || !Number.isSafeInteger(msg.expectedVersion) || Number(msg.expectedVersion) < 0) throw new Error();
      mutationId = msg.mutationId;
      const expectedVersion = Number(msg.expectedVersion);
      if (msg.type === 'remove' || msg.type === 'restore') {
        if (typeof msg.itemId !== 'string' || !validId.test(msg.itemId)) throw new Error();
        return await this.changePresence(ws, actor.id, msg.type, msg.itemId, expectedVersion, mutationId);
      }
      if (msg.type !== 'put' || !msg.item || typeof msg.item !== 'object') throw new Error();
      const item = msg.item as DesktopItem;
      if (!validId.test(item.id) || !['story', 'photo', 'note', 'ticket'].includes(item.kind) ||
        typeof item.refId !== 'string' || item.refId.length > 80 || typeof item.text !== 'string' || item.text.length > 500 ||
        ![item.x, item.y, item.rotation].every(Number.isFinite) || item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1 ||
        Math.abs(item.rotation) > 20) throw new Error();
      if (!await this.exists(item.kind, item.refId)) { ws.send(JSON.stringify({ type: 'error', mutationId, error: '这件物品已经不在手账里了。' })); return; }
      const state = this.snapshot(), existing = state.items.find(i => i.id === item.id);
      if ((existing?.version ?? 0) !== expectedVersion || Object.values(state.removed ?? {}).some(receipt => receipt.item.id === item.id && receipt.undoUntil > Date.now())) {
        this.sendState(ws, state, actor.id, 'conflict', mutationId, item.id); return;
      }
      if (!existing && state.items.length >= itemLimit) { ws.send(JSON.stringify({ type: 'error', mutationId, error: '桌面最多摆 40 件物品。' })); return; }
      const next: DesktopItem = { id: item.id, kind: item.kind, refId: item.refId,
        text: item.kind === 'note' || item.kind === 'ticket' ? item.text : '',
        x: item.x, y: item.y, rotation: item.rotation, version: expectedVersion + 1 };
      if (existing) state.items[state.items.indexOf(existing)] = next; else state.items.push(next);
      state.revision++; this.save(state);
      await this.broadcast(state, 'saved', mutationId, item.id);
    } catch {
      try { ws.send(JSON.stringify({ type: 'error', mutationId, error: '这次操作没有保存，请重新连接后再试。' })); } catch { /* Closed socket. */ }
    }
  }
  async webSocketError(ws: WebSocket) { ws.close(1011, '连接暂时不可用'); }
}
