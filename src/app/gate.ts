import { animate } from 'motion';
import { verifyPassphrase } from '../lib/passphrase';
import { api, ApiError, type SessionState } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession, refreshSession } from '../lib/session';
import { gate as copy } from '../content/copy';

const root = document.documentElement;
const gate = document.querySelector<HTMLElement>('[data-gate]')!;
const stage = gate.querySelector<HTMLElement>('[data-gate-stage]')!;
const bloom = gate.querySelector<HTMLElement>('[data-gate-bloom]')!;
const form = gate.querySelector<HTMLFormElement>('[data-gate-form]')!;
const code = gate.querySelector<HTMLElement>('[data-gate-code]')!;
const input = gate.querySelector<HTMLInputElement>('[data-gate-input]')!;
const slots = [...gate.querySelectorAll<HTMLElement>('[data-slot]')];
const error = gate.querySelector<HTMLElement>('[data-gate-error]')!;
const visit = gate.querySelector<HTMLButtonElement>('[data-gate-visit]')!;
const retryLogout = gate.querySelector<HTMLButtonElement>('[data-gate-retry]')!;
const passwordPanel = gate.querySelector<HTMLElement>('[data-gate-password-panel]')!;
const password = gate.querySelector<HTMLInputElement>('[data-gate-password]')!;
const submitButton = gate.querySelector<HTMLButtonElement>('[data-gate-submit]')!;
const hint = gate.querySelector<HTMLElement>('[data-gate-hint]')!;
const title = gate.querySelector<HTMLElement>('[data-gate-title]')!;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let step: 'date' | 'password' = 'date';
let checking = false;
let opening = false;
let gateRevision = 0;
let running: Array<{ stop: () => void }> = [];
let returnFocus: HTMLElement | null = null;
const logoutUnconfirmedKey = 'loveuhqq_logout_unconfirmed';
let logoutUnconfirmed = false;
try { logoutUnconfirmed = sessionStorage.getItem(logoutUnconfirmedKey) === 'yes'; } catch { /* Storage is optional. */ }
try { logoutUnconfirmed ||= localStorage.getItem(logoutUnconfirmedKey) === 'yes'; } catch { /* Storage is optional. */ }
let logoutChannel: BroadcastChannel | null = null;
try { logoutChannel = new BroadcastChannel('loveuhqq_logout'); } catch { /* Storage events still work. */ }

/* ---------- The four digits ---------- */

function paintSlots() {
  const value = input.value;
  const focused = document.activeElement === input;
  slots.forEach((slot, index) => {
    const char = value[index] ?? '';
    if (slot.textContent !== char) {
      slot.textContent = char;
      slot.classList.remove('is-filled');
      if (char) { void slot.offsetWidth; slot.classList.add('is-filled'); }
    }
    slot.classList.toggle('is-active', focused && index === Math.min(value.length, 3) && value.length < 4);
  });
}
function clearPassphrase() { input.value = ''; paintSlots(); }
input.addEventListener('input', () => {
  input.value = input.value.replace(/\D/g, '').slice(0, 4);
  input.removeAttribute('aria-invalid');
  code.classList.remove('is-wrong');
  error.textContent = '';
  paintSlots();
  if (input.value.length === 4) form.requestSubmit();
});
input.addEventListener('focus', paintSlots);
input.addEventListener('blur', paintSlots);
document.addEventListener('selectionchange', () => { if (document.activeElement === input) paintSlots(); });

/* ---------- Open / close ---------- */

function setPageInert(inert: boolean) {
  for (const element of document.body.children) {
    if (element !== gate && element instanceof HTMLElement && !element.classList.contains('grain') && !element.classList.contains('lamp')) element.inert = inert;
  }
}
function stopRunning() {
  running.forEach(animation => animation.stop());
  running = [];
  for (const element of [stage, bloom, gate]) {
    for (const property of ['opacity', 'transform', 'filter', 'scale']) element.style.removeProperty(property);
  }
}
function openGate(trigger?: HTMLElement) {
  gateRevision++;
  stopRunning();
  opening = false;
  gate.classList.remove('is-leaving');
  returnFocus = trigger ?? null;
  step = 'date'; clearPassphrase(); password.value = '';
  input.removeAttribute('aria-invalid'); password.removeAttribute('aria-invalid');
  code.classList.remove('is-wrong');
  code.hidden = logoutUnconfirmed; passwordPanel.hidden = true;
  title.textContent = logoutUnconfirmed ? '暂时没能退出' : copy.question.join('\n');
  hint.textContent = logoutUnconfirmed ? '这台设备可能仍保持登录。' : copy.hint;
  error.textContent = logoutUnconfirmed ? '请联网后重试退出。' : '';
  visit.hidden = logoutUnconfirmed; retryLogout.hidden = !logoutUnconfirmed;
  root.classList.add('is-locked'); setPageInert(true);
  if (!calm()) running = [animate(stage, { opacity: [0, 1], transform: ['translateY(24px)', 'translateY(0px)'] }, { duration: .9, ease: [.16, 1, .3, 1] })];
  (logoutUnconfirmed ? retryLogout : input).focus({ preventScroll: true });
  paintSlots();
}

async function browse(origin?: HTMLElement) {
  if (checking || logoutUnconfirmed || opening) return;
  const revision = gateRevision;
  opening = true;
  try {
    try { sessionStorage.setItem('loveuhqq_visited', 'yes'); } catch { /* Browsing still works without storage. */ }
    password.value = '';
    const wasLocked = root.classList.contains('is-locked');
    if (wasLocked && !calm()) {
      // 光绽: light blooms from where the answer was given, then the gate dissolves into the page.
      const box = (origin ?? code).getBoundingClientRect();
      bloom.style.setProperty('--bx', `${box.left + box.width / 2}px`);
      bloom.style.setProperty('--by', `${box.top + box.height / 2}px`);
      const reach = Math.hypot(innerWidth, innerHeight) / 5;
      gate.classList.add('is-leaving');
      root.classList.remove('is-locked');
      setPageInert(false);
      try {
        running = [
          animate(stage, { opacity: [1, 0], filter: ['blur(0px)', 'blur(8px)'], transform: ['translateY(0px) scale(1)', 'translateY(-16px) scale(.98)'] }, { duration: .55, ease: [.65, 0, .35, 1] }),
          animate(bloom, { opacity: [0, 1, 0], transform: ['scale(1)', `scale(${reach})`] }, { duration: 1.5, ease: [.16, 1, .3, 1] }),
          animate(gate, { opacity: [1, 0] }, { duration: .9, delay: .45, ease: [.33, 1, .68, 1] }),
        ];
        await Promise.all(running.map(async animation => { try { await (animation as unknown as { finished: Promise<unknown> }).finished; } catch { /* Keep opening. */ } }));
      } catch { /* Motion failure must not restore the lock. */ }
      finally {
        if (gateRevision === revision) { running = []; stopRunning(); gate.classList.remove('is-leaving'); }
      }
    } else {
      root.classList.remove('is-locked');
      setPageInert(false);
    }
    if (gateRevision !== revision || logoutUnconfirmed) return;
    document.dispatchEvent(new CustomEvent('gate:open'));
    (returnFocus ?? document.querySelector<HTMLElement>('#main'))?.focus({ preventScroll: true });
  } finally {
    if (gateRevision === revision) opening = false;
  }
}

/* ---------- Session plumbing (unchanged behaviour) ---------- */

function updateHeader(state: SessionState) {
  document.querySelectorAll<HTMLElement>('[data-header-session]').forEach(header => {
    header.querySelector<HTMLElement>('[data-open-login]')!.hidden = state.authenticated;
    header.querySelector<HTMLElement>('[data-session-label]')!.hidden = !state.authenticated;
    header.querySelector<HTMLElement>('[data-session-logout]')!.hidden = !state.authenticated;
  });
  root.classList.toggle('is-signed-in', state.authenticated);
}
function notifyOtherTabs() {
  try { localStorage.setItem('loveuhqq_session_changed', `${Date.now()}-${Math.random()}`); } catch { /* Optional notification. */ }
}
function broadcastLogout(pending: boolean) {
  try { logoutChannel?.postMessage(pending); } catch { /* Storage events still work. */ }
}
function syncLogoutFromOtherTab(pending: boolean) {
  // Revoke private content before any asynchronous session confirmation.
  if (!pending) publishSession({ authenticated: false, configured: true }, false);
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
  if (pending) publishSession({ authenticated: false, configured: true }, true);
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
    publishSession(state, false); notifyOtherTabs();
    succeeded = true;
  } catch {
    logoutUnconfirmed = true;
    try { sessionStorage.setItem(logoutUnconfirmedKey, 'yes'); } catch { /* Storage is optional. */ }
    try { localStorage.setItem(logoutUnconfirmedKey, 'yes'); } catch { /* Storage is optional. */ }
    broadcastLogout(true);
    openGate();
    publishSession({ authenticated: false, configured: true }, true);
  } finally { checking = false; retryLogout.disabled = false; }
  if (succeeded) {
    if (showGate) { window.scrollTo(0, 0); openGate(); }
    else void browse();
  }
}

onSessionChange(state => {
  if (logoutUnconfirmed && state.authenticated) {
    publishSession({ authenticated: false, configured: state.configured }, true);
    return;
  }
  updateHeader(state);
  if (state.authenticated && root.classList.contains('is-locked') && !checking && !logoutUnconfirmed) void browse();
});
if (logoutUnconfirmed) {
  openGate();
  publishSession({ authenticated: false, configured: true }, true);
}
document.addEventListener('click', event => {
  const trigger = (event.target as Element).closest<HTMLElement>('[data-open-login]');
  if (trigger) openGate(trigger);
});
visit.addEventListener('click', () => void browse(visit));
retryLogout.addEventListener('click', () => void logout(true));
document.querySelectorAll('[data-session-logout]').forEach(button => button.addEventListener('click', () => void logout(false)));
document.querySelectorAll('[data-lock-site]').forEach(button => button.addEventListener('click', () => void logout(true)));
gate.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !checking && !logoutUnconfirmed) { event.preventDefault(); void browse(); }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (checking || logoutUnconfirmed) return;
  if (step === 'date' && input.value.length !== 4) {
    error.textContent = '还差几位数字。'; input.focus(); return;
  }
  if (step === 'password' && !password.value) {
    error.textContent = '输入共同手账的密码。'; password.focus(); return;
  }
  checking = true;
  submitButton.disabled = true;
  let loggedIn = false;
  try {
    if (step === 'date') {
      if (!await verifyPassphrase(input.value)) {
        error.textContent = '好像不对，再想想。'; input.setAttribute('aria-invalid', 'true');
        code.classList.remove('is-wrong'); void code.offsetWidth; code.classList.add('is-wrong');
        clearPassphrase(); input.focus(); return;
      }
      step = 'password'; code.hidden = true; passwordPanel.hidden = false;
      title.textContent = '翻开我们的共同手账'; hint.textContent = '';
      error.textContent = '';
      if (!calm()) animate([title, passwordPanel], { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'], filter: ['blur(6px)', 'blur(0px)'] }, { duration: .8, ease: [.16, 1, .3, 1] });
      password.focus();
    } else {
      const state = await api<SessionState>('/api/session', { method: 'POST', body: JSON.stringify({ password: password.value, remember: true }) });
      publishSession(state); notifyOtherTabs(); loggedIn = true;
    }
  } catch (cause) {
    error.textContent = cause instanceof ApiError ? cause.message : '暂时连不上手账，请稍后重试。';
    if (step === 'password') { password.setAttribute('aria-invalid', 'true'); password.focus(); }
  } finally { checking = false; submitButton.disabled = false; }
  if (loggedIn) void browse(submitButton);
});
password.addEventListener('input', () => { error.textContent = ''; password.removeAttribute('aria-invalid'); });

if (root.classList.contains('is-locked')) {
  setPageInert(true);
  title.textContent = logoutUnconfirmed ? title.textContent : copy.question.join('\n');
  (logoutUnconfirmed ? retryLogout : input).focus({ preventScroll: true });
  paintSlots();
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
root.classList.add('gate-ready');
