import { animate } from 'motion';
import { dotted, getAnniversaryDay, getNextShanghaiMidnight, hundredthDayDate } from '../lib/anniversary';
import { api, ApiError } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession } from '../lib/session';

/** The hundred-day letter: sealed until its day, read privately, cleared on the way out. */

interface Letter { salutation: string; paragraphs: string[]; closing: string }

const root = document.documentElement;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const envelope = document.querySelector<HTMLButtonElement>('[data-envelope]')!;
const note = document.querySelector<HTMLElement>('[data-envelope-note]')!;
const dialog = document.querySelector<HTMLDialogElement>('[data-letter-dialog]')!;
const status = dialog.querySelector<HTMLElement>('[data-letter-status]')!;
const reading = dialog.querySelector<HTMLElement>('[data-letter-reading]')!;
const retry = dialog.querySelector<HTMLButtonElement>('[data-letter-retry]')!;
const count = document.querySelector<HTMLElement>('[data-letter-count]')!;
const wait = document.querySelector<HTMLElement>('[data-letter-wait]')!;
const ready = document.querySelector<HTMLElement>('[data-letter-ready]')!;
const guestCopy = document.querySelector<HTMLElement>('[data-letter-guest-copy]')!;
const openCopy = document.querySelector<HTMLElement>('[data-letter-open-copy]')!;
const stamp = document.querySelector<HTMLElement>('[data-letter-stamp]')!;
let authenticated = false;
let pendingLogin = false;
let generation = 0;
let request: AbortController | null = null;
let noteTimer: number | undefined;
let midnightTimer: number | undefined;

const canOpen = () => getAnniversaryDay(new Date()) >= 100;

export const validLetter = (letter: Letter) => typeof letter.salutation === 'string' && typeof letter.closing === 'string'
  && Array.isArray(letter.paragraphs) && letter.paragraphs.every(paragraph => typeof paragraph === 'string');

function showNote(message: string) {
  note.textContent = message;
  note.classList.add('is-shown');
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => note.classList.remove('is-shown'), 4500);
}

function clearLetter() {
  generation++;
  request?.abort(); request = null;
  reading.replaceChildren();
  reading.hidden = true;
  status.textContent = '';
  retry.hidden = true;
  dialog.removeAttribute('aria-busy');
}
function closeLetter() {
  clearLetter();
  if (dialog.open) dialog.close();
  envelope.classList.remove('is-opening');
}

function updateDates() {
  const now = new Date();
  const remaining = 100 - getAnniversaryDay(now);
  wait.hidden = remaining <= 0;
  ready.hidden = remaining > 0;
  stamp.textContent = remaining > 0 ? '待拆' : '可拆';
  stamp.classList.toggle('is-ready', remaining <= 0);
  count.hidden = remaining <= 0;
  count.replaceChildren();
  if (remaining > 0) {
    const number = document.createElement('strong');
    number.textContent = String(remaining);
    count.append('还有 ', number, ' 天');
  }
  window.clearTimeout(midnightTimer);
  midnightTimer = window.setTimeout(updateDates, Math.max(1000, getNextShanghaiMidnight(now).getTime() - now.getTime() + 100));
}

function waitForDate() {
  showNote(`还没到拆的时候，${dotted(hundredthDayDate)} 再来。`);
  if (calm.matches) return;
  animate(envelope.querySelector('.envelope-body')!, { rotate: [-4, 0, -7, -2, -5, -4], y: [0, -6, 0, -3, 0] }, { duration: .8, ease: 'easeInOut' });
}

async function loadLetter() {
  clearLetter();
  const token = generation;
  const controller = new AbortController();
  request = controller;
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  status.textContent = '正在拆开这封信…';
  dialog.setAttribute('aria-busy', 'true');
  try {
    const letter = await api<Letter>('/api/letter', { signal: controller.signal });
    if (!authenticated || generation !== token || !dialog.open) return;
    if (!validLetter(letter)) throw new Error('Invalid letter response');
    const paragraphs = [letter.salutation, ...letter.paragraphs, letter.closing];
    reading.replaceChildren(...paragraphs.map((text, index) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      paragraph.style.setProperty('--i', String(Math.min(index, 12)));
      if (index === paragraphs.length - 1) paragraph.className = 'letter-closing';
      return paragraph;
    }));
    status.textContent = '';
    reading.hidden = false;
  } catch (error) {
    if (!authenticated || generation !== token || !dialog.open) return;
    if (error instanceof ApiError && error.status === 401) {
      closeLetter();
      publishSession({ authenticated: false, configured: true });
      showNote('钥匙好像过期了，再打开一次手账再拆信。');
      return;
    }
    status.textContent = error instanceof ApiError && error.status === 403
      ? `还没到拆的时候，北京时间 ${dotted(hundredthDayDate)} 再来。`
      : error instanceof ApiError && error.status === 503 ? '这封信暂时无法打开，请稍后再来。' : '暂时没能打开这封信，请再试一次。';
    retry.hidden = error instanceof ApiError && error.status === 403;
  } finally {
    window.clearTimeout(timeout);
    if (generation === token) { request = null; dialog.removeAttribute('aria-busy'); }
  }
}

function openLetter() {
  if (!authenticated) return;
  if (!canOpen()) { waitForDate(); return; }
  if (dialog.open) return;
  const reveal = () => {
    dialog.showModal();
    root.classList.add('has-dialog');
    dialog.querySelector<HTMLElement>('[data-letter-scroll]')!.scrollTop = 0;
    void loadLetter();
  };
  if (calm.matches) { reveal(); return; }
  // The seal gives, the flap lifts, the page rises — then the reading opens.
  envelope.classList.add('is-opening');
  window.setTimeout(reveal, 1050);
}

envelope.hidden = false;
envelope.addEventListener('click', () => {
  if (!authenticated) { pendingLogin = true; envelope.setAttribute('data-open-login', ''); return; }
  envelope.removeAttribute('data-open-login');
  openLetter();
});
retry.addEventListener('click', () => void loadLetter());
dialog.querySelector('[data-letter-close]')!.addEventListener('click', closeLetter);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeLetter(); });
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeLetter();
});
dialog.addEventListener('close', () => {
  clearLetter();
  root.classList.remove('has-dialog');
  window.setTimeout(() => envelope.classList.remove('is-opening'), 200);
  if (!root.classList.contains('is-locked')) {
    envelope.focus({ preventScroll: true });
    if (authenticated) showNote('信已收好。');
  }
});

onSessionChange(state => {
  const revoked = authenticated && !state.authenticated;
  authenticated = state.authenticated;
  guestCopy.hidden = authenticated;
  openCopy.hidden = !authenticated;
  if (authenticated) envelope.removeAttribute('data-open-login');
  if (!authenticated) closeLetter();
  if (revoked) pendingLogin = false;
  if (pendingLogin && authenticated && !root.classList.contains('is-locked')) { pendingLogin = false; openLetter(); }
});
document.addEventListener('gate:open', () => {
  if (!pendingLogin) return;
  pendingLogin = false;
  if (authenticated) openLetter();
});
document.addEventListener('click', event => {
  if ((event.target as Element).closest('[data-session-logout], [data-lock-site]')) { pendingLogin = false; closeLetter(); }
}, { capture: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateDates(); });
// A page restored from the back/forward cache must not restore private text.
addEventListener('pagehide', closeLetter);
updateDates();
void getSession().catch(() => { /* The gate handles unavailable sessions. */ });
