/** Shared behaviour for every page: gate, theme, masthead, menu, reveals and atmosphere. */
import './gate';
import { startIdentity } from './identity';
import { mountAura } from '../motion/aura';
import { startReveals, whenOpen } from '../motion/reveal';
import { startLamp, startMagnetic, startSmoothScroll } from '../motion/pointer';
import { common } from '../content/copy';

const root = document.documentElement;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
// The bundle is live, so the head script's reveal fail-safe can stand down.
if (root.classList.contains('can-reveal')) root.classList.add('reveal-ready');

/* ---------- Theme ---------- */

const toggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
function paintToggle() {
  const dark = root.classList.contains('dark');
  const label = dark ? common.themeToLight : common.themeToDark;
  toggle?.setAttribute('aria-label', label);
  toggle?.setAttribute('title', label);
  toggle?.setAttribute('aria-pressed', String(dark));
}
function applyTheme(dark: boolean) {
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('loveuhqq_theme', dark ? 'dark' : 'light'); } catch { /* The theme still changes for this page. */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#110d0c' : '#f6f0e8');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
  paintToggle();
}
toggle?.addEventListener('click', () => {
  const next = !root.classList.contains('dark');
  const box = toggle.getBoundingClientRect();
  const start = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition;
  if (!start || calm.matches) { applyTheme(next); return; }
  // Night falls (or morning breaks) in a circle from the switch.
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add('is-theming');
  const transition = start.call(document, () => applyTheme(next));
  transition.ready.then(() => {
    root.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 900, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' })
      .finished.finally(() => root.classList.remove('is-theming'));
  }).catch(() => root.classList.remove('is-theming'));
});
paintToggle();

/* ---------- Masthead ---------- */

const header = document.querySelector<HTMLElement>('[data-header]');
if (header) {
  let lastY = scrollY;
  let ticking = false;
  const nights = [...document.querySelectorAll<HTMLElement>('.is-night')];
  const update = () => {
    ticking = false;
    const y = scrollY;
    header.classList.toggle('is-scrolled', y > 8);
    // Tuck away while reading downward; come back the moment the reader looks up.
    const menuOpen = root.classList.contains('menu-open');
    if (!menuOpen && Math.abs(y - lastY) > 6) header.classList.toggle('is-tucked', y > lastY && y > innerHeight * .6);
    lastY = y;
    const line = header.offsetHeight / 2;
    root.classList.toggle('is-night-under', nights.some(section => {
      const box = section.getBoundingClientRect();
      return box.top <= line && box.bottom >= line;
    }));
  };
  addEventListener('scroll', () => { if (!ticking) requestAnimationFrame(update); ticking = true; }, { passive: true });
  addEventListener('resize', update);
  header.addEventListener('focusin', () => header.classList.remove('is-tucked'));
  update();
}

/* ---------- Chapter indicator ---------- */

const pill = document.querySelector<HTMLElement>('[data-pillnav]');
const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-nav-link], [data-menu-link]')];
const glow = document.querySelector<HTMLElement>('[data-pillnav-glow]');
function moveGlow(link: HTMLAnchorElement | null) {
  if (!glow || !pill) return;
  if (!link) { glow.classList.remove('is-on'); return; }
  const base = pill.getBoundingClientRect();
  const box = link.getBoundingClientRect();
  glow.style.width = `${box.width}px`;
  glow.style.transform = `translateX(${box.left - base.left}px)`;
  glow.classList.add('is-on');
}
if (links.length && 'IntersectionObserver' in window) {
  const sections = [...new Set(links.map(link => link.hash))].map(hash => document.querySelector<HTMLElement>(hash)).filter((section): section is HTMLElement => !!section);
  const inView = new Set<Element>();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target); else inView.delete(entry.target);
    }
    const active = sections.find(section => inView.has(section));
    for (const link of links) {
      if (active && link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    moveGlow(pill?.querySelector<HTMLAnchorElement>('[aria-current]') ?? null);
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(section => observer.observe(section));
  addEventListener('resize', () => moveGlow(pill?.querySelector<HTMLAnchorElement>('[aria-current]') ?? null));
}

/* ---------- Menu sheet ---------- */

const menuToggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const menu = document.querySelector<HTMLElement>('[data-menu]');
if (menuToggle && menu) {
  const setMenu = (open: boolean, restore = true) => {
    menuToggle.setAttribute('aria-expanded', String(open));
    root.classList.toggle('menu-open', open);
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
      menu.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    } else {
      menu.classList.remove('is-open');
      window.setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, calm.matches ? 0 : 900);
      if (restore) menuToggle.focus({ preventScroll: true });
    }
  };
  menuToggle.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', event => { if ((event.target as Element).closest('a')) setMenu(false, false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && root.classList.contains('menu-open')) setMenu(false); });
  matchMedia('(min-width: 64rem)').addEventListener('change', event => { if (event.matches) setMenu(false, false); });
}

/* ---------- Atmosphere ---------- */

const gateAura = document.querySelector<HTMLCanvasElement>('[data-aura="gate"]');
if (gateAura) mountAura(gateAura, { anchor: [.72, .42], follow: .18, intensity: .85, spread: 1.15 });
const footerAura = document.querySelector<HTMLCanvasElement>('[data-aura="footer"]');
if (footerAura) mountAura(footerAura, { anchor: [.5, .95], follow: .1, intensity: .55, spread: 1.4 });

startIdentity();
startMagnetic();
startLamp();
startSmoothScroll();
void whenOpen().then(() => {
  root.classList.add('is-open');
  startReveals();
});
