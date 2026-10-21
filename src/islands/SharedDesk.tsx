import { useDraggable, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { photoUrl, type PrivatePhoto } from '../lib/photos';
import {
  adoptLatestDesktopPosition,
  applyDesktopMessage,
  beginDesktopPut,
  desktopDisconnected,
  emptyDesktopProtocol,
  matchesPendingDesktopSave,
  moveDesktopByArrow,
  moveDesktopByDelta,
  retryDesktopPosition,
  shouldClearPendingDesktopNote,
  type DesktopMessage,
  type DesktopProtocol,
} from '../lib/desktop-client';
import { requestSharedDeskUpdate, type SharedDeskData } from '../lib/shared-desk-events';
import type { DesktopItem } from '../lib/shared-desktop';
import type { MemoryStory } from '../lib/memory-book';
import { publishSession } from '../lib/session';

function DeskCard({
  item,
  story,
  photo,
  width,
  height,
  disabled,
  onOpen,
  onSave,
}: {
  item: DesktopItem;
  story?: MemoryStory;
  photo?: PrivatePhoto;
  width: number;
  height: number;
  disabled: boolean;
  onOpen: () => void;
  onSave: (key: string, event: KeyboardEvent<HTMLElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id, disabled });
  const text = item.kind === 'story' ? story?.title ?? '故事已取下' : item.kind === 'photo' ? photo?.title ?? '照片已取下' : item.text;
  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="memory-desk-item"
      data-desk-id={item.id}
      aria-label={`${text}，方向键调整位置，回车保存`}
      style={{
        left: `${item.x * Math.max(0, width - 150)}px`,
        top: `${item.y * Math.max(0, height - 180)}px`,
        transform: `${transform ? CSS.Translate.toString(transform) : ''} rotate(${item.rotation}deg)`.trim(),
        zIndex: isDragging ? 3 : undefined,
        cursor: disabled ? 'default' : isDragging ? 'grabbing' : undefined,
      }}
      onPointerDownCapture={event => {
        if ((event.target as HTMLElement).closest('button, input, a')) event.stopPropagation();
      }}
      onKeyDown={event => onSave(item.id, event)}
    >
      {item.kind === 'photo' && photo && <img alt={photo.title} src={photoUrl(photo.id, 'thumb')} draggable={false} />}
      <p>{text}</p>
      {(story || photo) && <Button type="button" variant="ghost" onClick={onOpen}>一起翻看</Button>}
    </article>
  );
}

function emptyData(): SharedDeskData | null { return null; }

export default function SharedDesk() {
  const [data, setData] = useState<SharedDeskData | null>(emptyData);
  const [protocol, setProtocol] = useState<DesktopProtocol>(emptyDesktopProtocol);
  const protocolRef = useRef(protocol);
  const dataRef = useRef(data);
  const deskRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const noteSaveRef = useRef<{ mutationId: string; value: string } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<() => void>(() => {});
  const [linkStatus, setLinkStatus] = useState('');
  const [messageStatus, setMessageStatus] = useState('');
  const [conflictStatus, setConflictStatus] = useState('');
  const [choice, setChoice] = useState('');
  const [optimisticPosition, setOptimisticPosition] = useState<DesktopItem | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [deskSize, setDeskSize] = useState({ width: 600, height: 480 });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));

  function commitProtocol(next: DesktopProtocol) {
    protocolRef.current = next;
    setProtocol(next);
    if (!next.pending) setOptimisticPosition(null);
  }

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<SharedDeskData | null>).detail;
      dataRef.current = detail;
      setData(detail);
    };
    window.addEventListener('memory:shared-desk-update', onUpdate);
    requestSharedDeskUpdate();
    return () => window.removeEventListener('memory:shared-desk-update', onUpdate);
  }, []);

  const activeMember = data?.member.id ?? null;
  useEffect(() => {
    const desk = deskRef.current;
    if (!desk || typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(() => setDeskSize({ width: desk.clientWidth, height: desk.clientHeight }));
    resize.observe(desk);
    setDeskSize({ width: desk.clientWidth, height: desk.clientHeight });
    return () => resize.disconnect();
  }, [activeMember]);
  useEffect(() => {
    if (!activeMember) {
      commitProtocol(emptyDesktopProtocol());
      setMessageStatus(''); setConflictStatus(''); setLinkStatus('');
      return;
    }
    commitProtocol(emptyDesktopProtocol());
    setLinkStatus('正在接上共同桌面…');
    let active = true;
    let retryDelay = 1000;
    let socket: WebSocket | null = null;

    const stopTimers = () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      retryRef.current = undefined; heartbeatRef.current = undefined;
    };
    const send = (message: unknown) => {
      if (socket?.readyState !== WebSocket.OPEN) {
        setMessageStatus('连接尚未恢复，这次操作没有保存。');
        return false;
      }
      socket.send(JSON.stringify(message));
      return true;
    };
    const preservePending = () => {
      const current = protocolRef.current;
      if (!current.pending) return;
      commitProtocol(desktopDisconnected(current));
      setConflictStatus('连接断开，这件物品的保存结果还未确认。重连后可以采用桌面位置或重新保存。');
    };
    const connect = () => {
      if (!active || !dataRef.current?.member || socket) return;
      setLinkStatus('正在接上共同桌面…');
      const url = new URL('/api/memory/desktop', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(url);
      socket = nextSocket;
      socketRef.current = nextSocket;
      nextSocket.addEventListener('open', () => {
        if (socket !== nextSocket || !active) return;
        retryDelay = 1000;
        setLinkStatus('已连接。拖动物品后会自动保存，双方可以同时翻看。');
        heartbeatRef.current = setInterval(() => { send({ type: 'ping' }); }, 20_000);
      });
      nextSocket.addEventListener('message', event => {
        if (socket !== nextSocket || !active) return;
        try {
          const message = JSON.parse(event.data) as DesktopMessage;
          const pendingProtocol = protocolRef.current;
          const pendingMutationId = pendingProtocol.pendingMutationId;
          const noteSave = noteSaveRef.current;
          const matchesPendingSave = matchesPendingDesktopSave(pendingProtocol, message);
          const clearNote = shouldClearPendingDesktopNote(pendingProtocol, message, noteSave, noteRef.current?.value);
          const matchesPendingResponse = pendingMutationId !== null
            && (message.type === 'conflict' || message.type === 'error')
            && message.mutationId === pendingMutationId;
          const next = applyDesktopMessage(protocolRef.current, message);
          commitProtocol(next);
          if (message.type === 'conflict' && next.conflicted) setConflictStatus('同一件物品刚被移动了。我的位置还在，选择保留哪一版。');
          if (matchesPendingSave) {
            if (noteSave?.mutationId === message.mutationId) {
              if (clearNote && noteRef.current) {
                noteRef.current.value = '';
              }
              noteSaveRef.current = null;
            }
            setMessageStatus('已收好，另一端也能看到。'); setConflictStatus('');
          } else if (message.type === 'error') {
            setMessageStatus(message.error ?? '桌面操作暂时没有完成。');
            if (next.conflicted) setConflictStatus(message.error ?? '这件物品的保存结果还未确认。');
          }
          if (matchesPendingResponse) noteSaveRef.current = null;
        } catch { setMessageStatus('桌面消息没有读完整，请重新连接。'); }
      });
      nextSocket.addEventListener('close', event => {
        if (socket !== nextSocket) return;
        socket = null; socketRef.current = null;
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = undefined;
        if (!active) return;
        preservePending();
        if (event.code === 4401) {
          publishSession({ authenticated: false, configured: true });
          return;
        }
        setLinkStatus('连接断开，正在重新接上；已保存的位置仍在。');
        retryRef.current = setTimeout(connect, retryDelay);
        retryDelay = Math.min(15_000, retryDelay * 2);
      });
      nextSocket.addEventListener('error', () => { if (socket === nextSocket) setLinkStatus('暂时连不上共同桌面，稍后会重试。'); });
    };

    reconnectRef.current = () => {
      const current = protocolRef.current;
      if (current.pending) {
        commitProtocol(desktopDisconnected(current));
        setConflictStatus('连接断开，这件物品的保存结果还未确认。重连后可以采用桌面位置或重新保存。');
      }
      stopTimers();
      const previous = socket;
      socket = null;
      socketRef.current = null;
      previous?.close();
      setLinkStatus('正在重新连接共同桌面…');
      connect();
    };

    connect();
    return () => {
      active = false;
      reconnectRef.current = () => {};
      stopTimers();
      const previous = socket;
      socket = null;
      if (socketRef.current === previous) socketRef.current = null;
      previous?.close();
      commitProtocol(emptyDesktopProtocol());
      if (noteRef.current) noteRef.current.value = '';
      noteSaveRef.current = null;
    };
  }, [activeMember]);

  const items = protocol.snapshot.items;
  const deskItems = useMemo(() => items.map(item => optimisticPosition?.id === item.id && protocol.pending
    ? { ...item, x: optimisticPosition.x, y: optimisticPosition.y }
    : item), [items, optimisticPosition, protocol.pending]);

  function put(item: DesktopItem, noteValue?: string): boolean {
    const current = protocolRef.current;
    if (current.pending) { setMessageStatus('上一件还在保存，稍等一下。'); return false; }
    const mutationId = crypto.randomUUID();
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) { setMessageStatus('连接尚未恢复，这次操作没有保存。'); return false; }
    socket.send(JSON.stringify({ type: 'put', item, expectedVersion: item.version, mutationId }));
    commitProtocol(beginDesktopPut(current, item, mutationId));
    noteSaveRef.current = noteValue === undefined ? null : { mutationId, value: noteValue };
    setMessageStatus('正在收好这件物品…');
    return true;
  }

  function add(kind: DesktopItem['kind'], refId: string, text = '', noteValue?: string) {
    const current = protocolRef.current;
    if (!dataRef.current?.member) return;
    put({ id: crypto.randomUUID(), kind, refId, text, x: .12 + (current.snapshot.items.length % 4) * .18, y: .12 + (current.snapshot.items.length % 3) * .2, rotation: 0, version: 0 }, noteValue);
  }

  function onDragEnd(event: DragEndEvent) {
    const item = protocolRef.current.snapshot.items.find(value => value.id === String(event.active.id));
    const desk = deskRef.current;
    if (!item || !desk) return;
    const moved = moveDesktopByDelta(item, event.delta.x, event.delta.y, desk.clientWidth, desk.clientHeight);
    if (put(moved)) setOptimisticPosition(moved);
  }

  function onKeySave(id: string, event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || protocolRef.current.pending) return;
    const current = protocolRef.current.snapshot.items.find(item => item.id === id);
    if (!current) return;
    const moved = moveDesktopByArrow(current, event.key);
    if (moved) { event.preventDefault(); put(moved); }
    else if (event.key === 'Enter') { event.preventDefault(); put(current); }
  }

  function retryConflict() {
    const id = crypto.randomUUID();
    const next = retryDesktopPosition(protocolRef.current, id);
    if (!next?.pending || socketRef.current?.readyState !== WebSocket.OPEN) {
      setMessageStatus('连接尚未恢复，这次操作没有保存。');
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'put', item: next.pending, expectedVersion: next.pending.version, mutationId: id }));
    commitProtocol(next);
    setConflictStatus(''); setMessageStatus('正在收好这件物品…');
  }

  function adoptLatest() {
    commitProtocol(adoptLatestDesktopPosition(protocolRef.current));
    setConflictStatus('');
  }

  function reconnect() {
    reconnectRef.current();
  }

  if (!data?.member) return null;
  const stories = data.stories;
  const photos = data.photos;
  const currentView = protocol.snapshot.current;
  const viewStory = currentView?.kind === 'story' ? stories.find(story => story.id === currentView.id) : undefined;
  const viewPhoto = currentView?.kind === 'photo' ? photos.find(photo => photo.id === currentView.id) : undefined;

  return (
    <div className="ui">
      <div className="memory-desk-controls">
        <select aria-label="选择要摆上桌面的故事或照片" value={choice} onChange={event => setChoice(event.target.value)}>
          <option value="">选择故事或照片</option>
          {stories.map(story => <option key={`story:${story.id}`} value={`story:${story.id}`}>故事 · {story.title}</option>)}
          {photos.map(photo => <option key={`photo:${photo.id}`} value={`photo:${photo.id}`}>照片 · {photo.title}</option>)}
        </select>
        <Button type="button" variant="ghost" onClick={() => {
          const [kind, id] = choice.split(':');
          if (id) add(kind as 'story' | 'photo', id);
        }}>摆到桌上</Button>
        <Input ref={noteRef} maxLength={500} placeholder="留张便签或票根" aria-label="便签或票根内容" />
        <Button type="button" variant="ghost" onClick={() => { const input = noteRef.current; if (input?.value.trim()) add('note', '', input.value.trim(), input.value); }}>贴便签</Button>
        <Button type="button" variant="ghost" onClick={() => { const input = noteRef.current; if (input?.value.trim()) add('ticket', '', input.value.trim(), input.value); }}>贴票根</Button>
        <Button type="button" variant="ghost" onClick={reconnect}>重新连接</Button>
      </div>
      <p className="memory-tool-hint" role="status">{messageStatus || linkStatus}</p>
      {protocol.conflicted && <div>
        <p className="memory-tool-hint" role="status">{conflictStatus}</p>
        <Button type="button" variant="ghost" onClick={adoptLatest}>采用桌上新位置</Button>
        <Button type="button" variant="ghost" onClick={retryConflict}>保留我的摆放再保存</Button>
      </div>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div ref={deskRef} className="memory-desk" aria-label="共享桌面">
          {deskItems.map(item => {
            const story = stories.find(value => value.id === item.refId);
            const photo = photos.find(value => value.id === item.refId);
            return <DeskCard
              key={item.id}
              item={item}
              story={story}
              photo={photo}
              width={deskSize.width}
              height={deskSize.height}
              disabled={!!protocol.pending}
              onOpen={() => {
                if (socketRef.current?.readyState !== WebSocket.OPEN) return;
                socketRef.current.send(JSON.stringify({ type: 'view', kind: item.kind, id: item.refId }));
                if (story) document.dispatchEvent(new CustomEvent('memory:open-story', { detail: { id: story.id } }));
              }}
              onSave={onKeySave}
            />;
          })}
        </div>
      </DndContext>
      <p className="memory-tool-hint">
        {currentView && <>{currentView.memberId === data.member.id ? '我' : '对方'}正在翻看：{viewStory?.title ?? viewPhoto?.title ?? '一件物品'} </>}
        {viewStory && <Button type="button" variant="ghost" onClick={() => document.dispatchEvent(new CustomEvent('memory:open-story', { detail: { id: viewStory.id } }))}>跟着翻开</Button>}
        {viewPhoto && <img src={photoUrl(viewPhoto.id, 'thumb')} alt={viewPhoto.title} style={{ maxWidth: 150 }} />}
      </p>
    </div>
  );
}
