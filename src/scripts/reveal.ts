import { animate, inView } from 'motion';

const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
  items.forEach(item => item.classList.add('is-in'));
  root.classList.remove('can-reveal');
  root.classList.add('reveal-ready');
} else if (items.length > 0) {
  root.classList.add('reveal-ready');
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
    if (!event.matches) return;
    root.classList.remove('can-reveal');
    items.forEach(item => item.classList.add('is-in'));
  });
  items.forEach(item => {
    inView(item, () => {
      const pastCells = item.matches('.year')
        ? [...item.querySelectorAll<HTMLElement>('.year-cells > .is-past')]
        : [];
      const emptyColors = pastCells.map(cell => getComputedStyle(cell).backgroundColor);
      item.classList.add('is-in');
      if (prefersReducedMotion()) return;
      animate(item, { opacity: [0, 1], y: [24, 0] }, { duration: 1, ease: 'easeOut' });

      if (pastCells.length) {
        const totalDelay = 0.3;
        pastCells.forEach((cell, index) => {
          const finalColor = getComputedStyle(cell).backgroundColor;
          animate(cell, {
            backgroundColor: [emptyColors[index], finalColor],
            scale: [.35, 1],
          }, {
            duration: .7,
            delay: totalDelay * index / Math.max(1, pastCells.length - 1),
            ease: 'easeOut',
            onComplete: () => {
              cell.style.removeProperty('background-color');
              cell.style.removeProperty('scale');
            },
          });
        });
      }
    }, { margin: '0px 0px -10% 0px', amount: .12 });
  });
} else {
  root.classList.remove('can-reveal');
  root.classList.add('reveal-ready');
}
