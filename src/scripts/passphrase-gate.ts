import { verifyPassphrase } from '../lib/passphrase';
import { api, ApiError, type SessionState } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession, refreshSession } from '../lib/session';

const root = document.documentElement;
const gate = document.querySelector<HTMLElement>('[data-gate]')!;
const form = gate.querySelector<HTMLFormElement>('[data-gate-form]')!;
const input = gate.querySelector<HTMLInputElement>('[data-gate-input]')!;
const row = gate.querySelector<HTMLElement>('.gate-slots')!;
const slots = [...gate.querySelectorAll<HTMLElement>('[data-slot]')];
const error = gate.querySelector<HTMLElement>('[data-gate-error]')!;
const visit = gate.querySelector<HTMLButtonElement>('[data-gate-visit]')!;
const retryLogout = gate.querySelector<HTMLButtonElement>('[data-gate-retry]')!;
const passwordPanel = gate.querySelector<HTMLElement>('[data-gate-password-panel]')!;
const password = gate.querySelector<HTMLInputElement>('[data-gate-password]')!;
const hint = gate.querySelector<HTMLElement>('#gate-hint')!;
const title = gate.querySelector<HTMLElement>('#gate-title')!;
let stage: 'date' | 'password' = 'date';
let checking = false;
let returnFocus: HTMLElement | null = null;
const logoutUnconfirmedKey = 'loveuhqq_logout_unconfirmed';
let logoutUnconfirmed = false;
try { logoutUnconfirmed = sessionStorage.getItem(logoutUnconfirmedKey) === 'yes'; } catch { /* Storage is optional. */ }
try { logoutUnconfirmed ||= localStorage.getItem(logoutUnconfirmedKey) === 'yes'; } catch { /* Storage is optional. */ }
let logoutChannel: BroadcastChannel | null = null;
try { logoutChannel = new BroadcastChannel('loveuhqq_logout'); } catch { /* Storage events still work. */ }

function setPageInert(inert: boolean) {
  for (const element of document.body.children) {
    if (element !== gate && element instanceof HTMLElement) element.inert = inert;
  }
}
function renderSlots() {
  slots.forEach((slot, i) => {
    slot.textContent = input.value[i] ?? '';
    slot.classList.toggle('is-filled', i < input.value.length);
    slot.classList.toggle('is-active', document.activeElement === input && i === Math.min(input.value.length, 3));
  });
}
function openGate(trigger?: HTMLElement) {
  returnFocus = trigger ?? null;
  stage = 'date'; input.value = ''; password.value = '';
  input.removeAttribute('aria-invalid'); password.removeAttribute('aria-invalid');
  row.hidden = logoutUnconfirmed; passwordPanel.hidden = true;
  title.textContent = logoutUnconfirmed ? '暂时没能退出' : '我们，是从哪天开始的？';
  hint.textContent = logoutUnconfirmed ? '这台设备可能仍保持登录。' : '月和日，四位数字';
  error.textContent = logoutUnconfirmed ? '请联网后重试退出。' : '';
  visit.hidden = logoutUnconfirmed; retryLogout.hidden = !logoutUnconfirmed;
  root.classList.add('is-locked'); setPageInert(true);
  renderSlots(); (logoutUnconfirmed ? retryLogout : input).focus({ preventScroll: true });
}
function browse() {
  if (checking || logoutUnconfirmed) return;
  try { sessionStorage.setItem('loveuhqq_visited', 'yes'); } catch { /* Browsing still works without storage. */ }
  password.value = '';
  root.classList.remove('is-locked'); setPageInert(false);
  document.dispatchEvent(new CustomEvent('gate:open'));
  (returnFocus ?? document.querySelector<HTMLElement>('#main'))?.focus({ preventScroll: true });
}
function updateIdentity(state: SessionState) {
  document.querySelectorAll<HTMLElement>('[data-header-session]').forEach(header => {
    header.querySelector<HTMLElement>('[data-open-login]')!.hidden = state.authenticated;
    header.querySelector<HTMLElement>('[data-session-label]')!.hidden = !state.authenticated;
    header.querySelector<HTMLElement>('[data-session-logout]')!.hidden = !state.authenticated;
  });
}
function notifyOtherTabs() {
  try { localStorage.setItem('loveuhqq_session_changed', `${Date.now()}-${Math.random()}`); } catch { /* Optional notification. */ }
}
function broadcastLogout(pending: boolean) {
  try { logoutChannel?.postMessage(pending); } catch { /* Storage events still work. */ }
}
function syncLogoutFromOtherTab(pending: boolean) {
  if (logoutUnconfirmed === pending) {
    if (!pending) void refreshSession().catch(() => {});
    return;
  }
  logoutUnconfirmed = pending;
  try {
    if (pending) sessionStorage.setItem(logoutUnconfirmedKey, 'yes');
    else sessionStorage.removeItem(logoutUnconfirmedKey);
  } catch { /* Storage is optional. */ }
  openGate();
  if (pending) publishSession({ authenticated: false, configured: true });
  else void refreshSession().catch(() => {});
}
async function logout(showGate: boolean) {
  if (checking) return;
  checking = true;
  retryLogout.disabled = true;
  let succeeded = false;
  try {
    const state = await api<SessionState>('/api/session', { method: 'DELETE' });
    logoutUnconfirmed = false;
    try { sessionStorage.removeItem(logoutUnconfirmedKey); } catch { /* Storage is optional. */ }
    try { localStorage.removeItem(logoutUnconfirmedKey); } catch { /* Storage is optional. */ }
    broadcastLogout(false);
    publishSession(state); notifyOtherTabs();
    succeeded = true;
  } catch {
    logoutUnconfirmed = true;
    try { sessionStorage.setItem(logoutUnconfirmedKey, 'yes'); } catch { /* Storage is optional. */ }
    try { localStorage.setItem(logoutUnconfirmedKey, 'yes'); } catch { /* Storage is optional. */ }
    broadcastLogout(true);
    retryLogout.disabled = false;
    openGate();
    publishSession({ authenticated: false, configured: true });
  } finally { checking = false; retryLogout.disabled = false; }
  if (succeeded) {
    if (showGate) { window.scrollTo(0, 0); openGate(); }
    else browse();
  }
}

root.classList.add('gate-ready');
onSessionChange(state => {
  if (logoutUnconfirmed && state.authenticated) {
    publishSession({ authenticated: false, configured: state.configured });
    return;
  }
  updateIdentity(state);
  if (state.authenticated && root.classList.contains('is-locked') && !checking && !logoutUnconfirmed) browse();
});
if (logoutUnconfirmed) {
  openGate();
  publishSession({ authenticated: false, configured: true });
}
document.addEventListener('click', event => {
  const trigger = (event.target as Element).closest<HTMLElement>('[data-open-login]');
  if (trigger) openGate(trigger);
});
visit.addEventListener('click', browse);
retryLogout.addEventListener('click', () => void logout(true));
document.querySelectorAll('[data-session-logout]').forEach(button => button.addEventListener('click', () => void logout(false)));
document.querySelectorAll('[data-lock-site]').forEach(button => button.addEventListener('click', () => void logout(true)));
gate.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !checking && !logoutUnconfirmed) { event.preventDefault(); browse(); }
});
input.addEventListener('input', () => {
  input.value = input.value.replace(/\D/g, '').slice(0, 4);
  input.removeAttribute('aria-invalid'); error.textContent = ''; renderSlots();
  if (input.value.length === 4) form.requestSubmit();
});
input.addEventListener('focus', renderSlots);
input.addEventListener('blur', renderSlots);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (checking || logoutUnconfirmed) return;
  if (stage === 'date' && input.value.length !== 4) {
    error.textContent = '还差几位数字。'; input.focus(); return;
  }
  if (stage === 'password' && !password.value) {
    error.textContent = '输入共同手账的密码。'; password.focus(); return;
  }
  checking = true;
  const submit = passwordPanel.querySelector<HTMLButtonElement>('button')!;
  submit.disabled = true;
  let loggedIn = false;
  try {
    if (stage === 'date') {
      if (!await verifyPassphrase(input.value)) {
        error.textContent = '好像不对，再想想。'; input.setAttribute('aria-invalid', 'true');
        input.value = ''; renderSlots(); input.focus(); return;
      }
      stage = 'password'; row.hidden = true; passwordPanel.hidden = false;
      title.textContent = '翻开我们的共同手账'; hint.textContent = '';
      error.textContent = ''; password.focus();
    } else {
      const state = await api<SessionState>('/api/session', { method: 'POST',
        body: JSON.stringify({ password: password.value, remember: true }) });
      publishSession(state); notifyOtherTabs(); loggedIn = true;
    }
  } catch (cause) {
    error.textContent = cause instanceof ApiError ? cause.message : '暂时连不上手账，请稍后重试。';
    if (stage === 'password') { password.setAttribute('aria-invalid', 'true'); password.focus(); }
  } finally { checking = false; submit.disabled = false; }
  if (loggedIn) browse();
});
password.addEventListener('input', () => { error.textContent = ''; password.removeAttribute('aria-invalid'); });
if (root.classList.contains('is-locked')) {
  setPageInert(true);
  (logoutUnconfirmed ? retryLogout : input).focus({ preventScroll: true });
}
if (!logoutUnconfirmed) void getSession().catch(() => { if (!logoutUnconfirmed) error.textContent = '共同手账暂时连不上，可以先以访客浏览。'; });
logoutChannel?.addEventListener('message', event => {
  if (typeof event.data === 'boolean') syncLogoutFromOtherTab(event.data);
});
window.addEventListener('storage', event => {
  if (event.key === logoutUnconfirmedKey) { syncLogoutFromOtherTab(event.newValue === 'yes'); return; }
  if (!logoutUnconfirmed && event.key === 'loveuhqq_session_changed') void refreshSession().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (!logoutUnconfirmed && document.visibilityState === 'visible') void refreshSession().catch(() => {});
});
