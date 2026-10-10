import { dotted } from '../lib/anniversary';
import { api, ApiError } from '../lib/cloud-notebook';
import {
  featuredPhotos, parsePhotoManifest, photoSummary, photoUrl, type PhotoManifest, type PrivatePhoto,
} from '../lib/photos';
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

const pasteDialog = document.querySelector<HTMLDialogElement>('[data-paste-photo]');
const pasteForm = pasteDialog?.querySelector<HTMLFormElement>('[data-paste-form]');
const pasteFile = pasteDialog?.querySelector<HTMLInputElement>('[data-paste-file]');
const pastePick = pasteDialog?.querySelector<HTMLButtonElement>('[data-paste-pick]');
const pasteEmpty = pasteDialog?.querySelector<HTMLElement>('[data-paste-empty]');
const pastePreview = pasteDialog?.querySelector<HTMLImageElement>('[data-paste-preview]');
const pasteSwap = pasteDialog?.querySelector<HTMLButtonElement>('[data-paste-swap]');
const pasteTitle = pasteDialog?.querySelector<HTMLInputElement>('[data-paste-title]');
const pasteDate = pasteDialog?.querySelector<HTMLInputElement>('[data-paste-date]');
const pasteError = pasteDialog?.querySelector<HTMLElement>('[data-paste-error]');
const pasteCancel = pasteDialog?.querySelector<HTMLButtonElement>('[data-paste-cancel]');
const pasteSubmit = pasteDialog?.querySelector<HTMLButtonElement>('[data-paste-submit]');

let authenticated = false;
let loaded = false;
let generation = 0;
let request: AbortController | null = null;
let uploadRequest: AbortController | null = null;
let pendingAlbum = false;
let current: PrivatePhoto[] = [];
let index = 0;
let imageGeneration = 0;
let pendingImage: HTMLImageElement | null = null;
let trigger: HTMLElement | null = null;
let touchStartX = 0;
let touchStartY = 0;
let revision = 0;
let pasteSource: File | null = null;
let pastePreviewUrl = '';
let titleDirty = false;
let addTrigger: HTMLButtonElement | null = null;
let uploading = false;

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
  link.dataset.photoId = photo.id;
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

function addSlot(): HTMLButtonElement {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = 'polaroid polaroid-empty polaroid-add';
  slot.setAttribute('aria-label', '贴一张照片');
  slot.innerHTML = '<span class="polaroid-slot"><span class="polaroid-add-main">贴一张</span><span class="polaroid-add-sub">留给下一张</span></span><span class="polaroid-caption"><span class="polaroid-title">&nbsp;</span></span>';
  slot.addEventListener('click', () => openPaste(slot));
  return slot;
}

function setStatus(message: string, canRetry = false) {
  if (status) { status.textContent = message; status.hidden = !message; }
  if (retry) retry.hidden = !canRetry;
}

function setPasteError(message: string) {
  if (!pasteError) return;
  pasteError.textContent = message;
  pasteError.hidden = !message;
}

function revokePreview() {
  if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
  pastePreviewUrl = '';
}

function resetPasteForm() {
  uploadRequest?.abort();
  uploadRequest = null;
  uploading = false;
  pasteSource = null;
  titleDirty = false;
  revokePreview();
  if (pasteFile) pasteFile.value = '';
  if (pasteTitle) pasteTitle.value = '';
  if (pasteDate) pasteDate.value = '';
  if (pastePreview) { pastePreview.hidden = true; pastePreview.removeAttribute('src'); }
  if (pasteEmpty) pasteEmpty.hidden = false;
  if (pasteSwap) pasteSwap.hidden = true;
  if (pasteSubmit) { pasteSubmit.disabled = false; pasteSubmit.textContent = '贴上'; }
  if (pasteTitle) pasteTitle.disabled = false;
  if (pasteDate) pasteDate.disabled = false;
  if (pastePick) pastePick.disabled = false;
  if (pasteSwap) pasteSwap.disabled = false;
  setPasteError('');
}

function closePaste(restoreFocus = true) {
  if (!pasteDialog?.open) {
    resetPasteForm();
    return;
  }
  pasteDialog.close();
  resetPasteForm();
  if (restoreFocus && !root.classList.contains('is-locked')) {
    addTrigger?.focus({ preventScroll: true });
  }
  addTrigger = null;
}

function openPaste(from: HTMLButtonElement) {
  if (!pasteDialog || !authenticated || !loaded) return;
  addTrigger = from;
  resetPasteForm();
  pasteDialog.showModal();
  root.classList.add('has-dialog');
  pastePick?.focus();
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').normalize('NFC').trim();
  return base.slice(0, 80);
}

/** Best-effort EXIF DateTimeOriginal / DateTime from the first 128 KiB. */
function exifDateFromBytes(buffer: ArrayBuffer): string | null {
  const sample = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 128 * 1024));
  const text = new TextDecoder('latin1').decode(sample);
  const match = text.match(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/);
  if (!match || match[1] === '0000') return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

async function sha16(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function encodeWebp(
  source: ImageBitmap,
  maxWidth: number,
  maxHeight: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => (value ? resolve(value) : reject(new Error('webp'))), 'image/webp', quality);
  });
  return { blob, width, height };
}

async function applySelectedFile(file: File) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name)) {
    setPasteError('换一张照片试试。');
    return;
  }
  pasteSource = file;
  revokePreview();
  pastePreviewUrl = URL.createObjectURL(file);
  if (pastePreview) {
    pastePreview.src = pastePreviewUrl;
    pastePreview.hidden = false;
  }
  if (pasteEmpty) pasteEmpty.hidden = true;
  if (pasteSwap) pasteSwap.hidden = false;
  if (pasteTitle && !titleDirty) pasteTitle.value = titleFromFileName(file.name);
  try {
    const buffer = await file.arrayBuffer();
    const taken = exifDateFromBytes(buffer);
    if (pasteDate) pasteDate.value = taken ?? '';
  } catch {
    if (pasteDate) pasteDate.value = '';
  }
  setPasteError('');
  if (pasteTitle && !pasteTitle.value.trim()) pasteTitle.focus();
}

function applyManifest(manifest: PhotoManifest, focusId?: string) {
  revision = manifest.revision;
  loaded = true;
  render(manifest.photos, featuredPhotos(manifest));
  setStatus('');
  if (focusId) {
    const card = document.querySelector<HTMLElement>(`[data-photo-wall="all"] [data-photo-id="${focusId}"]`);
    card?.focus({ preventScroll: true });
  }
}

function clearPhotos() {
  generation++;
  imageGeneration++;
  discardPendingImage();
  request?.abort();
  request = null;
  uploadRequest?.abort();
  uploadRequest = null;
  loaded = false;
  revision = 0;
  if (dialog.open) dialog.close();
  closePaste(false);
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
    // Empty featured: keep the homepage placeholder prints; never invent picks from photos.
    if (wall.dataset.photoWall === 'featured' && featured.length === 0) {
      wall.replaceChildren(...placeholders.get(wall)!.map(node => node.cloneNode(true)));
      continue;
    }
    const list = wall.dataset.photoWall === 'featured' ? featured : photos;
    const cards: HTMLElement[] = list.map((photo, position) => card(photo, list, position, position % 3 === 1));
    if (wall.dataset.photoWall === 'all') cards.push(addSlot());
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
    applyManifest(manifest);
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

async function submitPaste(event: Event) {
  event.preventDefault();
  if (!pasteDialog || uploading || !authenticated) return;
  if (!pasteSource) {
    setPasteError('先选一张图再贴。');
    pastePick?.focus();
    return;
  }
  const name = pasteTitle?.value.trim() ?? '';
  if (!name) {
    setPasteError('给这张写个名字再贴。');
    pasteTitle?.focus();
    return;
  }
  const dateValue = pasteDate?.value ?? '';
  const date = dateValue || null;
  uploading = true;
  setPasteError('');
  if (pasteSubmit) { pasteSubmit.disabled = true; pasteSubmit.textContent = '正在贴上…'; }
  if (pasteTitle) pasteTitle.disabled = true;
  if (pasteDate) pasteDate.disabled = true;
  if (pastePick) pastePick.disabled = true;
  if (pasteSwap) pasteSwap.disabled = true;

  const controller = new AbortController();
  uploadRequest = controller;
  const uploadGeneration = generation;
  try {
    const original = await pasteSource.arrayBuffer();
    if (!authenticated || generation !== uploadGeneration) return;
    const id = await sha16(original);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(pasteSource);
    } catch {
      throw new ApiError(400, '换一张照片试试。');
    }
    let thumb: { blob: Blob; width: number; height: number };
    let large: { blob: Blob; width: number; height: number };
    try {
      thumb = await encodeWebp(bitmap, 800, 1000, 0.8);
      large = await encodeWebp(bitmap, 1800, 1800, 0.82);
    } finally {
      bitmap.close();
    }
    if (!authenticated || generation !== uploadGeneration) return;

    const body = new FormData();
    body.set('title', name);
    if (date) body.set('date', date);
    else body.set('date', '');
    body.set('id', id);
    body.set('expectedRevision', String(revision));
    body.set('width', String(large.width));
    body.set('height', String(large.height));
    body.set('thumb', thumb.blob, 'thumb.webp');
    body.set('large', large.blob, 'large.webp');

    const response = await fetch('/api/photos', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      body,
    });
    const result = await response.json().catch(() => ({ error: '这张暂时贴不上，再试一次。' }));
    if (!authenticated || generation !== uploadGeneration) return;
    if (!response.ok) {
      if (response.status === 401) {
        clearPhotos();
        publishSession({ authenticated: false, configured: true });
        return;
      }
      if (response.status === 409) {
        loaded = false;
        await loadPhotos();
        throw new ApiError(409, result.error ?? '相册刚在其他设备更新，请刷新后再贴。');
      }
      throw new ApiError(response.status, result.error ?? '这张暂时贴不上，再试一次。');
    }
    const manifest = parsePhotoManifest(result);
    closePaste(false);
    applyManifest(manifest, id);
  } catch (error) {
    if (!authenticated || generation !== uploadGeneration) return;
    if ((error as Error).name === 'AbortError') return;
    const message = error instanceof ApiError ? error.message : '这张暂时贴不上，再试一次。';
    setPasteError(message);
    if (pasteSubmit) { pasteSubmit.disabled = false; pasteSubmit.textContent = '再试一次'; }
    if (pasteTitle) pasteTitle.disabled = false;
    if (pasteDate) pasteDate.disabled = false;
    if (pastePick) pastePick.disabled = false;
    if (pasteSwap) pasteSwap.disabled = false;
  } finally {
    if (generation === uploadGeneration) {
      uploadRequest = null;
      uploading = false;
    }
  }
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
  if (!pasteDialog?.open) root.classList.remove('has-dialog');
  if (!root.classList.contains('is-locked')) trigger?.focus({ preventScroll: true });
});

if (pasteDialog && pasteForm && pasteFile && pastePick) {
  pastePick.addEventListener('click', () => pasteFile.click());
  pasteSwap?.addEventListener('click', () => pasteFile.click());
  pasteFile.addEventListener('change', () => {
    const file = pasteFile.files?.[0];
    if (file) void applySelectedFile(file);
  });
  pasteTitle?.addEventListener('input', () => { titleDirty = true; });
  pasteCancel?.addEventListener('click', () => closePaste(true));
  pasteForm.addEventListener('submit', event => void submitPaste(event));
  pasteDialog.addEventListener('click', (event) => {
    if (event.target === pasteDialog) closePaste(true);
  });
  pasteDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePaste(true);
  });
  pasteDialog.addEventListener('close', () => {
    if (!dialog.open) root.classList.remove('has-dialog');
  });
}

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
