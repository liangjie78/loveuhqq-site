import { dotted } from '../lib/anniversary';
import { api, ApiError } from '../lib/cloud-notebook';
import {
  featuredPhotoCount, featuredPhotos, parsePhotoManifest, photoSummary, photoUrl, type PhotoManifest, type PrivatePhoto,
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
const manageDialog = document.querySelector<HTMLDialogElement>('[data-photo-manage]');
const editPanel = manageDialog?.querySelector<HTMLElement>('[data-photo-edit-panel]');
const deletePanel = manageDialog?.querySelector<HTMLElement>('[data-photo-delete-panel]');
const titleForm = manageDialog?.querySelector<HTMLFormElement>('[data-photo-title-form]');
const titleInput = manageDialog?.querySelector<HTMLInputElement>('[data-photo-title-input]');
const titleError = manageDialog?.querySelector<HTMLElement>('[data-photo-edit-error]');
const titleSubmit = manageDialog?.querySelector<HTMLButtonElement>('[data-photo-title-submit]');
const deleteCopy = manageDialog?.querySelector<HTMLElement>('[data-photo-delete-copy]');
const deleteError = manageDialog?.querySelector<HTMLElement>('[data-photo-delete-error]');
const deleteConfirm = manageDialog?.querySelector<HTMLButtonElement>('[data-photo-delete-confirm]');
const lightboxManagement = dialog.querySelector<HTMLElement>('[data-lightbox-management]');
const lightboxEdit = dialog.querySelector<HTMLButtonElement>('[data-lightbox-edit]');
const lightboxFeature = dialog.querySelector<HTMLButtonElement>('[data-lightbox-feature]');
const lightboxDelete = dialog.querySelector<HTMLButtonElement>('[data-lightbox-delete]');
const albumPage = walls.some(wall => wall.dataset.photoWall === 'all');

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
let featuredIds = new Set<string>();
let currentKind: 'all' | 'featured' = 'all';
let pasteSource: File | null = null;
let pastePreviewUrl = '';
let titleDirty = false;
let addTrigger: HTMLButtonElement | null = null;
let uploading = false;
let photoMutation: AbortController | null = null;
let photoBusy = false;
let managePhoto: PrivatePhoto | null = null;
let manageTrigger: HTMLElement | null = null;
let manageMode: 'title' | 'delete' | null = null;

const dateLabel = (photo: PrivatePhoto) => (photo.date ? dotted(photo.date) : '');

function makePhotoButton(label: string, action: () => void, className = 'text-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function setImageTone(container: HTMLElement, source: HTMLImageElement) {
  if (!source.complete || !source.naturalWidth || !source.naturalHeight) return;
  try {
    const sample = document.createElement('canvas');
    sample.width = 8;
    sample.height = 8;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(source, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let luminance = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      luminance += (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) * pixels[offset + 3] / 255;
    }
    container.classList.toggle('is-dark-image', luminance / (sample.width * sample.height) < 86);
  } catch {
    container.classList.remove('is-dark-image');
  }
}

function discardPendingImage() {
  const pending = pendingImage;
  pendingImage = null;
  pending?.removeAttribute('src');
}

function card(photo: PrivatePhoto, list: PrivatePhoto[], position: number, pink: boolean, manageable = false): HTMLElement {
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
  img.addEventListener('load', () => setImageTone(link, img), { once: true });
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
    open(list, position, link, manageable ? 'all' : 'featured');
  });
  if (!manageable) return link;

  const entry = document.createElement('div');
  entry.className = 'photo-entry';
  entry.dataset.photoEntryId = photo.id;
  const actions = document.createElement('div');
  actions.className = 'photo-management';
  const edit = makePhotoButton('改标题', () => openPhotoTitle(photo, edit));
  const feature = makePhotoButton(featuredIds.has(photo.id) ? '从首页撤下' : '设为首页精选', () => void toggleFeatured(photo.id, !featuredIds.has(photo.id)));
  const remove = makePhotoButton('从相册取下', () => openPhotoDelete(photo, remove), 'text-button photo-remove-button');
  feature.disabled = !featuredIds.has(photo.id) && featuredIds.size >= featuredPhotoCount;
  if (feature.disabled) feature.title = '首页已经留了三张，请先收下一张。';
  edit.dataset.photoId = feature.dataset.photoId = remove.dataset.photoId = photo.id;
  actions.append(edit, feature, remove);
  entry.append(link, actions);
  return entry;
}

function featuredEmptySlot(): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'polaroid polaroid-empty featured-empty';
  slot.setAttribute('role', 'status');
  slot.setAttribute('aria-label', '首页精选，留给下一张');
  slot.innerHTML = '<span class="polaroid-slot"><span>留给下一张</span></span><span class="polaroid-caption"><span class="polaroid-title">&nbsp;</span></span>';
  return slot;
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
  featuredIds = new Set(manifest.featured);
  loaded = true;
  render(manifest.photos, featuredPhotos(manifest));
  setStatus('');
  if (dialog.open) {
    const activeId = current[index]?.id;
    const updated = currentKind === 'all' ? manifest.photos : featuredPhotos(manifest);
    if (updated.length === 0) dialog.close();
    else {
      const activeIndex = updated.findIndex(photo => photo.id === activeId);
      current = updated;
      void show(activeIndex >= 0 ? activeIndex : Math.min(index, updated.length - 1));
    }
  }
  if (focusId && !manageDialog?.open) {
    const card = document.querySelector<HTMLElement>(`[data-photo-wall="all"] a[data-photo-id="${focusId}"]`);
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
  photoMutation?.abort();
  photoMutation = null;
  photoBusy = false;
  loaded = false;
  revision = 0;
  if (dialog.open) dialog.close();
  closePaste(false);
  closePhotoManage(false);
  image.removeAttribute('src');
  print.classList.remove('is-dark-image');
  if (lightboxManagement) lightboxManagement.hidden = true;
  title.textContent = meta.textContent = '';
  current = [];
  currentKind = 'all';
  featuredIds = new Set();
  for (const wall of walls) wall.replaceChildren(...placeholders.get(wall)!.map(node => node.cloneNode(true)));
  locked.forEach(element => { element.hidden = false; });
  if (summary) summary.textContent = lockedSummary;
  setStatus('');
}

function render(photos: PrivatePhoto[], featured: PrivatePhoto[]) {
  for (const wall of walls) {
    // Empty featured: keep the homepage placeholder prints; never invent picks from photos.
    if (wall.dataset.photoWall === 'featured' && featured.length === 0) {
      wall.replaceChildren(featuredEmptySlot());
      continue;
    }
    const list = wall.dataset.photoWall === 'featured' ? featured : photos;
    const manageable = wall.dataset.photoWall === 'all';
    const cards: HTMLElement[] = list.map((photo, position) => card(photo, list, position, position % 3 === 1, manageable));
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
  print.classList.remove('is-dark-image');
  const nextImage = new Image(photo.width, photo.height);
  pendingImage = nextImage;
  nextImage.dataset.lightboxImage = '';
  nextImage.alt = photo.title;
  nextImage.addEventListener('load', () => {
    if (imageGeneration === currentImageGeneration && image === nextImage) setImageTone(print, nextImage);
  }, { once: true });
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
  setImageTone(print, nextImage);
  title.textContent = photo.title;
  meta.textContent = [dateLabel(photo), `${position + 1} / ${current.length}`].filter(Boolean).join(' · ');
  if (lightboxManagement) lightboxManagement.hidden = !albumPage || !authenticated;
  if (lightboxFeature) {
    const isFeatured = featuredIds.has(photo.id);
    lightboxFeature.textContent = isFeatured ? '从首页撤下' : featuredIds.size >= featuredPhotoCount ? '首页已留三张' : '设为首页精选';
    lightboxFeature.disabled = !isFeatured && featuredIds.size >= featuredPhotoCount;
    lightboxFeature.title = lightboxFeature.disabled ? '首页已经留了三张，请先收下一张。' : '';
  }
}

function open(list: PrivatePhoto[], target: number, from: HTMLElement, kind: 'all' | 'featured') {
  current = list;
  currentKind = kind;
  trigger = from;
  previous.hidden = next.hidden = list.length < 2;
  show(target);
  dialog.showModal();
  root.classList.add('has-dialog');
}

function setManageError(target: HTMLElement | null | undefined, message: string) {
  if (!target) return;
  target.textContent = message;
  target.hidden = !message;
}

function openPhotoTitle(photo: PrivatePhoto, from: HTMLElement) {
  if (!manageDialog || !editPanel || !deletePanel || !titleInput || !authenticated || !loaded) return;
  managePhoto = photo;
  manageTrigger = from;
  manageMode = 'title';
  editPanel.hidden = false;
  deletePanel.hidden = true;
  titleInput.value = photo.title;
  titleInput.disabled = false;
  if (titleSubmit) { titleSubmit.disabled = false; titleSubmit.textContent = '收好标题'; }
  setManageError(titleError, '');
  setManageError(deleteError, '');
  manageDialog.showModal();
  root.classList.add('has-dialog');
  titleInput.focus();
  titleInput.select();
}

function openPhotoDelete(photo: PrivatePhoto, from: HTMLElement) {
  if (!manageDialog || !editPanel || !deletePanel || !deleteCopy || !authenticated || !loaded) return;
  managePhoto = photo;
  manageTrigger = from;
  manageMode = 'delete';
  editPanel.hidden = true;
  deletePanel.hidden = false;
  deleteCopy.textContent = `要把「${photo.title}」从这本相册里取下来吗？首页精选也会一并撤下。`;
  if (deleteConfirm) { deleteConfirm.disabled = false; deleteConfirm.textContent = '确认取下'; }
  setManageError(titleError, '');
  setManageError(deleteError, '');
  manageDialog.showModal();
  root.classList.add('has-dialog');
  deletePanel.querySelector<HTMLButtonElement>('[data-photo-manage-cancel]')?.focus();
}

function closePhotoManage(restoreFocus = true) {
  if (!manageDialog) return;
  const from = manageTrigger;
  if (manageDialog.open) manageDialog.close();
  managePhoto = null;
  manageTrigger = null;
  manageMode = null;
  if (titleInput) { titleInput.value = ''; titleInput.disabled = false; }
  if (deleteCopy) deleteCopy.textContent = '';
  if (titleSubmit) { titleSubmit.disabled = false; titleSubmit.textContent = '收好标题'; }
  if (deleteConfirm) { deleteConfirm.disabled = false; deleteConfirm.textContent = '确认取下'; }
  setManageError(titleError, '');
  setManageError(deleteError, '');
  if (!pasteDialog?.open && !dialog.open) root.classList.remove('has-dialog');
  if (restoreFocus && !root.classList.contains('is-locked')) from?.focus({ preventScroll: true });
}

async function mutatePhoto(
  id: string,
  path: string,
  method: 'PUT' | 'DELETE',
  payload: Record<string, unknown>,
  focusId?: string,
): Promise<PhotoManifest | null> {
  if (!authenticated || !loaded || photoBusy) return null;
  photoBusy = true;
  const requestGeneration = generation;
  const controller = new AbortController();
  photoMutation = controller;
  try {
    const manifest = parsePhotoManifest(await api<PhotoManifest>(path, {
      method,
      signal: controller.signal,
      body: JSON.stringify(payload),
    }));
    if (!authenticated || generation !== requestGeneration) return null;
    applyManifest(manifest, focusId);
    return manifest;
  } catch (error) {
    if (!authenticated || generation !== requestGeneration) return null;
    if (error instanceof ApiError && error.status === 401) {
      clearPhotos();
      publishSession({ authenticated: false, configured: true });
      return null;
    }
    if (error instanceof ApiError && error.status === 409) {
      loaded = false;
      await loadPhotos();
    }
    throw error;
  } finally {
    if (photoMutation === controller) {
      photoMutation = null;
      photoBusy = false;
    }
  }
}

async function toggleFeatured(id: string, featured: boolean, focusCard = true) {
  try {
    await mutatePhoto(id, `/api/photos/${id}/featured`, 'PUT', { expectedRevision: revision, featured }, focusCard ? id : undefined);
  } catch (error) {
    if (authenticated) setStatus(error instanceof ApiError ? error.message : '这张暂时没能改好，请再试一次。', true);
  }
}

async function submitPhotoTitle(event: Event) {
  event.preventDefault();
  if (!managePhoto || manageMode !== 'title' || !titleInput || !titleForm || !authenticated || photoBusy) return;
  const photo = managePhoto;
  const nextTitle = titleInput.value.trim();
  if (!nextTitle || nextTitle.length > 80) {
    setManageError(titleError, '标题要有内容，最多 80 个字。');
    titleInput.focus();
    return;
  }
  titleInput.disabled = true;
  if (titleSubmit) { titleSubmit.disabled = true; titleSubmit.textContent = '正在收好…'; }
  try {
    const saved = await mutatePhoto(photo.id, `/api/photos/${photo.id}`, 'PUT', { expectedRevision: revision, title: nextTitle }, photo.id);
    if (saved) {
      closePhotoManage(false);
      if (dialog.open) lightboxEdit?.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>(`[data-photo-wall="all"] a[data-photo-id="${photo.id}"]`)?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (!authenticated) return;
    setManageError(titleError, error instanceof ApiError && error.status === 409
      ? '相册刚有新变化，已经翻到最新一版；请核对标题后再收好。'
      : error instanceof ApiError ? error.message : '标题暂时没能收好，请再试一次。');
  } finally {
    if (manageMode === 'title') {
      titleInput.disabled = false;
      if (titleSubmit) { titleSubmit.disabled = false; titleSubmit.textContent = '再收一次'; }
    }
  }
}

async function confirmPhotoDelete() {
  if (!managePhoto || manageMode !== 'delete' || !authenticated || photoBusy) return;
  const photo = managePhoto;
  if (deleteConfirm) { deleteConfirm.disabled = true; deleteConfirm.textContent = '正在收起…'; }
  try {
    const removed = await mutatePhoto(photo.id, `/api/photos/${photo.id}`, 'DELETE', { expectedRevision: revision });
    if (!removed) return;
    closePhotoManage(false);
    setStatus('这张照片已从相册收好。');
    if (dialog.open) {
      if (next.hidden && previous.hidden) dialog.querySelector<HTMLButtonElement>('[data-lightbox-close]')?.focus({ preventScroll: true });
      else lightboxFeature?.focus({ preventScroll: true });
    }
    else {
      const nextCard = document.querySelector<HTMLElement>('[data-photo-wall="all"] a[data-photo-id]')
        ?? document.querySelector<HTMLElement>('[data-photo-wall="all"] .polaroid-add');
      nextCard?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (!authenticated) return;
    setManageError(deleteError, error instanceof ApiError && error.status === 409
      ? '相册刚有新变化，已经翻到最新一版；确认后再取下这张。'
      : error instanceof ApiError ? error.message : '照片暂时没能取下，请再试一次。');
  } finally {
    if (manageMode === 'delete' && deleteConfirm) {
      deleteConfirm.disabled = false;
      deleteConfirm.textContent = '确认取下';
    }
  }
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
  if (!pasteDialog?.open && !manageDialog?.open) root.classList.remove('has-dialog');
  if (!root.classList.contains('is-locked')) trigger?.focus({ preventScroll: true });
});

if (manageDialog) {
  manageDialog.querySelectorAll<HTMLButtonElement>('[data-photo-manage-cancel]').forEach(button => {
    button.addEventListener('click', () => closePhotoManage(true));
  });
  titleForm?.addEventListener('submit', event => void submitPhotoTitle(event));
  deleteConfirm?.addEventListener('click', () => void confirmPhotoDelete());
  manageDialog.addEventListener('click', event => {
    if (event.target === manageDialog) closePhotoManage(true);
  });
  manageDialog.addEventListener('cancel', event => {
    event.preventDefault();
    closePhotoManage(true);
  });
}

lightboxEdit?.addEventListener('click', () => {
  const photo = current[index];
  if (photo) openPhotoTitle(photo, lightboxEdit);
});
lightboxFeature?.addEventListener('click', () => {
  const photo = current[index];
  if (photo) void toggleFeatured(photo.id, !featuredIds.has(photo.id), false);
});
lightboxDelete?.addEventListener('click', () => {
  const photo = current[index];
  if (photo) openPhotoDelete(photo, lightboxDelete);
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
    if (!dialog.open && !manageDialog?.open) root.classList.remove('has-dialog');
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
