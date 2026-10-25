import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from 'radix-ui';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { api } from '../lib/cloud-notebook';
import { beginMemberRequest, isLatestMemberRequest, selectMember, setCurrentMember } from '../lib/member';
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
  const [open, setOpen] = useState(false);
  const generation = useRef(0);

  const isUnlocked = useCallback(() => authenticated && !document.documentElement.classList.contains('is-locked'), [authenticated]);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    const requestId = beginMemberRequest();
    const ready = isUnlocked();
    if (!ready) {
      setUnlocked(false);
      setOpen(false);
      setStatus('');
      setCurrentMember(null);
      return;
    }
    try {
      const book = await api<MemoryBootstrap>('/api/memory/bootstrap');
      if (token !== generation.current || !isLatestMemberRequest(requestId) || !isUnlocked()) return;
      setCurrentMember(book.member?.id ?? null, requestId);
      setUnlocked(true);
      setStatus('');
    } catch {
      if (token !== generation.current || !isLatestMemberRequest(requestId) || !isUnlocked()) return;
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
      setOpen(false);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void refreshSession().then(state => {
        if (!state.authenticated) return;
        void refresh();
      }).catch(() => { setUnlocked(false); setOpen(false); });
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
      generation.current++;
      setCurrentMember(null);
      setUnlocked(false);
      setStatus('');
      setOpen(false);
      return;
    }
    if (!document.documentElement.classList.contains('is-locked')) void refresh();
  }, [authenticated, refresh]);

  async function choose(id: string) {
    if (!isUnlocked() || busy || (id !== 'one' && id !== 'two') || id === memberId) return;
    const token = ++generation.current;
    const requestId = beginMemberRequest();
    setBusy(true);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loveuhqq_member');
    try {
      const elsewhere = await askOtherDrafts(channel);
      if (token !== generation.current || !isLatestMemberRequest(requestId) || !isUnlocked() || id === memberStore.getState().memberId) return;
      if (elsewhere && !window.confirm(discardIdentityMessage)) return;
      setStatus('正在选择…');
      const book = await selectMember(id, undefined, requestId);
      if (!book || token !== generation.current || !isLatestMemberRequest(requestId) || !isUnlocked()) return;
      setUnlocked(true);
      setStatus('');
      setOpen(false);
      broadcastMemberChange(channel);
      document.dispatchEvent(new Event('memory:identity-changed'));
    } catch {
      if (token === generation.current && isLatestMemberRequest(requestId) && isUnlocked()) setStatus('暂时没能选好，请再试一次。');
    } finally {
      channel?.close();
      setBusy(false);
    }
  }

  return (
    <span className="signature-choice" data-signature-choice hidden={!unlocked}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button className="signature-trigger" type="button" disabled={busy} aria-label={memberId ? '切换身份' : '请选择身份'}>
            {memberId === 'one' ? '男生' : memberId === 'two' ? '女生' : '选择身份'}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="signature-menu ui" align="end" sideOffset={10} collisionPadding={16}>
            <Popover.Title className="sr-only">请选择身份</Popover.Title>
            <ToggleGroup
              type="single"
              value={memberId ?? ''}
              onValueChange={value => { if (value) void choose(value); }}
              orientation="vertical"
              className="signature-options"
              aria-label="请选择身份"
              disabled={busy}
              data-signature-options
            >
              <ToggleGroupItem value="one" data-signature="one">男生<Check size={14} aria-hidden="true" /></ToggleGroupItem>
              <ToggleGroupItem value="two" data-signature="two">女生<Check size={14} aria-hidden="true" /></ToggleGroupItem>
            </ToggleGroup>
            <p className="signature-status" data-signature-status role="status">{status}</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
