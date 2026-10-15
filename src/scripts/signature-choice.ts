import { api } from '../lib/cloud-notebook';
import { getSession, onSessionChange } from '../lib/session';
import type { MemoryBootstrap } from '../lib/memory-book';
const root = document.querySelector<HTMLElement>('[data-signature-choice]')!;
const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-signature]')];
const label = root.querySelector<HTMLElement>('[data-signature-label]')!;
const status = root.querySelector<HTMLElement>('[data-signature-status]')!;
let generation = 0;
let authenticated = false;
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loveuhqq_member');
function render(book: MemoryBootstrap) {
  label.textContent = book.member ? `当前身份：${book.member.id === 'one' ? '男生' : '女生'}` : '请选择身份';
  buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.signature === book.member?.id)));
}
async function refresh() {
  const token = ++generation;
  root.hidden = !authenticated;
  if (!authenticated) { label.textContent = '请选择身份'; status.textContent = ''; buttons.forEach(button => button.setAttribute('aria-pressed', 'false')); return; }
  try { const book = await api<MemoryBootstrap>('/api/memory/bootstrap'); if (token === generation) render(book); }
  catch { if (token === generation) status.textContent = '身份暂时未能读取，可以重新选择。'; }
}
buttons.forEach(button => button.addEventListener('click', async () => {
  const token = ++generation;
  buttons.forEach(control => { control.disabled = true; }); status.textContent = '正在选择…';
  try {
    const book = await api<MemoryBootstrap>('/api/memory/identity', { method: 'POST', body: JSON.stringify({ id: button.dataset.signature }) });
    if (token !== generation || !authenticated) return;
    render(book); status.textContent = '';
    document.dispatchEvent(new Event('memory:identity-changed')); channel?.postMessage('changed');
    try { localStorage.setItem('loveuhqq_member_changed', String(Date.now())); } catch { /* Optional cross-tab fallback. */ }
  } catch { if (token === generation) status.textContent = '暂时没能选好，请再试一次。'; }
  finally { buttons.forEach(control => { control.disabled = false; }); }
}));
onSessionChange(state => { authenticated = state.authenticated; void refresh(); });
void getSession().then(state => { authenticated = state.authenticated; void refresh(); });
channel?.addEventListener('message', () => { void refresh(); });
window.addEventListener('storage', event => { if (event.key === 'loveuhqq_member_changed') void refresh(); });
window.addEventListener('pagehide', () => { authenticated = false; void refresh(); });
window.addEventListener('pageshow', event => { if (event.persisted) void getSession().then(state => { authenticated = state.authenticated; void refresh(); }); });
