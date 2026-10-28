/** The journal's home page. */
import { animate } from 'motion';
import './days';
import './notebook';
import './photos';
import './letter';
import { mountAura } from '../motion/aura';
import { whenOpen } from '../motion/reveal';

const root = document.documentElement;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');

/* The cover light: brighter, ever so slightly, as the days add up. */
const coverAura = document.querySelector<HTMLCanvasElement>('[data-aura="cover"]');
if (coverAura) {
  const days = Number(coverAura.dataset.days) || 0;
  const narrow = innerWidth < 768;
  mountAura(coverAura, { anchor: narrow ? [.72, .22] : [.78, .36], follow: .22, intensity: .72 + .28 * Math.min(1, days / 365), spread: narrow ? 1.1 : 1 });
}

/* The heart: a click fills it with light and lets a few embers go. */
const heart = document.querySelector<HTMLButtonElement>('[data-heart]');
const embers = document.querySelector<HTMLElement>('[data-embers]');
if (heart && embers) {
  heart.addEventListener('click', event => {
    heart.classList.add('is-lit');
    window.setTimeout(() => heart.classList.remove('is-lit'), 1600);
    if (calm.matches) return;
    animate(heart, { scale: [1, 1.12, .96, 1.07, 1] }, { duration: .9, ease: 'easeOut' });
    const box = heart.getBoundingClientRect();
    const x = event.clientX ? event.clientX - box.left : box.width / 2;
    const y = event.clientY ? event.clientY - box.top : box.height / 2;
    for (let i = 0; i < 9; i++) {
      const ember = document.createElement('span');
      ember.className = 'ember';
      ember.style.left = `${x}px`;
      ember.style.top = `${y}px`;
      ember.style.setProperty('--s', `${(.4 + Math.random() * .7).toFixed(2)}rem`);
      embers.append(ember);
      const angle = (-90 + (i - 4) * 20 + (Math.random() * 16 - 8)) * Math.PI / 180;
      const distance = 80 + Math.random() * 90;
      animate(ember, {
        opacity: [0, 1, 0],
        x: [0, Math.cos(angle) * distance],
        y: [0, Math.sin(angle) * distance - 30],
        scale: [.4, 1, .6],
      }, { duration: 1.4 + Math.random() * .6, ease: [.16, 1, .3, 1], onComplete: () => ember.remove() });
    }
  });
  // A slight lean toward the pointer.
  const cover = heart.closest<HTMLElement>('.cover')!;
  let frame = 0;
  cover.addEventListener('pointermove', event => {
    if (!fine.matches || calm.matches || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const box = cover.getBoundingClientRect();
      const nx = (event.clientX - box.left) / box.width - .5;
      const ny = (event.clientY - box.top) / box.height - .5;
      heart.style.translate = `${(nx * 18).toFixed(1)}px ${(ny * 14).toFixed(1)}px`;
      heart.style.rotate = `${(nx * 6).toFixed(2)}deg`;
    });
  });
}

/* Scroll-linked depth: the cover title drifts, the three prints move at their own pace. */
if (!calm.matches) {
  const title = document.querySelector<HTMLElement>('.cover-title');
  const prints = [...document.querySelectorAll<HTMLElement>('.spread > *')];
  const speeds = [-.06, .08, -.03];
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY;
    if (title && y < innerHeight * 1.2) {
      title.style.transform = `translate3d(0, ${y * .18}px, 0)`;
      title.style.opacity = String(Math.max(0, 1 - y / (innerHeight * .9)));
    }
    const spread = prints[0]?.parentElement;
    if (spread) {
      const box = spread.getBoundingClientRect();
      if (box.bottom > 0 && box.top < innerHeight) {
        const progress = (box.top + box.height / 2 - innerHeight / 2);
        prints.forEach((print, i) => { print.style.transform = `translate3d(0, ${(progress * speeds[i]).toFixed(1)}px, 0)`; });
      }
    }
  };
  addEventListener('scroll', () => { if (!ticking) requestAnimationFrame(update); ticking = true; }, { passive: true });
  update();
}

/* 心里话: the words light up one by one as they are read. */
const noteSection = document.querySelector<HTMLElement>('[data-note-scrub]');
if (noteSection && !calm.matches) {
  root.classList.add('can-scrub');
  const words = noteSection.querySelector<HTMLElement>('.note-words')!;
  const total = noteSection.querySelectorAll('.note-ch').length;
  let ticking = false;
  const update = () => {
    ticking = false;
    const box = noteSection.getBoundingClientRect();
    const travel = box.height - innerHeight;
    const progress = Math.min(1, Math.max(0, -box.top / Math.max(1, travel)));
    words.style.setProperty('--lit', (progress * 1.25 * (total + 1)).toFixed(2));
    noteSection.classList.toggle('is-signed', progress > .78);
  };
  addEventListener('scroll', () => { if (!ticking) requestAnimationFrame(update); ticking = true; }, { passive: true });
  addEventListener('resize', update);
  void whenOpen().then(update);
}
