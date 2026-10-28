import { split } from './split';

/** Scroll reveals: [data-reveal] fades up, [data-split] develops per character. */
export function startReveals(root: ParentNode = document): void {
  const html = document.documentElement;
  const targets = [...root.querySelectorAll<HTMLElement>('[data-reveal], [data-split]')];
  for (const element of targets) if (element.hasAttribute('data-split')) split(element);
  for (const group of root.querySelectorAll<HTMLElement>('[data-reveal-group]')) {
    [...group.querySelectorAll<HTMLElement>(':scope > [data-reveal]')].forEach((child, index) => child.style.setProperty('--d', String(index * 90)));
  }
  if (!html.classList.contains('can-reveal')) { targets.forEach(el => el.classList.add('is-in')); return; }
  html.classList.add('reveal-ready');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: .12 });
  targets.forEach(el => observer.observe(el));
}

/** Resolves once the page is unlocked and the serifs are in. */
export function whenOpen(): Promise<void> {
  const root = document.documentElement;
  const gone = (name: string, event: string) => new Promise<void>(resolve => {
    if (root.classList.contains(name)) document.addEventListener(event, () => resolve(), { once: true });
    else resolve();
  });
  return Promise.all([gone('is-locked', 'gate:open'), gone('fonts-pending', 'fonts:ready')]).then(() => undefined);
}
