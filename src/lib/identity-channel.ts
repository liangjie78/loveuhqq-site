/** Cross-tab coordination for the shared signature (男生 / 女生). */
export const discardIdentityMessage = '还没保存。换身份后，这份内容不会留下。要继续吗？';

export function openIdentityChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loveuhqq_member');
}

/** Asks other tabs whether they hold unsaved private drafts; resolves false after 200 ms. */
export function askOtherDrafts(channel: BroadcastChannel | null): Promise<boolean> {
  if (!channel) return Promise.resolve(false);
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    let settled = false;
    const finish = (dirty: boolean) => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('message', onMessage);
      resolve(dirty);
    };
    const onMessage = (event: MessageEvent) => {
      const record = event.data as { type?: unknown; id?: unknown } | null;
      if (typeof record === 'object' && record !== null && record.type === 'dirty' && record.id === id) finish(true);
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'query-dirty', id });
    window.setTimeout(() => finish(false), 200);
  });
}

export function broadcastMemberChange(channel: BroadcastChannel | null): void {
  channel?.postMessage('changed');
  try { localStorage.setItem('loveuhqq_member_changed', String(Date.now())); } catch { /* Optional cross-tab fallback. */ }
}
