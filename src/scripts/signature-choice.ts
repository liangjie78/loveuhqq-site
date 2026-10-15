import { api } from '../lib/cloud-notebook';
import { getSession, onSessionChange, refreshSession } from '../lib/session';
import type { MemoryBootstrap } from '../lib/memory-book';

const panel = document.querySelector<HTMLElement>('[data-signature-choice]');
if (panel) {
  const root: HTMLElement = panel;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-signature]')];
  const status = root.querySelector<HTMLElement>('[data-signature-status]')!;
  const discardIdentityMessage = '还没保存。换身份后，这份内容不会留下。要继续吗？';
  let generation = 0;
  let authenticated = false;
  let choosing = false;
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loveuhqq_member');
  const isUnlocked = () => authenticated && !document.documentElement.classList.contains('is-locked');

  function place(ready: boolean) {
    document.documentElement.classList.toggle('signature-room', ready);
  }
  function render(book: MemoryBootstrap) {
    const memberId = book.member?.id ?? '';
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.signature === memberId && memberId !== '')));
  }
  function postChanged() {
    channel?.postMessage('changed');
    try { localStorage.setItem('loveuhqq_member_changed', String(Date.now())); } catch { /* Optional cross-tab fallback. */ }
  }
  function askOtherDrafts(): Promise<boolean> {
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
  async function refresh() {
    const token = ++generation;
    const ready = isUnlocked();
    place(ready);
    if (!ready) {
      root.hidden = true;
      status.textContent = '';
      buttons.forEach(button => { button.disabled = false; button.setAttribute('aria-pressed', 'false'); });
      return;
    }
    try {
      const book = await api<MemoryBootstrap>('/api/memory/bootstrap');
      if (token !== generation || !isUnlocked()) return;
      render(book);
      root.hidden = false;
      status.textContent = '';
    } catch {
      if (token !== generation || !isUnlocked()) return;
      root.hidden = false;
      status.textContent = '身份暂时未能读取，可以重新选择。';
    }
  }

  buttons.forEach(button => button.addEventListener('click', async () => {
    if (!isUnlocked() || choosing || button.disabled || button.getAttribute('aria-pressed') === 'true') return;
    const id = button.dataset.signature;
    if (id !== 'one' && id !== 'two') return;
    choosing = true;
    let token = 0;
    try {
      const elsewhere = await askOtherDrafts();
      if (!isUnlocked() || button.getAttribute('aria-pressed') === 'true') return;
      if (elsewhere && !window.confirm(discardIdentityMessage)) return;
      token = ++generation;
      buttons.forEach(control => { control.disabled = true; });
      status.textContent = '正在选择…';
      const book = await api<MemoryBootstrap>('/api/memory/identity', { method: 'POST', body: JSON.stringify({ id }) });
      if (token !== generation || !isUnlocked()) return;
      render(book);
      root.hidden = false;
      status.textContent = '';
      postChanged();
      document.dispatchEvent(new Event('memory:identity-changed'));
    } catch {
      if (token === generation && isUnlocked()) status.textContent = '暂时没能选好，请再试一次。';
    } finally {
      choosing = false;
      buttons.forEach(control => { control.disabled = false; });
    }
  }));

  onSessionChange(state => { authenticated = state.authenticated; void refresh(); });
  document.addEventListener('gate:open', () => { void refresh(); });
  void getSession().then(state => { authenticated = state.authenticated; void refresh(); });
  channel?.addEventListener('message', event => {
    const data: unknown = event.data;
    if (typeof data === 'object' && data !== null) return;
    if (data === 'changed') void refresh();
  });
  window.addEventListener('storage', event => { if (event.key === 'loveuhqq_member_changed') void refresh(); });
  window.addEventListener('pagehide', () => {
    generation++;
    authenticated = false;
    root.hidden = true;
    status.textContent = '';
    place(false);
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    void refreshSession().then(state => { authenticated = state.authenticated; void refresh(); }).catch(() => { root.hidden = true; place(false); });
  });
}
