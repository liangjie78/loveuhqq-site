import { photoUrl } from '../lib/photos';
import {
  adoptLatestDesktopPosition, applyDesktopMessage, beginDesktopPut, desktopDisconnected, emptyDesktopProtocol,
  matchesPendingDesktopSave, moveDesktopByArrow, moveDesktopByDelta, retryDesktopPosition, shouldClearPendingDesktopNote,
  type DesktopMessage, type DesktopProtocol,
} from '../lib/desktop-client';
import { requestSharedDeskUpdate, type SharedDeskData } from '../lib/shared-desk-events';
import type { DesktopItem } from '../lib/shared-desktop';
import { publishSession } from '../lib/session';

/** 共同桌面: a live table both of you can rearrange. Positions persist through the Durable Object. */

const deskRoot = document.querySelector<HTMLElement>('[data-shared-desktop]');
const CARD_W = 150;
const CARD_H = 180;

if (deskRoot) {
  const root: HTMLElement = deskRoot;
  let data: SharedDeskData | null = null;
  let protocol: DesktopProtocol = emptyDesktopProtocol();
  let optimistic: DesktopItem | null = null;
  let socket: WebSocket | null = null;
  let active = false;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let noteSave: { mutationId: string; value: string } | null = null;
  let linkStatus = '';
  let messageStatus = '';
  let conflictStatus = '';

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (text: string, action: () => void, className = 'btn btn-sm') => {
    const node = make('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };

  // Static shell, created only once a signature is chosen.
  const controls = make('div', 'desk-controls');
  const choice = make('select', 'select');
  choice.setAttribute('aria-label', '选择要摆上桌面的故事或照片');
  const place = button('摆到桌上', () => {
    const [kind, id] = choice.value.split(':');
    if (id) add(kind as 'story' | 'photo', id);
  });
  const note = make('input', 'input');
  note.maxLength = 500;
  note.placeholder = '留张便签或票根';
  note.setAttribute('aria-label', '便签或票根内容');
  const stick = (kind: 'note' | 'ticket') => { const value = note.value; if (value.trim()) add(kind, '', value.trim(), value); };
  controls.append(choice, place, note, button('贴便签', () => stick('note')), button('贴票根', () => stick('ticket')), button('重新连接', () => reconnect(), 'btn btn-sm btn-quiet'));
  const hint = make('p', 'desk-hint');
  hint.setAttribute('role', 'status');
  const conflict = make('div', 'notice desk-conflict');
  const conflictText = make('p');
  conflictText.setAttribute('role', 'status');
  conflict.append(conflictText, button('采用桌上新位置', () => { commit(adoptLatestDesktopPosition(protocol)); conflictStatus = ''; paint(); }), button('保留我的摆放再保存', retryConflict));
  const desk = make('div', 'desk');
  desk.setAttribute('aria-label', '共享桌面');
  const viewing = make('p', 'desk-hint desk-viewing');

  function commit(next: DesktopProtocol) {
    protocol = next;
    if (!next.pending) optimistic = null;
  }

  const send = (message: unknown) => {
    if (socket?.readyState !== WebSocket.OPEN) { messageStatus = '连接尚未恢复，这次操作没有保存。'; paint(); return false; }
    socket.send(JSON.stringify(message));
    return true;
  };

  function put(item: DesktopItem, noteValue?: string): boolean {
    if (protocol.pending) { messageStatus = '上一件还在保存，稍等一下。'; paint(); return false; }
    const mutationId = crypto.randomUUID();
    if (!send({ type: 'put', item, expectedVersion: item.version, mutationId })) return false;
    commit(beginDesktopPut(protocol, item, mutationId));
    noteSave = noteValue === undefined ? null : { mutationId, value: noteValue };
    messageStatus = '正在收好这件物品…';
    paint();
    return true;
  }
  function add(kind: DesktopItem['kind'], refId: string, text = '', noteValue?: string) {
    if (!data?.member) return;
    const count = protocol.snapshot.items.length;
    put({ id: crypto.randomUUID(), kind, refId, text, x: .12 + (count % 4) * .18, y: .12 + (count % 3) * .2, rotation: Math.round(Math.random() * 8 - 4), version: 0 }, noteValue);
  }
  function retryConflict() {
    const id = crypto.randomUUID();
    const next = retryDesktopPosition(protocol, id);
    if (!next?.pending || socket?.readyState !== WebSocket.OPEN) { messageStatus = '连接尚未恢复，这次操作没有保存。'; paint(); return; }
    socket.send(JSON.stringify({ type: 'put', item: next.pending, expectedVersion: next.pending.version, mutationId: id }));
    commit(next);
    conflictStatus = ''; messageStatus = '正在收好这件物品…';
    paint();
  }

  const openStory = (id: string) => document.dispatchEvent(new CustomEvent('memory:open-story', { detail: { id } }));

  function card(item: DesktopItem): HTMLElement {
    const story = data?.stories.find(value => value.id === item.refId);
    const photo = data?.photos.find(value => value.id === item.refId);
    const text = item.kind === 'story' ? story?.title ?? '故事已取下' : item.kind === 'photo' ? photo?.title ?? '照片已取下' : item.text;
    const node = make('article', `desk-item is-${item.kind}`);
    node.dataset.deskId = item.id;
    node.tabIndex = 0;
    node.setAttribute('aria-label', `${text}，方向键调整位置，回车保存`);
    if (item.kind === 'photo' && photo) {
      const img = make('img');
      img.src = photoUrl(photo.id, 'thumb'); img.alt = photo.title; img.draggable = false;
      node.append(img);
    }
    node.append(make('p', '', text));
    if (story || photo) node.append(button('一起翻看', () => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'view', kind: item.kind, id: item.refId }));
      if (story) openStory(story.id);
    }, 'btn btn-sm btn-quiet'));
    node.addEventListener('keydown', event => {
      if (event.target !== node || protocol.pending) return;
      const current = protocol.snapshot.items.find(value => value.id === item.id);
      if (!current) return;
      const moved = moveDesktopByArrow(current, event.key);
      if (moved) { event.preventDefault(); put(moved); }
      else if (event.key === 'Enter') { event.preventDefault(); put(current); }
    });
    // Pointer dragging: the card follows the finger, the position is saved on release.
    node.addEventListener('pointerdown', event => {
      if ((event.target as Element).closest('button, input, a') || protocol.pending || event.button !== 0) return;
      const startX = event.clientX; const startY = event.clientY;
      let moved = false;
      node.setPointerCapture(event.pointerId);
      node.classList.add('is-dragging');
      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - startX; const dy = move.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        node.style.translate = `${dx}px ${dy}px`;
      };
      const onUp = (up: PointerEvent) => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        node.classList.remove('is-dragging');
        node.style.translate = '';
        if (!moved || up.type === 'pointercancel') return;
        const current = protocol.snapshot.items.find(value => value.id === item.id);
        if (!current) return;
        const next = moveDesktopByDelta(current, up.clientX - startX, up.clientY - startY, desk.clientWidth, desk.clientHeight);
        if (put(next)) { optimistic = next; paint(); }
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
    });
    return node;
  }

  function paint() {
    if (!data?.member) { root.replaceChildren(); return; }
    if (!root.contains(controls)) root.replaceChildren(controls, hint, conflict, desk, viewing);
    const options = [['', '选择故事或照片'], ...data.stories.map(story => [`story:${story.id}`, `故事 · ${story.title}`]), ...data.photos.map(photo => [`photo:${photo.id}`, `照片 · ${photo.title}`])];
    const key = JSON.stringify(options);
    if (choice.dataset.key !== key) {
      const value = choice.value;
      choice.replaceChildren(...options.map(([optionValue, label]) => new Option(label, optionValue)));
      choice.value = options.some(([optionValue]) => optionValue === value) ? value : '';
      choice.dataset.key = key;
    }
    hint.textContent = messageStatus || linkStatus;
    conflict.hidden = !protocol.conflicted;
    conflictText.textContent = conflictStatus;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.deskId;
    const width = desk.clientWidth; const height = desk.clientHeight;
    const items = protocol.snapshot.items.map(item => optimistic?.id === item.id && protocol.pending ? { ...item, x: optimistic.x, y: optimistic.y } : item);
    desk.replaceChildren(...items.map(item => {
      const node = card(item);
      node.style.left = `${item.x * Math.max(0, width - CARD_W)}px`;
      node.style.top = `${item.y * Math.max(0, height - CARD_H)}px`;
      node.style.rotate = `${item.rotation}deg`;
      if (protocol.pending) node.classList.add('is-waiting');
      return node;
    }));
    if (focusedId) desk.querySelector<HTMLElement>(`[data-desk-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    const current = protocol.snapshot.current;
    const viewStory = current?.kind === 'story' ? data.stories.find(story => story.id === current.id) : undefined;
    const viewPhoto = current?.kind === 'photo' ? data.photos.find(photo => photo.id === current.id) : undefined;
    viewing.replaceChildren();
    if (current) viewing.append(`${current.memberId === data.member.id ? '我' : '对方'}正在翻看：${viewStory?.title ?? viewPhoto?.title ?? '一件物品'} `);
    if (viewStory) viewing.append(button('跟着翻开', () => openStory(viewStory.id), 'btn btn-sm btn-quiet'));
    if (viewPhoto) { const img = make('img', 'desk-viewing-photo'); img.src = photoUrl(viewPhoto.id, 'thumb'); img.alt = viewPhoto.title; viewing.append(img); }
  }

  const stopTimers = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeat) clearInterval(heartbeat);
    retryTimer = undefined; heartbeat = undefined;
  };
  const preservePending = () => {
    if (!protocol.pending) return;
    commit(desktopDisconnected(protocol));
    conflictStatus = '连接断开，这件物品的保存结果还未确认。重连后可以采用桌面位置或重新保存。';
  };

  function connect() {
    if (!active || !data?.member || socket) return;
    linkStatus = '正在接上共同桌面…'; paint();
    const url = new URL('/api/memory/desktop', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const next = new WebSocket(url);
    socket = next;
    next.addEventListener('open', () => {
      if (socket !== next || !active) return;
      retryDelay = 1000;
      linkStatus = '已连接。拖动物品后会自动保存，双方可以同时翻看。'; paint();
      heartbeat = setInterval(() => send({ type: 'ping' }), 20_000);
    });
    next.addEventListener('message', event => {
      if (socket !== next || !active) return;
      try {
        const message = JSON.parse(event.data) as DesktopMessage;
        const pendingId = protocol.pendingMutationId;
        const save = noteSave;
        const matchesSave = matchesPendingDesktopSave(protocol, message);
        const clearNote = shouldClearPendingDesktopNote(protocol, message, save, note.value);
        const matchesResponse = pendingId !== null && (message.type === 'conflict' || message.type === 'error') && message.mutationId === pendingId;
        const updated = applyDesktopMessage(protocol, message);
        commit(updated);
        if (message.type === 'conflict' && updated.conflicted) conflictStatus = '同一件物品刚被移动了。我的位置还在，选择保留哪一版。';
        if (matchesSave) {
          if (save?.mutationId === message.mutationId) { if (clearNote) note.value = ''; noteSave = null; }
          messageStatus = '已收好，另一端也能看到。'; conflictStatus = '';
        } else if (message.type === 'error') {
          messageStatus = message.error ?? '桌面操作暂时没有完成。';
          if (updated.conflicted) conflictStatus = message.error ?? '这件物品的保存结果还未确认。';
        }
        if (matchesResponse) noteSave = null;
      } catch { messageStatus = '桌面消息没有读完整，请重新连接。'; }
      paint();
    });
    next.addEventListener('close', event => {
      if (socket !== next) return;
      socket = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      if (!active) return;
      preservePending();
      if (event.code === 4401) { publishSession({ authenticated: false, configured: true }); return; }
      linkStatus = '连接断开，正在重新接上；已保存的位置仍在。'; paint();
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(15_000, retryDelay * 2);
    });
    next.addEventListener('error', () => { if (socket === next) { linkStatus = '暂时连不上共同桌面，稍后会重试。'; paint(); } });
  }
  function reconnect() {
    if (!active) return;
    if (protocol.pending) { commit(desktopDisconnected(protocol)); conflictStatus = '连接断开，这件物品的保存结果还未确认。重连后可以采用桌面位置或重新保存。'; }
    stopTimers();
    const previous = socket;
    socket = null;
    previous?.close();
    linkStatus = '正在重新连接共同桌面…'; paint();
    connect();
  }
  function stop() {
    active = false;
    stopTimers();
    const previous = socket;
    socket = null;
    previous?.close();
    commit(emptyDesktopProtocol());
    note.value = ''; noteSave = null;
    messageStatus = conflictStatus = linkStatus = '';
  }

  let member: string | null = null;
  addEventListener('memory:shared-desk-update', event => {
    data = (event as CustomEvent<SharedDeskData | null>).detail;
    const nextMember = data?.member.id ?? null;
    if (nextMember !== member) {
      stop();
      member = nextMember;
      if (member) { active = true; commit(emptyDesktopProtocol()); connect(); }
    }
    paint();
  });
  new ResizeObserver(() => { if (data?.member) paint(); }).observe(desk);
  requestSharedDeskUpdate();
}
