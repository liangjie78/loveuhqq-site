import type { DesktopItem, DesktopSnapshot } from './shared-desktop';

export interface DesktopProtocol {
  snapshot: DesktopSnapshot;
  pending: DesktopItem | null;
  pendingMutationId: string | null;
  conflicted: DesktopItem | null;
  status: 'idle' | 'saving' | 'saved' | 'disconnected' | 'conflict' | 'error';
}

export interface DesktopMessage {
  type?: string;
  mutationId?: string;
  state?: DesktopSnapshot;
  error?: string;
}

export const emptyDesktopProtocol = (): DesktopProtocol => ({
  snapshot: { revision: 0, items: [], current: null },
  pending: null,
  pendingMutationId: null,
  conflicted: null,
  status: 'idle',
});

export function beginDesktopPut(protocol: DesktopProtocol, item: DesktopItem, mutationId: string): DesktopProtocol {
  if (protocol.pending) return protocol;
  return { ...protocol, pending: item, pendingMutationId: mutationId, status: 'saving' };
}

export function matchesPendingDesktopSave(protocol: DesktopProtocol, message: DesktopMessage): boolean {
  return message.type === 'saved'
    && protocol.pendingMutationId !== null
    && message.mutationId === protocol.pendingMutationId;
}

export function shouldClearPendingDesktopNote(
  protocol: DesktopProtocol,
  message: DesktopMessage,
  noteSave: { mutationId: string; value: string } | null,
  currentValue: string | undefined,
): boolean {
  return matchesPendingDesktopSave(protocol, message)
    && noteSave !== null
    && noteSave.mutationId === message.mutationId
    && noteSave.value === currentValue;
}

export function applyDesktopMessage(protocol: DesktopProtocol, message: DesktopMessage): DesktopProtocol {
  let next = protocol;
  if (message.state && message.state.revision >= protocol.snapshot.revision) {
    next = { ...next, snapshot: message.state };
  }
  if (message.type === 'conflict' && message.mutationId === protocol.pendingMutationId && protocol.pending) {
    return { ...next, conflicted: protocol.pending, pending: null, pendingMutationId: null, status: 'conflict' };
  }
  if (message.type === 'saved' && message.mutationId === protocol.pendingMutationId) {
    return { ...next, pending: null, pendingMutationId: null, conflicted: null, status: 'saved' };
  }
  if (message.type === 'error') {
    return { ...next, conflicted: protocol.pending ?? protocol.conflicted, pending: null, pendingMutationId: null, status: 'error' };
  }
  return next;
}

export function desktopDisconnected(protocol: DesktopProtocol): DesktopProtocol {
  if (!protocol.pending) return protocol;
  return { ...protocol, conflicted: protocol.pending, pending: null, pendingMutationId: null, status: 'disconnected' };
}

export function adoptLatestDesktopPosition(protocol: DesktopProtocol): DesktopProtocol {
  return { ...protocol, conflicted: null, status: 'idle' };
}

export function retryDesktopPosition(protocol: DesktopProtocol, mutationId: string): DesktopProtocol | null {
  if (!protocol.conflicted) return null;
  const latest = protocol.snapshot.items.find(item => item.id === protocol.conflicted!.id);
  const pending = { ...protocol.conflicted, version: latest?.version ?? 0 };
  return { ...protocol, pending, pendingMutationId: mutationId, conflicted: null, status: 'saving' };
}

export function moveDesktopByDelta(item: DesktopItem, deltaX: number, deltaY: number, width: number, height: number): DesktopItem {
  return {
    ...item,
    x: Math.max(0, Math.min(1, item.x + deltaX / Math.max(1, width - 150))),
    y: Math.max(0, Math.min(1, item.y + deltaY / Math.max(1, height - 180))),
  };
}

export function moveDesktopByArrow(item: DesktopItem, key: string): DesktopItem | null {
  const offsets: Record<string, [number, number]> = {
    ArrowLeft: [-.03, 0], ArrowRight: [.03, 0], ArrowUp: [0, -.03], ArrowDown: [0, .03],
  };
  const delta = offsets[key];
  if (!delta) return null;
  return { ...item, x: Math.max(0, Math.min(1, item.x + delta[0])), y: Math.max(0, Math.min(1, item.y + delta[1])) };
}
