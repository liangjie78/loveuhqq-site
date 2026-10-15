import type { MemoryMember, MemoryStory } from '../lib/memory-book';
import type { PrivatePhoto } from '../lib/photos';
import { photoUrl } from '../lib/photos';
import type { DesktopItem, DesktopSnapshot } from '../lib/shared-desktop';

export function createSharedDesktop(container: HTMLElement, options: { onOpenStory: (id: string) => void; onUnauthorized: () => void }) {
  const status = document.createElement('p'); status.className = 'memory-tool-hint'; status.setAttribute('role', 'status');
  const controls = document.createElement('div'); controls.className = 'memory-desk-controls';
  const choices = document.createElement('select'); choices.setAttribute('aria-label', '选择要摆上桌面的故事或照片');
  const note = document.createElement('input'); note.maxLength = 500; note.placeholder = '留张便签或票根'; note.setAttribute('aria-label', '便签或票根内容');
  const desk = document.createElement('div'); desk.className = 'memory-desk'; desk.setAttribute('aria-label', '共享桌面');
  const current = document.createElement('p'); current.className = 'memory-tool-hint';
  const conflict = document.createElement('div'); conflict.hidden = true;
  const conflictText = document.createElement('p'); conflictText.className = 'memory-tool-hint';
  conflict.append(conflictText);
  let member: MemoryMember | null = null, stories: MemoryStory[] = [], photos: PrivatePhoto[] = [];
  let ws: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  let state: DesktopSnapshot = { revision: 0, items: [], current: null }, active = false, retryDelay = 1000;
  let drag: { item: DesktopItem; startX: number; startY: number; x: number; y: number; element: HTMLElement } | null = null;
  let pending: DesktopItem | null = null, conflicted: DesktopItem | null = null;
  let pendingMutation: string | null = null;
  function button(text: string, parent: HTMLElement, action: () => void) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = 'text-button'; b.addEventListener('click', action); parent.append(b); return b;
  }
  function send(message: unknown) {
    if (ws?.readyState !== WebSocket.OPEN) { status.textContent = '连接尚未恢复，这次操作没有保存。'; return false; }
    ws.send(JSON.stringify(message)); return true;
  }
  function put(item: DesktopItem) {
    if (pending) { status.textContent = '上一件还在保存，稍等一下。'; return; }
    const mutationId = crypto.randomUUID();
    if (send({ type: 'put', item, expectedVersion: item.version, mutationId })) { pending = item; pendingMutation = mutationId; status.textContent = '正在收好这件物品…'; }
  }
  function add(kind: DesktopItem['kind'], refId: string, text = '') {
    if (!active || !member) return;
    put({ id: crypto.randomUUID(), kind, refId, text, x: .12 + (state.items.length % 4) * .18, y: .12 + (state.items.length % 3) * .2, rotation: 0, version: 0 });
  }
  controls.append(choices);
  button('摆到桌上', controls, () => { const [kind, id] = choices.value.split(':'); if (id) add(kind as 'story' | 'photo', id); });
  controls.append(note);
  button('贴便签', controls, () => { if (note.value.trim()) add('note', '', note.value.trim()); });
  button('贴票根', controls, () => { if (note.value.trim()) add('ticket', '', note.value.trim()); });
  button('重新连接', controls, () => { disconnect(); if (active) connect(); });
  button('采用桌上新位置', conflict, () => { conflicted = null; conflict.hidden = true; render(); });
  button('保留我的摆放再保存', conflict, () => {
    if (!conflicted) return;
    const latest = state.items.find(i => i.id === conflicted!.id);
    const next = { ...conflicted, version: latest?.version ?? 0 }; conflicted = null; conflict.hidden = true; put(next);
  });
  function render() {
    if (!active || drag) return;
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-desk-id]')?.dataset.deskId;
    desk.replaceChildren();
    for (const item of state.items) {
      const story = stories.find(s => s.id === item.refId), photo = photos.find(p => p.id === item.refId);
      const card = document.createElement('article'); card.className = 'memory-desk-item'; card.dataset.deskId = item.id; card.tabIndex = 0;
      card.style.left = `${item.x * Math.max(0, desk.clientWidth - 150)}px`; card.style.top = `${item.y * Math.max(0, desk.clientHeight - 180)}px`;
      card.style.transform = `rotate(${item.rotation}deg)`;
      if (item.kind === 'photo' && photo) { const image = document.createElement('img'); image.alt = photo.title; image.src = photoUrl(photo.id, 'thumb'); image.draggable = false; card.append(image); }
      const text = document.createElement('p'); text.textContent = item.kind === 'story' ? story?.title ?? '故事已取下' : item.kind === 'photo' ? photo?.title ?? '照片已取下' : item.text;
      card.append(text); card.setAttribute('aria-label', `${text.textContent}，方向键调整位置，回车保存`);
      if (story || photo) button('一起翻看', card, () => {
        if (send({ type: 'view', kind: item.kind, id: item.refId }) && story) options.onOpenStory(story.id);
      });
      card.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('button') || pending || e.button !== 0) return;
        e.preventDefault(); card.focus(); card.setPointerCapture(e.pointerId);
        drag = { item: { ...item }, startX: e.clientX, startY: e.clientY, x: item.x, y: item.y, element: card };
      });
      card.addEventListener('pointermove', e => {
        if (!drag || drag.element !== card) return;
        drag.item.x = Math.max(0, Math.min(1, drag.x + (e.clientX - drag.startX) / Math.max(1, desk.clientWidth - 150)));
        drag.item.y = Math.max(0, Math.min(1, drag.y + (e.clientY - drag.startY) / Math.max(1, desk.clientHeight - 180)));
        card.style.left = `${drag.item.x * Math.max(0, desk.clientWidth - 150)}px`; card.style.top = `${drag.item.y * Math.max(0, desk.clientHeight - 180)}px`;
      });
      card.addEventListener('pointerup', () => { if (!drag || drag.element !== card) return; const moved = drag.item; drag = null; put(moved); });
      card.addEventListener('pointercancel', () => { drag = null; render(); });
      card.addEventListener('keydown', e => {
        if (e.target !== card || pending) return;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [-.03, 0], ArrowRight: [.03, 0], ArrowUp: [0, -.03], ArrowDown: [0, .03] };
        const delta = offsets[e.key]; if (!delta) return;
        e.preventDefault(); put({ ...item, x: Math.max(0, Math.min(1, item.x + delta[0])), y: Math.max(0, Math.min(1, item.y + delta[1])) });
      });
      desk.append(card);
    }
    if (focused) desk.querySelector<HTMLElement>(`[data-desk-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    current.replaceChildren();
    if (state.current) {
      const view = state.current, story = stories.find(s => s.id === view.id), photo = photos.find(p => p.id === view.id);
      current.append(`${view.memberId === member?.id ? '我' : '对方'}正在翻看：${story?.title ?? photo?.title ?? '一件物品'} `);
      if (story) button('跟着翻开', current, () => options.onOpenStory(story.id));
      if (photo) { const image = document.createElement('img'); image.src = photoUrl(photo.id, 'thumb'); image.alt = photo.title; image.style.maxWidth = '150px'; current.append(image); }
    }
  }
  function disconnect() {
    preservePending();
    clearTimeout(retry); clearInterval(heartbeat); retry = heartbeat = undefined;
    const old = ws; ws = null; old?.close();
  }
  function preservePending() {
    if (!pending) return;
    conflicted = pending; pending = null; pendingMutation = null; conflict.hidden = false;
    conflictText.textContent = '连接断开，这件物品的保存结果还未确认。重连后可以采用桌面位置或重新保存。';
  }
  function connect() {
    if (!active || !member || ws) return;
    status.textContent = '正在接上共同桌面…';
    const url = new URL('/api/memory/desktop', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url); ws = socket;
    socket.addEventListener('open', () => {
      if (ws !== socket || !active) return;
      retryDelay = 1000; status.textContent = '已连接。拖动物品后会自动保存，双方可以同时翻看。';
      heartbeat = setInterval(() => send({ type: 'ping' }), 20_000);
    });
    socket.addEventListener('message', event => {
      if (ws !== socket || !active) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.state && msg.state.revision >= state.revision) state = msg.state;
        if (msg.type === 'conflict' && msg.mutationId === pendingMutation) {
          conflicted = pending; pending = null; conflict.hidden = false;
          pendingMutation = null;
          conflictText.textContent = '同一件物品刚被移动了。我的位置还在，选择保留哪一版。';
        } else if (msg.type === 'saved' && pendingMutation === msg.mutationId) { pending = null; pendingMutation = null; note.value = ''; status.textContent = '已收好，另一端也能看到。'; }
        else if (msg.type === 'error') { conflicted = pending; pending = null; status.textContent = msg.error; if (conflicted) conflict.hidden = false; }
        if (msg.state) render();
      } catch { status.textContent = '桌面消息没有读完整，请重新连接。'; }
    });
    socket.addEventListener('close', event => {
      if (ws !== socket) return;
      ws = null; clearInterval(heartbeat);
      if (!active) return;
      preservePending();
      if (event.code === 4401) { options.onUnauthorized(); return; }
      status.textContent = '连接断开，正在重新接上；已保存的位置仍在。';
      retry = setTimeout(connect, retryDelay); retryDelay = Math.min(15_000, retryDelay * 2);
    });
    socket.addEventListener('error', () => { if (ws === socket) status.textContent = '暂时连不上共同桌面，稍后会重试。'; });
  }
  const resize = new ResizeObserver(render); resize.observe(desk);
  const content = document.createElement('div');
  content.append(controls, status, conflict, desk, current);
  container.append(content);
  return {
    update(data: { member: MemoryMember | null; stories: MemoryStory[]; photos: PrivatePhoto[] }) {
      const changed = member?.id !== data.member?.id;
      if (changed) { disconnect(); state = { revision: 0, items: [], current: null }; }
      member = data.member; stories = data.stories; photos = data.photos; active = !!member;
      choices.replaceChildren();
      for (const [kind, values] of [['story', stories], ['photo', photos]] as const) {
        for (const value of values) { const option = document.createElement('option'); option.value = `${kind}:${value.id}`; option.textContent = `${kind === 'story' ? '故事' : '照片'} · ${value.title}`; choices.append(option); }
      }
      render(); if (active) connect();
    },
    clear() { active = false; disconnect(); member = null; stories = []; photos = []; pending = conflicted = null; drag = null;
      pendingMutation = null; state = { revision: 0, items: [], current: null }; desk.querySelectorAll('img').forEach(i => i.removeAttribute('src'));
      desk.replaceChildren(); current.replaceChildren(); choices.replaceChildren(); note.value = ''; status.textContent = ''; conflict.hidden = true; },
  };
}
