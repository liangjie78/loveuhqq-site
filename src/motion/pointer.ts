import Lenis from 'lenis';

const fine = matchMedia('(hover: hover) and (pointer: fine)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');

/** Buttons: the ink pool rises from the entry point, and the button leans toward the pointer. */
export function startMagnetic(): void {
  document.addEventListener('pointerover', event => {
    const target = (event.target as Element).closest<HTMLElement>('.btn');
    if (!target || target.contains(event.relatedTarget as Node)) return;
    const box = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${event.clientX - box.left}px`);
    target.style.setProperty('--my', `${event.clientY - box.top}px`);
  });
  document.addEventListener('pointerout', event => {
    const target = (event.target as Element).closest<HTMLElement>('.btn, [data-magnetic]');
    if (!target || target.contains(event.relatedTarget as Node)) return;
    const box = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${event.clientX - box.left}px`);
    target.style.setProperty('--my', `${event.clientY - box.top}px`);
    target.style.translate = '';
  });
  document.addEventListener('pointermove', event => {
    if (!fine.matches || calm.matches) return;
    const target = (event.target as Element).closest<HTMLElement>('[data-magnetic]');
    if (!target) return;
    const box = target.getBoundingClientRect();
    const x = (event.clientX - box.left - box.width / 2) * .22;
    const y = (event.clientY - box.top - box.height / 2) * .3;
    target.style.translate = `${Math.max(-8, Math.min(8, x))}px ${Math.max(-6, Math.min(6, y))}px`;
  }, { passive: true });
}

/** A soft warm light that trails the pointer. */
export function startLamp(): void {
  const lamp = document.querySelector<HTMLElement>('[data-lamp]');
  if (!lamp || !fine.matches || calm.matches) return;
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, frame = 0;
  const tick = () => {
    x += (tx - x) * .12; y += (ty - y) * .12;
    lamp.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    frame = Math.abs(tx - x) + Math.abs(ty - y) > .5 ? requestAnimationFrame(tick) : 0;
  };
  addEventListener('pointermove', event => {
    tx = event.clientX; ty = event.clientY;
    lamp.classList.add('is-lit');
    if (!frame) frame = requestAnimationFrame(tick);
  }, { passive: true });
  document.addEventListener('pointerleave', () => lamp.classList.remove('is-lit'));
}

let lenis: Lenis | null = null;
export const smooth = () => lenis;

/** Desktop smooth scrolling; paused whenever a gate, dialog or menu owns the page. */
export function startSmoothScroll(): void {
  if (!fine.matches || calm.matches) return;
  const header = () => document.querySelector<HTMLElement>('[data-header]')?.offsetHeight ?? 72;
  lenis = new Lenis({ lerp: .1, smoothWheel: true, anchors: { offset: -(header() + 24) }, prevent: node => node.closest?.('dialog, [data-lenis-prevent]') !== null });
  const loop = (time: number) => { lenis?.raf(time); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const root = document.documentElement;
  const sync = () => {
    const held = root.classList.contains('is-locked') || root.classList.contains('has-dialog') || root.classList.contains('menu-open');
    if (held) lenis?.stop(); else lenis?.start();
  };
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
  sync();
}

/** Scroll that respects smooth scrolling and reduced motion. */
export function scrollToElement(element: Element, offset = 0): void {
  if (lenis) { lenis.scrollTo(element as HTMLElement, { offset: -((document.querySelector<HTMLElement>('[data-header]')?.offsetHeight ?? 72) + 24) + offset }); return; }
  element.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' });
}
