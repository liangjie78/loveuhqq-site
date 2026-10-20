import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { api } from '../lib/cloud-notebook';
import { selectMember, setCurrentMember } from '../lib/member';
import type { MemoryBootstrap } from '../lib/memory-book';
import { getSession, refreshSession } from '../lib/session';
import { memberStore } from '../stores/member';
import { sessionStore } from '../stores/session';

const discardIdentityMessage = '还没保存。换身份后，这份内容不会留下。要继续吗？';

function askOtherDrafts(channel: BroadcastChannel | null): Promise<boolean> {
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
      const data: unknown = event.data;
      const record = data as { type?: unknown; id?: unknown };
      if (typeof data === 'object' && data !== null && record.type === 'dirty' && record.id === id) finish(true);
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'query-dirty', id });
    window.setTimeout(() => finish(false), 200);
  });
}

function broadcastMemberChange(channel: BroadcastChannel | null) {
  channel?.postMessage('changed');
  try { localStorage.setItem('loveuhqq_member_changed', String(Date.now())); } catch { /* Optional cross-tab fallback. */ }
}

export default function SignatureChoice() {
  const authenticated = useStore(sessionStore, state => state.authenticated);
  const memberId = useStore(memberStore, state => state.memberId);
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const isUnlocked = useCallback(() => authenticated && !document.documentElement.classList.contains('is-locked'), [authenticated]);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    const ready = isUnlocked();
    document.documentElement.classList.toggle('signature-room', ready);
    if (!ready) {
      setUnlocked(false);
      setStatus('');
      setCurrentMember(null);
      return;
    }
    try {
      const book = await api<MemoryBootstrap>('/api/memory/bootstrap');
      if (token !== generation.current || !isUnlocked()) return;
      setCurrentMember(book.member?.id ?? null);
      setUnlocked(true);
      setStatus('');
    } catch {
      if (token !== generation.current || !isUnlocked()) return;
      setUnlocked(true);
      setStatus('身份暂时未能读取，可以重新选择。');
    }
  }, [isUnlocked]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loveuhqq_member');
    const onGateOpen = () => { void refresh(); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'loveuhqq_member_changed') void refresh(); };
    const onPageHide = () => {
      generation.current++;
      setUnlocked(false);
      setStatus('');
      setCurrentMember(null);
      document.documentElement.classList.remove('signature-room');
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void refreshSession().then(state => {
        if (!state.authenticated) return;
        void refresh();
      }).catch(() => { setUnlocked(false); document.documentElement.classList.remove('signature-room'); });
    };
    const onChannel = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === 'object' && data !== null) return;
      if (data === 'changed') void refresh();
    };

    channel?.addEventListener('message', onChannel);
    document.addEventListener('gate:open', onGateOpen);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    void getSession().then(() => refresh()).catch(() => { setUnlocked(false); });
    return () => {
      channel?.removeEventListener('message', onChannel);
      channel?.close();
      document.removeEventListener('gate:open', onGateOpen);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refresh]);

  useEffect(() => {
    if (!authenticated) {
      setCurrentMember(null);
      setUnlocked(false);
      setStatus('');
      document.documentElement.classList.remove('signature-room');
      return;
    }
    if (!document.documentElement.classList.contains('is-locked')) void refresh();
  }, [authenticated, refresh]);

  async function choose(id: string) {
    if (!isUnlocked() || busy || (id !== 'one' && id !== 'two') || id === memberId) return;
    setBusy(true);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loveuhqq_member');
    try {
      const elsewhere = await askOtherDrafts(channel);
      if (!isUnlocked() || id === memberStore.getState().memberId) return;
      if (elsewhere && !window.confirm(discardIdentityMessage)) return;
      setStatus('正在选择…');
      await selectMember(id as 'one' | 'two');
      if (!isUnlocked()) return;
      setUnlocked(true);
      setStatus('');
      broadcastMemberChange(channel);
      document.dispatchEvent(new Event('memory:identity-changed'));
    } catch {
      if (isUnlocked()) setStatus('暂时没能选好，请再试一次。');
    } finally {
      channel?.close();
      setBusy(false);
    }
  }

  return (
    <div className="signature-choice ui" data-signature-choice hidden={!unlocked}>
      <p className="signature-label" data-signature-label aria-hidden="true">请选择身份</p>
      <ToggleGroup
        type="single"
        value={memberId ?? ''}
        onValueChange={value => { if (value) void choose(value); }}
        className="signature-options"
        aria-label="请选择身份"
        disabled={busy}
        data-signature-options
      >
        <ToggleGroupItem value="one" data-signature="one">男生</ToggleGroupItem>
        <ToggleGroupItem value="two" data-signature="two">女生</ToggleGroupItem>
      </ToggleGroup>
      <p className="signature-status" data-signature-status role="status">{status}</p>
    </div>
  );
}
