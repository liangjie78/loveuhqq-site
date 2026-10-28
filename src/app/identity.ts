import { api } from '../lib/cloud-notebook';
import { beginMemberRequest, isLatestMemberRequest, selectMember, setCurrentMember } from '../lib/member';
import type { MemoryBootstrap } from '../lib/memory-book';
import { getSession, refreshSession } from '../lib/session';
import { memberStore } from '../stores/member';
import { sessionStore } from '../stores/session';
import { askOtherDrafts, broadcastMemberChange, discardIdentityMessage, openIdentityChannel } from '../lib/identity-channel';

/** The header signature picker on the journal: a small slip under the name. */
export function startIdentity(): void {
  const box = document.querySelector<HTMLElement>('[data-identity]');
  if (!box) return;
  const slip: HTMLElement = box;
  const trigger = box.querySelector<HTMLButtonElement>('[data-identity-trigger]')!;
  const name = box.querySelector<HTMLElement>('[data-identity-name]')!;
  const menu = box.querySelector<HTMLElement>('[data-identity-menu]')!;
  const options = [...box.querySelectorAll<HTMLButtonElement>('[data-identity-option]')];
  const status = box.querySelector<HTMLElement>('[data-identity-status]')!;
  const root = document.documentElement;
  let generation = 0;
  let busy = false;

  const isUnlocked = () => sessionStore.getState().authenticated && !root.classList.contains('is-locked');
  const setOpen = (open: boolean, focusTrigger = false) => {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) (options.find(option => option.getAttribute('aria-pressed') === 'true') ?? options[0]).focus();
    else if (focusTrigger) trigger.focus();
  };
  const paint = () => {
    const id = memberStore.getState().memberId;
    name.textContent = id === 'one' ? '男生' : id === 'two' ? '女生' : '选择身份';
    trigger.setAttribute('aria-label', id ? '切换身份' : '请选择身份');
    options.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.identityOption === id)));
    trigger.disabled = busy;
    options.forEach(option => { option.disabled = busy; });
  };
  memberStore.subscribe(paint);

  const hide = () => { slip.hidden = true; setOpen(false); status.textContent = ''; };
  async function refresh() {
    const token = ++generation;
    const requestId = beginMemberRequest();
    if (!isUnlocked()) { hide(); setCurrentMember(null); return; }
    try {
      const book = await api<MemoryBootstrap>('/api/memory/bootstrap');
      if (token !== generation || !isLatestMemberRequest(requestId) || !isUnlocked()) return;
      setCurrentMember(book.member?.id ?? null, requestId);
      slip.hidden = false; status.textContent = '';
    } catch {
      if (token !== generation || !isLatestMemberRequest(requestId) || !isUnlocked()) return;
      slip.hidden = false; status.textContent = '身份暂时未能读取，可以重新选择。';
    }
  }

  async function choose(id: 'one' | 'two') {
    if (!isUnlocked() || busy || id === memberStore.getState().memberId) { setOpen(false, true); return; }
    const token = ++generation;
    const requestId = beginMemberRequest();
    busy = true; paint();
    const channel = openIdentityChannel();
    try {
      const elsewhere = await askOtherDrafts(channel);
      if (token !== generation || !isLatestMemberRequest(requestId) || !isUnlocked() || id === memberStore.getState().memberId) return;
      if (elsewhere && !window.confirm(discardIdentityMessage)) return;
      status.textContent = '正在选择…';
      const book = await selectMember(id, undefined, requestId);
      if (!book || token !== generation || !isLatestMemberRequest(requestId) || !isUnlocked()) return;
      status.textContent = '';
      setOpen(false, true);
      broadcastMemberChange(channel);
      document.dispatchEvent(new Event('memory:identity-changed'));
    } catch {
      if (token === generation && isLatestMemberRequest(requestId) && isUnlocked()) status.textContent = '暂时没能选好，请再试一次。';
    } finally {
      channel?.close();
      busy = false; paint();
    }
  }

  trigger.addEventListener('click', () => setOpen(menu.hidden !== false));
  options.forEach(option => option.addEventListener('click', () => void choose(option.dataset.identityOption as 'one' | 'two')));
  menu.addEventListener('keydown', event => {
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
    }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setOpen(false, true); });
  document.addEventListener('click', event => { if (!menu.hidden && !slip.contains(event.target as Node)) setOpen(false); });

  const channel = openIdentityChannel();
  channel?.addEventListener('message', event => { if (event.data === 'changed') void refresh(); });
  document.addEventListener('gate:open', () => void refresh());
  window.addEventListener('storage', event => { if (event.key === 'loveuhqq_member_changed') void refresh(); });
  window.addEventListener('pagehide', () => { generation++; hide(); setCurrentMember(null); });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    void refreshSession().then(state => { if (state.authenticated) void refresh(); }).catch(hide);
  });
  let wasAuthenticated = sessionStore.getState().authenticated;
  sessionStore.subscribe(state => {
    if (state.authenticated === wasAuthenticated) return;
    wasAuthenticated = state.authenticated;
    if (!state.authenticated) { generation++; setCurrentMember(null); hide(); }
    else if (!root.classList.contains('is-locked')) void refresh();
  });
  paint();
  void getSession().then(() => refresh()).catch(hide);
}
