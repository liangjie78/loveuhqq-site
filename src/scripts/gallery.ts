import { photoStatusLabels, photos } from '../data/photos';

const root = document.documentElement;
const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (dialog && photos.length > 0) {
  const image = dialog.querySelector<HTMLImageElement>('[data-lightbox-image]')!;
  const title = dialog.querySelector<HTMLElement>('[data-lightbox-title]')!;
  const meta = dialog.querySelector<HTMLElement>('[data-lightbox-meta]')!;
  const previous = dialog.querySelector<HTMLButtonElement>('[data-lightbox-prev]')!;
  const next = dialog.querySelector<HTMLButtonElement>('[data-lightbox-next]')!;
  let index = 0;
  let trigger: HTMLElement | null = null;
  let touchStartX = 0;
  let touchStartY = 0;

  previous.hidden = next.hidden = photos.length < 2;

  const show = (target: number, direction = 0) => {
    index = (target + photos.length) % photos.length;
    const photo = photos[index];
    image.src = photo.src;
    image.alt = photo.alt;
    title.textContent = photo.title;
    meta.textContent = `${photoStatusLabels[photo.status]} · ${index + 1} / ${photos.length}`;
    if (direction !== 0 && !reducedMotion.matches) {
      image.animate(
        [{ opacity: 0, transform: `translateX(${direction * 18}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 360, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      );
    }
  };

  const open = (target: number, from: HTMLElement) => {
    trigger = from;
    show(target);
    dialog.showModal();
    root.classList.add('has-dialog');
  };

  document.querySelectorAll<HTMLAnchorElement>('[data-photo-index]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(Number(link.dataset.photoIndex), link);
    });
  });

  previous.addEventListener('click', () => show(index - 1, -1));
  next.addEventListener('click', () => show(index + 1, 1));
  dialog.querySelector('[data-lightbox-close]')!.addEventListener('click', () => dialog.close());

  dialog.addEventListener('keydown', (event) => {
    if (photos.length < 2) return;
    if (event.key === 'ArrowLeft') show(index - 1, -1);
    else if (event.key === 'ArrowRight') show(index + 1, 1);
    else return;
    event.preventDefault();
  });

  // A click on the backdrop itself (outside the print and buttons) closes.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('touchstart', (event) => {
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }, { passive: true });
  dialog.addEventListener('touchend', (event) => {
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;
    if (photos.length < 2 || Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    if (deltaX < 0) show(index + 1, 1);
    else show(index - 1, -1);
  }, { passive: true });

  dialog.addEventListener('close', () => {
    root.classList.remove('has-dialog');
    trigger?.focus({ preventScroll: true });
  });
}
