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
const remember = gate.querySelector<HTMLInputElement>('[data-gate-remember]')!;
const passwordPanel = gate.querySelector<HTMLElement>('[data-gate-password-panel]')!;
const password = gate.querySelector<HTMLInputElement>('[data-gate-password]')!;
const hint = gate.querySelector<HTMLElement>('#gate-hint')!;
const title = gate.querySelector<HTMLElement>('#gate-title')!;
let stage: 'date' | 'password' = 'date';
let checking = false;
let returnFocus: HTMLElement | null = null;

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
  row.hidden = false; passwordPanel.hidden = true;
  title.textContent = '我们，是从哪天开始的？';
  hint.textContent = '月和日，四位数字'; error.textContent = '';
  root.classList.add('is-locked'); setPageInert(true);
  renderSlots(); input.focus({ preventScroll: true });
}
function browse() {
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
async function logout(showGate: boolean) {
  if (checking) return;
  checking = true;
  try {
    const state = await api<SessionState>('/api/session', { method: 'DELETE' });
    publishSession(state); notifyOtherTabs();
    if (showGate) { window.scrollTo(0, 0); openGate(); }
  } catch {
    openGate(); error.textContent = '暂时没能退出，请联网后重试。';
  } finally { checking = false; }
}

root.classList.add('gate-ready');
onSessionChange(state => {
  updateIdentity(state);
  if (state.authenticated && root.classList.contains('is-locked') && !checking) browse();
});
document.addEventListener('click', event => {
  const trigger = (event.target as Element).closest<HTMLElement>('[data-open-login]');
  if (trigger) openGate(trigger);
});
gate.querySelector('[data-gate-visit]')!.addEventListener('click', browse);
document.querySelectorAll('[data-session-logout]').forEach(button => button.addEventListener('click', () => void logout(false)));
document.querySelectorAll('[data-lock-site]').forEach(button => button.addEventListener('click', () => void logout(true)));
gate.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !checking) { event.preventDefault(); browse(); }
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
  if (checking) return;
  if (stage === 'date' && input.value.length !== 4) {
    error.textContent = '还差几位数字。'; input.focus(); return;
  }
  if (stage === 'password' && !password.value) {
    error.textContent = '输入共同手账的密码。'; password.focus(); return;
  }
  checking = true;
  const submit = passwordPanel.querySelector<HTMLButtonElement>('button')!;
  submit.disabled = true;
  try {
    if (stage === 'date') {
      if (!await verifyPassphrase(input.value)) {
        error.textContent = '好像不对，再想想。'; input.setAttribute('aria-invalid', 'true');
        input.value = ''; renderSlots(); input.focus(); return;
      }
      stage = 'password'; row.hidden = true; passwordPanel.hidden = false;
      title.textContent = '翻开我们的共同手账'; hint.textContent = '输入密码后，两个人都能记下和修改。';
      error.textContent = ''; password.focus();
    } else {
      const state = await api<SessionState>('/api/session', { method: 'POST',
        body: JSON.stringify({ password: password.value, remember: remember.checked }) });
      publishSession(state); notifyOtherTabs(); browse();
    }
  } catch (cause) {
    error.textContent = cause instanceof ApiError ? cause.message : '暂时连不上手账，请稍后重试。';
    if (stage === 'password') { password.setAttribute('aria-invalid', 'true'); password.focus(); }
  } finally { checking = false; submit.disabled = false; }
});
password.addEventListener('input', () => { error.textContent = ''; password.removeAttribute('aria-invalid'); });
if (root.classList.contains('is-locked')) { setPageInert(true); input.focus({ preventScroll: true }); }
void getSession().catch(() => { error.textContent = '共同手账暂时连不上，可以先以访客浏览。'; });
window.addEventListener('storage', event => {
  if (event.key === 'loveuhqq_session_changed') void refreshSession().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshSession().catch(() => {});
});
