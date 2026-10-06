import { dotted } from '../lib/anniversary';
import { api, ApiError } from '../lib/cloud-notebook';
import { featuredPhotos, parsePhotoManifest, photoSummary, photoUrl, type PrivatePhoto } from '../lib/photos';
import { getSession, onSessionChange, publishSession } from '../lib/session';

const root = document.documentElement;
const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]')!;
const walls = [...document.querySelectorAll<HTMLElement>('[data-photo-wall]')];
// The locked placeholders are restored whenever the session ends.
const placeholders = new Map(walls.map(wall => [wall, [...wall.children].map(child => child.cloneNode(true))]));
const locked = document.querySelectorAll<HTMLElement>('[data-photos-locked]');
const status = document.querySelector<HTMLElement>('[data-photos-status]');
const retry = document.querySelector<HTMLButtonElement>('[data-photos-retry]');
const summary = document.querySelector<HTMLElement>('[data-photos-summary]');
const albumLinks = document.querySelectorAll<HTMLAnchorElement>('[data-album-link]');
const lockedSummary = summary?.textContent ?? '';

const print = dialog.querySelector<HTMLElement>('.lightbox-print')!;
let image = dialog.querySelector<HTMLImageElement>('[data-lightbox-image]')!;
const title = dialog.querySelector<HTMLElement>('[data-lightbox-title]')!;
const meta = dialog.querySelector<HTMLElement>('[data-lightbox-meta]')!;
const previous = dialog.querySelector<HTMLButtonElement>('[data-lightbox-prev]')!;
const next = dialog.querySelector<HTMLButtonElement>('[data-lightbox-next]')!;

let authenticated = false;
let loaded = false;
let generation = 0;
let request: AbortController | null = null;
let pendingAlbum = false;
let current: PrivatePhoto[] = [];
let index = 0;
let imageGeneration = 0;
let pendingImage: HTMLImageElement | null = null;
let trigger: HTMLElement | null = null;
let touchStartX = 0;
let touchStartY = 0;

const dateLabel = (photo: PrivatePhoto) => (photo.date ? dotted(photo.date) : '');

function discardPendingImage() {
  const pending = pendingImage;
  pendingImage = null;
  pending?.removeAttribute('src');
}

function card(photo: PrivatePhoto, list: PrivatePhoto[], position: number, pink: boolean): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'polaroid polaroid-private';
  link.href = photoUrl(photo.id, 'large');
  link.setAttribute('aria-label', `${photo.title}${photo.date ? `，${dateLabel(photo)}` : ''}，查看大图`);
  const tape = document.createElement('span');
  tape.className = pink ? 'tape tape-pink' : 'tape';
  tape.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.src = photoUrl(photo.id, 'thumb');
  img.alt = photo.title;
  img.width = photo.width;
  img.height = photo.height;
  img.loading = 'lazy';
  img.decoding = 'async';
  const caption = document.createElement('span');
  caption.className = 'polaroid-caption';
  const name = document.createElement('span');
  name.className = 'polaroid-title';
  name.textContent = photo.title;
  caption.append(name);
  if (photo.date) {
    const date = document.createElement('time');
    date.className = 'polaroid-tag';
    date.dateTime = photo.date;
    date.textContent = dateLabel(photo);
    caption.append(date);
  }
  link.append(tape, img, caption);
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(list, position, link);
  });
  return link;
}

function emptySlot(): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'polaroid polaroid-empty';
  slot.setAttribute('aria-hidden', 'true');
  slot.innerHTML = '<span class="polaroid-slot"><span>留给下一张</span></span><span class="polaroid-caption"><span class="polaroid-title">&nbsp;</span></span>';
  return slot;
}

function setStatus(message: string, canRetry = false) {
  if (status) { status.textContent = message; status.hidden = !message; }
  if (retry) retry.hidden = !canRetry;
}

function clearPhotos() {
  generation++;
  imageGeneration++;
  discardPendingImage();
  request?.abort();
  request = null;
  loaded = false;
  if (dialog.open) dialog.close();
  image.removeAttribute('src');
  title.textContent = meta.textContent = '';
  current = [];
  for (const wall of walls) wall.replaceChildren(...placeholders.get(wall)!.map(node => node.cloneNode(true)));
  locked.forEach(element => { element.hidden = false; });
  if (summary) summary.textContent = lockedSummary;
  setStatus('');
}

function render(photos: PrivatePhoto[], featured: PrivatePhoto[]) {
  for (const wall of walls) {
    const list = wall.dataset.photoWall === 'featured' ? featured : photos;
    const cards: HTMLElement[] = list.map((photo, position) => card(photo, list, position, position % 3 === 1));
    if (wall.dataset.photoWall === 'all') cards.push(emptySlot());
    wall.replaceChildren(...cards);
  }
  locked.forEach(element => { element.hidden = true; });
  if (summary) summary.textContent = photoSummary(photos.length);
}

async function loadPhotos() {
  if (!authenticated || loaded || request) return;
  const currentGeneration = ++generation;
  const controller = new AbortController();
  request = controller;
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  setStatus('正在翻开相册…');
  try {
    const manifest = parsePhotoManifest(await api('/api/photos', { signal: controller.signal }));
    if (!authenticated || generation !== currentGeneration) return;
    loaded = true;
    render(manifest.photos, featuredPhotos(manifest));
    setStatus('');
  } catch (error) {
    if (!authenticated || generation !== currentGeneration) return;
    if (error instanceof ApiError && error.status === 401) {
      clearPhotos();
      publishSession({ authenticated: false, configured: true });
      return;
    }
    setStatus('相册暂时打不开，请稍后再试。', true);
  } finally {
    window.clearTimeout(timeout);
    if (generation === currentGeneration) request = null;
  }
}

async function show(target: number) {
  index = (target + current.length) % current.length;
  const photo = current[index];
  const position = index;
  const currentImageGeneration = ++imageGeneration;
  discardPendingImage();
  const nextImage = new Image(photo.width, photo.height);
  pendingImage = nextImage;
  nextImage.dataset.lightboxImage = '';
  nextImage.alt = photo.title;
  nextImage.src = photoUrl(photo.id, 'large');
  if (dialog.open) {
    try {
      await nextImage.decode();
    } catch {
      if (imageGeneration === currentImageGeneration) {
        pendingImage = null;
        meta.textContent = '照片暂时打不开，请稍后再试。';
      }
      return;
    }
  }
  if (imageGeneration !== currentImageGeneration) return;
  pendingImage = null;
  // Keep the current print intact until the next image is ready, then swap together.
  print.style.setProperty('--ratio', String(photo.width / photo.height));
  image.replaceWith(nextImage);
  image = nextImage;
  title.textContent = photo.title;
  meta.textContent = [dateLabel(photo), `${position + 1} / ${current.length}`].filter(Boolean).join(' · ');
}

function open(list: PrivatePhoto[], target: number, from: HTMLElement) {
  current = list;
  trigger = from;
  previous.hidden = next.hidden = list.length < 2;
  show(target);
  dialog.showModal();
  root.classList.add('has-dialog');
}

previous.addEventListener('click', () => void show(index - 1));
next.addEventListener('click', () => void show(index + 1));
dialog.querySelector('[data-lightbox-close]')!.addEventListener('click', () => dialog.close());

dialog.addEventListener('keydown', (event) => {
  if (current.length < 2) return;
  if (event.key === 'ArrowLeft') void show(index - 1);
  else if (event.key === 'ArrowRight') void show(index + 1);
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
  if (current.length < 2 || Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
  if (deltaX < 0) void show(index + 1);
  else void show(index - 1);
}, { passive: true });

dialog.addEventListener('close', () => {
  imageGeneration++;
  discardPendingImage();
  root.classList.remove('has-dialog');
  if (!root.classList.contains('is-locked')) trigger?.focus({ preventScroll: true });
});

// Visitors who reach for the album get the lock first, then the album once unlocked.
albumLinks.forEach(link => link.addEventListener('click', (event) => {
  if (authenticated || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    link.removeAttribute('data-open-login');
    return;
  }
  event.preventDefault();
  pendingAlbum = true;
  // The gate owns the delegated click and restores focus to this link.
  link.setAttribute('data-open-login', '');
}));
document.addEventListener('gate:open', () => {
  if (pendingAlbum && authenticated) window.location.assign('/photos/');
  pendingAlbum = false;
});

retry?.addEventListener('click', () => void loadPhotos());
onSessionChange(state => {
  authenticated = state.authenticated;
  if (authenticated) {
    albumLinks.forEach(link => link.removeAttribute('data-open-login'));
    void loadPhotos();
  } else {
    clearPhotos();
  }
});
document.addEventListener('click', event => {
  if ((event.target as Element).closest('[data-session-logout], [data-lock-site]')) {
    pendingAlbum = false;
    clearPhotos();
  }
}, { capture: true });
// A page restored from the back/forward cache must not show photos without a session.
window.addEventListener('pagehide', clearPhotos);
window.addEventListener('pageshow', (event) => { if (event.persisted) void loadPhotos(); });
void getSession().catch(() => { /* The gate handles unavailable sessions. */ });
