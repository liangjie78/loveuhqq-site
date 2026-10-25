import { verifyPassphrase } from '../lib/passphrase';
import { api, ApiError, type SessionState } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession, refreshSession } from '../lib/session';
import { animate } from 'motion';

const root = document.documentElement;
const gate = document.querySelector<HTMLElement>('[data-gate]')!;
const gateCard = gate.querySelector<HTMLElement>('.gate-card')!;
const gatePostmark = gate.querySelector<HTMLElement>('.gate-postmark')!;
const form = gate.querySelector<HTMLFormElement>('[data-gate-form]')!;
const input = gate.querySelector<HTMLInputElement>('[data-gate-input]')!;
const row = gate.querySelector<HTMLElement>('.gate-slots')!;
const error = gate.querySelector<HTMLElement>('[data-gate-error]')!;
const visit = gate.querySelector<HTMLButtonElement>('[data-gate-visit]')!;
const retryLogout = gate.querySelector<HTMLButtonElement>('[data-gate-retry]')!;
const passwordPanel = gate.querySelector<HTMLElement>('[data-gate-password-panel]')!;
const password = gate.querySelector<HTMLInputElement>('[data-gate-password]')!;
const hint = gate.querySelector<HTMLElement>('#gate-hint')!;
const title = gate.querySelector<HTMLElement>('#gate-title')!;
let stage: 'date' | 'password' = 'date';
let checking = false;
let opening = false;
let gateRevision = 0;
let openingAnimations: Array<{ stop: () => void }> = [];
let returnFocus: HTMLElement | null = null;
const logoutUnconfirmedKey = 'loveuhqq_logout_unconfirmed';
let logoutUnconfirmed = false;
try { logoutUnconfirmed = sessionStorage.getItem(logoutUnconfirmedKey) === 'yes'; } catch { /* Storage is optional. */ }
try { logoutUnconfirmed ||= localStorage.getItem(logoutUnconfirmedKey) === 'yes'; } catch { /* Storage is optional. */ }
let logoutChannel: BroadcastChannel | null = null;
try { logoutChannel = new BroadcastChannel('loveuhqq_logout'); } catch { /* Storage events still work. */ }

function clearPassphrase() {
  input.value = '';
  document.dispatchEvent(new Event('gate:reset-passphrase'));
}

function setPageInert(inert: boolean) {
  for (const element of document.body.children) {
    if (element !== gate && element instanceof HTMLElement) element.inert = inert;
  }
}
function stopOpeningAnimations() {
  openingAnimations.forEach(animation => animation.stop());
  openingAnimations = [];
  for (const element of [gateCard, gatePostmark]) {
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
    element.style.removeProperty('translate');
    element.style.removeProperty('rotate');
    element.style.removeProperty('scale');
  }
}
function openGate(trigger?: HTMLElement) {
  gateRevision++;
  stopOpeningAnimations();
  opening = false;
  gate.classList.remove('is-leaving');
  root.classList.remove('is-unlocking');
  returnFocus = trigger ?? null;
  stage = 'date'; clearPassphrase(); password.value = '';
  input.removeAttribute('aria-invalid'); password.removeAttribute('aria-invalid');
  row.hidden = logoutUnconfirmed; passwordPanel.hidden = true;
  title.textContent = logoutUnconfirmed ? '暂时没能退出' : '我们，\n是从哪天开始的？';
  hint.textContent = logoutUnconfirmed ? '这台设备可能仍保持登录。' : '月和日，四位数字';
  error.textContent = logoutUnconfirmed ? '请联网后重试退出。' : '';
  visit.hidden = logoutUnconfirmed; retryLogout.hidden = !logoutUnconfirmed;
  root.classList.add('is-locked'); setPageInert(true);
  (logoutUnconfirmed ? retryLogout : input).focus({ preventScroll: true });
}
async function browse() {
  if (checking || logoutUnconfirmed || opening) return;
  const currentRevision = gateRevision;
  opening = true;
  try {
    try { sessionStorage.setItem('loveuhqq_visited', 'yes'); } catch { /* Browsing still works without storage. */ }
    password.value = '';
    const wasLocked = root.classList.contains('is-locked');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (wasLocked && !reducedMotion) {
      try {
        const stampAnimation = animate(gatePostmark, {
          scale: [1, 1.24, .92, 1],
          rotate: ['-9deg', '-4deg', '-11deg', '-9deg'],
          x: [0, -1.5, 1.5, 0],
        }, { duration: .5, ease: 'easeOut' });
        openingAnimations = [stampAnimation];
        await stampAnimation.finished;
      } catch { /* Finish opening even if an animation is interrupted. */ }
    }
    if (gateRevision !== currentRevision || logoutUnconfirmed) return;

    if (wasLocked) {
      gate.classList.add('is-leaving');
      if (!reducedMotion) root.classList.add('is-unlocking');
      root.classList.remove('is-locked');
      setPageInert(false);

      try {
        if (!reducedMotion) {
          const targets = [...document.body.children].filter((element): element is HTMLElement =>
            element instanceof HTMLElement && element !== gate && !['SCRIPT', 'STYLE'].includes(element.tagName) && !element.hidden,
          );
          const transitions = targets.map((element, index) => animate(element, {
            opacity: [0, 1],
            y: [16, 0],
          }, { duration: .62, delay: index * .035, ease: 'easeOut' }));
          transitions.push(animate(gateCard, {
            opacity: [1, 0],
            y: [0, -14],
            scale: [1, .97],
          }, { duration: .38, ease: 'easeIn' }));
          openingAnimations = transitions;
          await Promise.all(transitions.map(async transition => {
            try { await transition.finished; } catch { /* Finish opening even if an animation is interrupted. */ }
          }));
        }
      } catch { /* Motion failure must not restore the page lock. */
      } finally {
        if (gateRevision === currentRevision) {
          openingAnimations = [];
          gate.classList.remove('is-leaving');
          root.classList.remove('is-unlocking');
        }
      }
    } else {
      root.classList.remove('is-locked');
      setPageInert(false);
    }

    if (gateRevision !== currentRevision || logoutUnconfirmed) return;

    document.dispatchEvent(new CustomEvent('gate:open'));
    (returnFocus ?? document.querySelector<HTMLElement>('#main'))?.focus({ preventScroll: true });
  } finally {
    if (gateRevision === currentRevision) opening = false;
  }
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
    retryLogout.disabled = false;
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
  updateIdentity(state);
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
visit.addEventListener('click', () => void browse());
retryLogout.addEventListener('click', () => void logout(true));
document.querySelectorAll('[data-session-logout]').forEach(button => button.addEventListener('click', () => void logout(false)));
document.querySelectorAll('[data-lock-site]').forEach(button => button.addEventListener('click', () => void logout(true)));
gate.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !checking && !logoutUnconfirmed) { event.preventDefault(); void browse(); }
});
input.addEventListener('input', event => {
  if (!event.isTrusted) return;
  input.removeAttribute('aria-invalid'); error.textContent = '';
});
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
        clearPassphrase(); input.focus(); return;
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
  if (loggedIn) void browse();
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
root.classList.add('gate-ready');
