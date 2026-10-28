import { dotted } from '../lib/anniversary';
import { api, ApiError } from '../lib/cloud-notebook';
import { featuredPhotoCount, featuredPhotos, parsePhotoManifest, photoSummary, photoUrl, type PhotoManifest, type PrivatePhoto } from '../lib/photos';
import { getSession, onSessionChange, publishSession } from '../lib/session';
import { balanceColumns, encodeWebp, exifDateFromBytes, looksLikeImage, sha16, titleFromFileName } from '../lib/photo-upload';
import { lucideSvg } from '../lib/lucide-dom';
import { Pencil, Plus, Star, Trash2 } from 'lucide';

/** Private photographs: the home spread, the album wall, the lightbox and album upkeep. */

const root = document.documentElement;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]')!;
const walls = [...document.querySelectorAll<HTMLElement>('[data-photo-wall]')];
const placeholders = new Map(walls.map(wall => [wall, [...wall.children].map(child => child.cloneNode(true))]));
const locked = document.querySelectorAll<HTMLElement>('[data-photos-locked]');
const status = document.querySelector<HTMLElement>('[data-photos-status]');
const retry = document.querySelector<HTMLButtonElement>('[data-photos-retry]');
const summary = document.querySelector<HTMLElement>('[data-photos-summary]');
const albumLinks = document.querySelectorAll<HTMLAnchorElement>('[data-album-link]');
const lockedSummary = summary?.textContent ?? '';
const albumPage = walls.some(wall => wall.dataset.photoWall === 'all');

const print = dialog.querySelector<HTMLElement>('.lightbox-print')!;
const frame = dialog.querySelector<HTMLElement>('.lightbox-frame')!;
let image = dialog.querySelector<HTMLImageElement>('[data-lightbox-image]')!;
const title = dialog.querySelector<HTMLElement>('[data-lightbox-title]')!;
const meta = dialog.querySelector<HTMLElement>('[data-lightbox-meta]')!;
const photoStories = dialog.querySelector<HTMLAnchorElement>('[data-photo-stories]')!;
const previous = dialog.querySelector<HTMLButtonElement>('[data-lightbox-prev]')!;
const next = dialog.querySelector<HTMLButtonElement>('[data-lightbox-next]')!;
const lightboxClose = dialog.querySelector<HTMLButtonElement>('[data-lightbox-close]')!;
const lightboxFeedback = dialog.querySelector<HTMLElement>('[data-lightbox-feedback]')!;
const lightboxStatus = dialog.querySelector<HTMLElement>('[data-lightbox-status]')!;
const lightboxRetry = dialog.querySelector<HTMLButtonElement>('[data-lightbox-retry]')!;
const lightboxManagement = dialog.querySelector<HTMLElement>('[data-lightbox-management]')!;
const lightboxEdit = dialog.querySelector<HTMLButtonElement>('[data-lightbox-edit]')!;
const lightboxFeature = dialog.querySelector<HTMLButtonElement>('[data-lightbox-feature]')!;
const lightboxFeatureLabel = dialog.querySelector<HTMLElement>('[data-lightbox-feature-label]')!;
const lightboxDelete = dialog.querySelector<HTMLButtonElement>('[data-lightbox-delete]')!;

const pasteDialog = document.querySelector<HTMLDialogElement>('[data-paste-photo]');
const q = <T extends HTMLElement>(selector: string, parent: ParentNode | null | undefined) => parent?.querySelector<T>(selector) ?? null;
const pasteForm = q<HTMLFormElement>('[data-paste-form]', pasteDialog);
const pasteFile = q<HTMLInputElement>('[data-paste-file]', pasteDialog);
const pastePick = q<HTMLButtonElement>('[data-paste-pick]', pasteDialog);
const pasteEmpty = q<HTMLElement>('[data-paste-empty]', pasteDialog);
const pastePreview = q<HTMLImageElement>('[data-paste-preview]', pasteDialog);
const pasteSwap = q<HTMLButtonElement>('[data-paste-swap]', pasteDialog);
const pasteTitle = q<HTMLInputElement>('[data-paste-title]', pasteDialog);
const pasteDate = q<HTMLInputElement>('[data-paste-date]', pasteDialog);
const pasteError = q<HTMLElement>('[data-paste-error]', pasteDialog);
const pasteCancel = q<HTMLButtonElement>('[data-paste-cancel]', pasteDialog);
const pasteSubmit = q<HTMLButtonElement>('[data-paste-submit]', pasteDialog);
const manageDialog = document.querySelector<HTMLDialogElement>('[data-photo-manage]');
const editPanel = q<HTMLElement>('[data-photo-edit-panel]', manageDialog);
const deletePanel = q<HTMLElement>('[data-photo-delete-panel]', manageDialog);
const titleForm = q<HTMLFormElement>('[data-photo-title-form]', manageDialog);
const titleInput = q<HTMLInputElement>('[data-photo-title-input]', manageDialog);
const titleError = q<HTMLElement>('[data-photo-edit-error]', manageDialog);
const titleSubmit = q<HTMLButtonElement>('[data-photo-title-submit]', manageDialog);
const deleteCopy = q<HTMLElement>('[data-photo-delete-copy]', manageDialog);
const deleteError = q<HTMLElement>('[data-photo-delete-error]', manageDialog);
const deleteConfirm = q<HTMLButtonElement>('[data-photo-delete-confirm]', manageDialog);

let authenticated = false;
let loaded = false;
let generation = 0;
let request: AbortController | null = null;
let uploadRequest: AbortController | null = null;
let pendingAlbum = false;
let current: PrivatePhoto[] = [];
let allPhotos: PrivatePhoto[] = [];
let index = 0;
let requestedIndex = 0;
let imageGeneration = 0;
let pendingImage: HTMLImageElement | null = null;
let trigger: HTMLElement | null = null;
let touchStart: { identifier: number; x: number; y: number } | null = null;
let revision = 0;
let featuredIds = new Set<string>();
let currentKind: 'all' | 'featured' = 'all';
let pasteSource: File | null = null;
let pastePreviewUrl = '';
let titleDirty = false;
let addTrigger: HTMLElement | null = null;
let uploading = false;
let photoMutation: AbortController | null = null;
let photoBusy = false;
let managePhoto: PrivatePhoto | null = null;
let manageTrigger: HTMLElement | null = null;
let manageMode: 'title' | 'delete' | null = null;

const dateLabel = (photo: PrivatePhoto) => (photo.date ? dotted(photo.date) : '');
const syncDialogClass = () => root.classList.toggle('has-dialog', dialog.open || !!pasteDialog?.open || !!manageDialog?.open);

/* ---------- Prints ---------- */

const reveal = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const element = entry.target as HTMLElement;
    const img = element.querySelector('img');
    const show = () => element.classList.add('is-shown');
    if (!img || img.complete) show(); else { img.addEventListener('load', show, { once: true }); img.addEventListener('error', show, { once: true }); }
    reveal.unobserve(element);
  }
}, { rootMargin: '0px 0px -6% 0px' });

function print_(photo: PrivatePhoto, list: PrivatePhoto[], position: number, kind: 'all' | 'featured'): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'frame frame-photo';
  link.href = photoUrl(photo.id, 'large');
  link.style.setProperty('--i', String(kind === 'featured' ? position : 0));
  link.style.setProperty('--ratio', String(photo.width / photo.height));
  link.setAttribute('aria-label', `${photo.title}${photo.date ? `，${dateLabel(photo)}` : ''}，查看大图`);
  link.dataset.photoId = photo.id;
  const img = document.createElement('img');
  img.src = photoUrl(photo.id, 'thumb');
  img.alt = photo.title;
  img.width = photo.width;
  img.height = photo.height;
  img.loading = 'lazy';
  img.decoding = 'async';
  const caption = document.createElement('span');
  caption.className = 'frame-caption';
  const name = document.createElement('span');
  name.textContent = photo.title;
  caption.append(name);
  if (photo.date) {
    const time = document.createElement('time');
    time.dateTime = photo.date;
    time.textContent = dateLabel(photo);
    caption.append(time);
  }
  link.append(img, caption);
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(list, position, link, kind);
  });
  if (calm.matches) link.classList.add('is-shown'); else reveal.observe(link);
  return link;
}

function actionButton(label: string, action: () => void, icon: Parameters<typeof lucideSvg>[0], danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-sm btn-quiet${danger ? ' btn-danger' : ''}`;
  const text = document.createElement('span'); text.textContent = label;
  button.append(lucideSvg(icon, 14), text);
  button.addEventListener('click', action);
  return button;
}

function albumEntry(photo: PrivatePhoto, list: PrivatePhoto[], position: number): HTMLElement {
  const entry = document.createElement('div');
  entry.className = 'wall-item';
  entry.dataset.photoEntryId = photo.id;
  const actions = document.createElement('div');
  actions.className = 'wall-item-actions';
  const featured = featuredIds.has(photo.id);
  const edit = actionButton('改标题', () => openPhotoTitle(photo, edit), Pencil);
  const feature = actionButton(featured ? '从首页撤下' : '设为首页精选', () => void toggleFeatured(photo.id, !featuredIds.has(photo.id)), Star);
  feature.classList.toggle('is-featured', featured);
  const remove = actionButton('从相册取下', () => openPhotoDelete(photo, remove), Trash2, true);
  feature.disabled = !featured && featuredIds.size >= featuredPhotoCount;
  if (feature.disabled) feature.title = '首页已经留了三张，请先收下一张。';
  edit.dataset.photoId = feature.dataset.photoId = remove.dataset.photoId = photo.id;
  actions.append(edit, feature, remove);
  entry.append(print_(photo, list, position, 'all'), actions);
  return entry;
}

function featuredEmptySlot(): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'frame frame-slot';
  slot.setAttribute('role', 'status');
  slot.setAttribute('aria-label', '首页精选，留给下一张');
  const copy = document.createElement('span');
  copy.className = 'frame-slot-copy';
  copy.textContent = '留给下一张';
  slot.append(copy);
  return slot;
}

function addSlot(): HTMLButtonElement {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = 'frame frame-slot frame-add';
  slot.setAttribute('aria-label', '贴一张照片');
  const main = document.createElement('span'); main.className = 'serif'; main.textContent = '贴一张';
  const sub = document.createElement('span'); sub.className = 'frame-slot-copy'; sub.textContent = '留给下一张';
  slot.append(lucideSvg(Plus, 28), main, sub);
  slot.addEventListener('click', () => openPaste(slot));
  return slot;
}

let columnCount = 0;
function albumColumns() { return innerWidth < 640 ? 1 : innerWidth < 1100 ? 2 : 3; }
function renderAlbum(wall: HTMLElement, photos: PrivatePhoto[]) {
  columnCount = albumColumns();
  const items: HTMLElement[] = photos.map((photo, position) => albumEntry(photo, photos, position));
  const ratios = photos.map(photo => photo.width / photo.height);
  items.push(addSlot()); ratios.push(.8);
  const columns = balanceColumns(items, ratios, columnCount);
  wall.classList.remove('is-placeholder');
  wall.style.setProperty('--cols', String(columnCount));
  wall.replaceChildren(...columns.map(column => {
    const col = document.createElement('div');
    col.className = 'wall-col';
    col.append(...column);
    return col;
  }));
}
addEventListener('resize', () => {
  if (!loaded || !albumPage || albumColumns() === columnCount) return;
  const wall = walls.find(item => item.dataset.photoWall === 'all');
  const focusId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-photo-id]')?.dataset.photoId;
  if (wall) renderAlbum(wall, allPhotos);
  if (focusId) wall?.querySelector<HTMLElement>(`a[data-photo-id="${focusId}"]`)?.focus({ preventScroll: true });
});

function setStatus(message: string, canRetry = false) {
  if (status) { status.textContent = message; status.hidden = !message; }
  if (retry) retry.hidden = !canRetry;
}

function render(photos: PrivatePhoto[], featured: PrivatePhoto[]) {
  allPhotos = photos;
  for (const wall of walls) {
    if (wall.dataset.photoWall === 'featured') {
      // Empty featured keeps a waiting slot; never invent picks from the album.
      wall.replaceChildren(...(featured.length ? featured.map((photo, position) => print_(photo, featured, position, 'featured')) : [featuredEmptySlot()]));
    } else renderAlbum(wall, photos);
  }
  locked.forEach(element => { element.hidden = true; });
  if (summary) summary.textContent = photoSummary(photos.length);
}

function applyManifest(manifest: PhotoManifest, focusId?: string) {
  revision = manifest.revision;
  featuredIds = new Set(manifest.featured);
  loaded = true;
  render(manifest.photos, featuredPhotos(manifest));
  setStatus('');
  if (dialog.open) {
    const activeId = current[requestedIndex]?.id;
    const updated = currentKind === 'all' ? manifest.photos : featuredPhotos(manifest);
    if (updated.length === 0) dialog.close();
    else {
      const activeIndex = updated.findIndex(photo => photo.id === activeId);
      const target = activeIndex >= 0 ? activeIndex : Math.min(requestedIndex, updated.length - 1);
      current = updated;
      previous.hidden = next.hidden = updated.length < 2;
      const returnId = trigger?.dataset.photoId;
      const focusTarget = updated.some(photo => photo.id === returnId) ? returnId : updated[target].id;
      trigger = document.querySelector<HTMLElement>(`[data-photo-wall="${currentKind}"] a[data-photo-id="${focusTarget}"]`) ?? trigger;
      void show(target);
    }
  }
  if (focusId && !manageDialog?.open) document.querySelector<HTMLElement>(`[data-photo-wall="all"] a[data-photo-id="${focusId}"]`)?.focus({ preventScroll: true });
}

function discardPendingImage() {
  const pending = pendingImage;
  pendingImage = null;
  pending?.removeAttribute('src');
}

function clearPhotos() {
  photoStories.hidden = true;
  photoStories.removeAttribute('href');
  generation++; imageGeneration++;
  discardPendingImage();
  request?.abort(); request = null;
  uploadRequest?.abort(); uploadRequest = null;
  photoMutation?.abort(); photoMutation = null;
  photoBusy = false; loaded = false; revision = 0;
  if (dialog.open) dialog.close();
  closePaste(false);
  closePhotoManage(false);
  image.removeAttribute('src');
  lightboxManagement.hidden = true;
  title.textContent = meta.textContent = '';
  current = []; allPhotos = []; currentKind = 'all'; featuredIds = new Set();
  for (const wall of walls) {
    wall.replaceChildren(...placeholders.get(wall)!.map(node => node.cloneNode(true)));
    if (wall.dataset.photoWall === 'all') { wall.classList.add('is-placeholder'); wall.style.removeProperty('--cols'); }
  }
  locked.forEach(element => { element.hidden = false; });
  if (summary) summary.textContent = lockedSummary;
  setStatus('');
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
    if (error instanceof ApiError && error.status === 401) { clearPhotos(); publishSession({ authenticated: false, configured: true }); return; }
    setStatus('相册暂时打不开，请稍后再试。', true);
  } finally {
    window.clearTimeout(timeout);
    if (generation === currentGeneration) request = null;
  }
}

/* ---------- Lightbox ---------- */

async function show(target: number, direction: 0 | 1 | -1 = 0) {
  requestedIndex = (target + current.length) % current.length;
  const position = requestedIndex;
  const photo = current[position];
  const token = ++imageGeneration;
  discardPendingImage();
  lightboxFeedback.hidden = false;
  lightboxStatus.textContent = '正在翻开照片…';
  lightboxRetry.hidden = true;
  lightboxEdit.disabled = lightboxFeature.disabled = lightboxDelete.disabled = true;
  const nextImage = new Image(photo.width, photo.height);
  pendingImage = nextImage;
  nextImage.dataset.lightboxImage = '';
  nextImage.alt = photo.title;
  nextImage.src = photoUrl(photo.id, 'large');
  try { await nextImage.decode(); } catch {
    if (imageGeneration === token) { pendingImage = null; lightboxStatus.textContent = '照片暂时打不开，请再试一次。'; lightboxRetry.hidden = false; }
    return;
  }
  if (imageGeneration !== token) return;
  pendingImage = null;
  index = position;
  lightboxFeedback.hidden = true;
  lightboxStatus.textContent = '';
  // Keep the current print until the next one is decoded, then swap together.
  frame.style.setProperty('--ratio', String(photo.width / photo.height));
  image.replaceWith(nextImage);
  image = nextImage;
  if (direction && !calm.matches) {
    print.classList.remove('is-turning-next', 'is-turning-prev');
    void print.offsetWidth;
    print.classList.add(direction > 0 ? 'is-turning-next' : 'is-turning-prev');
  }
  title.textContent = photo.title;
  photoStories.href = `/memories/?photo=${encodeURIComponent(photo.id)}`;
  photoStories.hidden = false;
  meta.textContent = [dateLabel(photo), `${position + 1} / ${current.length}`].filter(Boolean).join(' · ');
  lightboxManagement.hidden = !albumPage || !authenticated;
  lightboxEdit.disabled = lightboxDelete.disabled = false;
  const isFeatured = featuredIds.has(photo.id);
  lightboxFeatureLabel.textContent = isFeatured ? '从首页撤下' : featuredIds.size >= featuredPhotoCount ? '首页已留三张' : '设为首页精选';
  lightboxFeature.disabled = !isFeatured && featuredIds.size >= featuredPhotoCount;
  lightboxFeature.title = lightboxFeature.disabled ? '首页已经留了三张，请先收下一张。' : '';
}

function open(list: PrivatePhoto[], target: number, from: HTMLElement, kind: 'all' | 'featured') {
  current = list; currentKind = kind; trigger = from;
  previous.hidden = next.hidden = list.length < 2;
  image.removeAttribute('src');
  title.textContent = list[target].title;
  meta.textContent = '';
  photoStories.hidden = true;
  lightboxManagement.hidden = true;
  const photo = list[target];
  frame.style.setProperty('--ratio', String(photo.width / photo.height));
  // Show the thumbnail at once so the print can grow out of the wall.
  const thumb = from.querySelector('img');
  if (thumb?.currentSrc) image.src = thumb.currentSrc;
  void show(target);
  dialog.showModal();
  syncDialogClass();
  if (!calm.matches) {
    const start = from.getBoundingClientRect();
    const end = frame.getBoundingClientRect();
    if (start.width && end.width) {
      const dx = start.left + start.width / 2 - (end.left + end.width / 2);
      const dy = start.top + start.height / 2 - (end.top + end.height / 2);
      const flight = frame.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${start.width / end.width})`, borderRadius: '18px' },
        { transform: 'translate(0px, 0px) scale(1)', borderRadius: '10px' },
      ], { duration: 800, easing: 'cubic-bezier(.16,1,.3,1)' });
      flight.finished.catch(() => {});
    }
  }
}

/* ---------- Album upkeep ---------- */

function setError(target: HTMLElement | null, message: string) { if (target) { target.textContent = message; target.hidden = !message; } }

function openPhotoTitle(photo: PrivatePhoto, from: HTMLElement) {
  if (!manageDialog || !editPanel || !deletePanel || !titleInput || !authenticated || !loaded) return;
  managePhoto = photo; manageTrigger = from; manageMode = 'title';
  editPanel.hidden = false; deletePanel.hidden = true;
  titleInput.value = photo.title; titleInput.disabled = false;
  if (titleSubmit) { titleSubmit.disabled = false; titleSubmit.textContent = '收好标题'; }
  setError(titleError, ''); setError(deleteError, '');
  manageDialog.showModal(); syncDialogClass();
  titleInput.focus(); titleInput.select();
}
function openPhotoDelete(photo: PrivatePhoto, from: HTMLElement) {
  if (!manageDialog || !editPanel || !deletePanel || !deleteCopy || !authenticated || !loaded) return;
  managePhoto = photo; manageTrigger = from; manageMode = 'delete';
  editPanel.hidden = true; deletePanel.hidden = false;
  deleteCopy.textContent = `要把「${photo.title}」从这本相册里取下来吗？首页精选也会一并撤下。`;
  if (deleteConfirm) { deleteConfirm.disabled = false; deleteConfirm.textContent = '确认取下'; }
  setError(titleError, ''); setError(deleteError, '');
  manageDialog.showModal(); syncDialogClass();
  deletePanel.querySelector<HTMLButtonElement>('[data-photo-manage-cancel]')?.focus();
}
function closePhotoManage(restoreFocus = true) {
  if (!manageDialog) return;
  const from = manageTrigger;
  if (manageDialog.open) manageDialog.close();
  managePhoto = null; manageTrigger = null; manageMode = null;
  if (titleInput) { titleInput.value = ''; titleInput.disabled = false; }
  if (deleteCopy) deleteCopy.textContent = '';
  if (titleSubmit) { titleSubmit.disabled = false; titleSubmit.textContent = '收好标题'; }
  if (deleteConfirm) { deleteConfirm.disabled = false; deleteConfirm.textContent = '确认取下'; }
  setError(titleError, ''); setError(deleteError, '');
  syncDialogClass();
  if (restoreFocus && !root.classList.contains('is-locked')) from?.focus({ preventScroll: true });
}

async function mutatePhoto(path: string, method: 'PUT' | 'DELETE', payload: Record<string, unknown>, focusId?: string): Promise<PhotoManifest | null> {
  if (!authenticated || !loaded || photoBusy) return null;
  photoBusy = true;
  const requestGeneration = generation;
  const controller = new AbortController();
  photoMutation = controller;
  try {
    const manifest = parsePhotoManifest(await api<PhotoManifest>(path, { method, signal: controller.signal, body: JSON.stringify(payload) }));
    if (!authenticated || generation !== requestGeneration) return null;
    applyManifest(manifest, focusId);
    return manifest;
  } catch (error) {
    if (!authenticated || generation !== requestGeneration) return null;
    if (error instanceof ApiError && error.status === 401) { clearPhotos(); publishSession({ authenticated: false, configured: true }); return null; }
    if (error instanceof ApiError && error.status === 409) { loaded = false; await loadPhotos(); }
    throw error;
  } finally {
    if (photoMutation === controller) { photoMutation = null; photoBusy = false; }
  }
}

async function toggleFeatured(id: string, featured: boolean, focusCard = true) {
  try { await mutatePhoto(`/api/photos/${id}/featured`, 'PUT', { expectedRevision: revision, featured }, focusCard ? id : undefined); }
  catch (error) { if (authenticated) setStatus(error instanceof ApiError ? error.message : '这张暂时没能改好，请再试一次。', true); }
}

titleForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!managePhoto || manageMode !== 'title' || !titleInput || !authenticated || photoBusy) return;
  const photo = managePhoto;
  const nextTitle = titleInput.value.trim();
  if (!nextTitle || nextTitle.length > 80) { setError(titleError, '标题要有内容，最多 80 个字。'); titleInput.focus(); return; }
  titleInput.disabled = true;
  if (titleSubmit) { titleSubmit.disabled = true; titleSubmit.textContent = '正在收好…'; }
  try {
    const saved = await mutatePhoto(`/api/photos/${photo.id}`, 'PUT', { expectedRevision: revision, title: nextTitle }, photo.id);
    if (saved) {
      closePhotoManage(false);
      if (dialog.open) (lightboxEdit.disabled ? lightboxClose : lightboxEdit).focus({ preventScroll: true });
      else document.querySelector<HTMLElement>(`[data-photo-wall="all"] a[data-photo-id="${photo.id}"]`)?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (!authenticated) return;
    setError(titleError, error instanceof ApiError && error.status === 409 ? '相册刚有新变化，已经翻到最新一版；请核对标题后再收好。' : error instanceof ApiError ? error.message : '标题暂时没能收好，请再试一次。');
  } finally {
    if (manageMode === 'title') { titleInput.disabled = false; if (titleSubmit) { titleSubmit.disabled = false; titleSubmit.textContent = '再收一次'; } }
  }
});

deleteConfirm?.addEventListener('click', async () => {
  if (!managePhoto || manageMode !== 'delete' || !authenticated || photoBusy) return;
  const photo = managePhoto;
  deleteConfirm.disabled = true; deleteConfirm.textContent = '正在收起…';
  try {
    const removed = await mutatePhoto(`/api/photos/${photo.id}`, 'DELETE', { expectedRevision: revision });
    if (!removed) return;
    closePhotoManage(false);
    setStatus('这张照片已从相册收好。');
    if (dialog.open) (lightboxFeature.disabled || next.hidden ? lightboxClose : lightboxFeature).focus({ preventScroll: true });
    else (document.querySelector<HTMLElement>('[data-photo-wall="all"] a[data-photo-id]') ?? document.querySelector<HTMLElement>('[data-photo-wall="all"] .frame-add'))?.focus({ preventScroll: true });
  } catch (error) {
    if (!authenticated) return;
    setError(deleteError, error instanceof ApiError && error.status === 409 ? '相册刚有新变化，已经翻到最新一版；确认后再取下这张。' : error instanceof ApiError ? error.message : '照片暂时没能取下，请再试一次。');
  } finally {
    if (manageMode === 'delete') { deleteConfirm.disabled = false; deleteConfirm.textContent = '确认取下'; }
  }
});

/* ---------- Paste one in ---------- */

function revokePreview() { if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl); pastePreviewUrl = ''; }
function setPasteControls(disabled: boolean) {
  for (const control of [pasteTitle, pasteDate, pastePick, pasteSwap]) if (control) control.disabled = disabled;
}
function resetPasteForm() {
  uploadRequest?.abort(); uploadRequest = null; uploading = false;
  pasteSource = null; titleDirty = false;
  revokePreview();
  if (pasteFile) pasteFile.value = '';
  if (pasteTitle) pasteTitle.value = '';
  if (pasteDate) pasteDate.value = '';
  if (pastePreview) { pastePreview.hidden = true; pastePreview.removeAttribute('src'); }
  if (pasteEmpty) pasteEmpty.hidden = false;
  if (pasteSwap) pasteSwap.hidden = true;
  if (pasteSubmit) { pasteSubmit.disabled = false; pasteSubmit.textContent = '贴上'; }
  setPasteControls(false);
  setError(pasteError, '');
}
function closePaste(restoreFocus = true) {
  if (!pasteDialog?.open) { resetPasteForm(); return; }
  pasteDialog.close();
  resetPasteForm();
  syncDialogClass();
  if (restoreFocus && !root.classList.contains('is-locked')) addTrigger?.focus({ preventScroll: true });
  addTrigger = null;
}
function openPaste(from: HTMLElement) {
  if (!pasteDialog || !authenticated || !loaded) return;
  addTrigger = from;
  resetPasteForm();
  pasteDialog.showModal();
  syncDialogClass();
  pastePick?.focus();
}

async function applySelectedFile(file: File) {
  if (!looksLikeImage(file)) { setError(pasteError, '换一张照片试试。'); return; }
  pasteSource = file;
  revokePreview();
  pastePreviewUrl = URL.createObjectURL(file);
  if (pastePreview) { pastePreview.src = pastePreviewUrl; pastePreview.hidden = false; }
  if (pasteEmpty) pasteEmpty.hidden = true;
  if (pasteSwap) pasteSwap.hidden = false;
  if (pasteTitle && !titleDirty) pasteTitle.value = titleFromFileName(file.name);
  try { if (pasteDate) pasteDate.value = exifDateFromBytes(await file.arrayBuffer()) ?? ''; }
  catch { if (pasteDate) pasteDate.value = ''; }
  setError(pasteError, '');
  if (pasteTitle && !pasteTitle.value.trim()) pasteTitle.focus();
}

pasteForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!pasteDialog || uploading || !authenticated) return;
  if (!pasteSource) { setError(pasteError, '先选一张图再贴。'); pastePick?.focus(); return; }
  const name = pasteTitle?.value.trim() ?? '';
  if (!name) { setError(pasteError, '给这张写个名字再贴。'); pasteTitle?.focus(); return; }
  const date = pasteDate?.value || '';
  uploading = true;
  setError(pasteError, '');
  if (pasteSubmit) { pasteSubmit.disabled = true; pasteSubmit.textContent = '正在贴上…'; }
  setPasteControls(true);
  const controller = new AbortController();
  uploadRequest = controller;
  const uploadGeneration = generation;
  try {
    const original = await pasteSource.arrayBuffer();
    if (!authenticated || generation !== uploadGeneration) return;
    const id = await sha16(original);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(pasteSource); } catch { throw new ApiError(400, '换一张照片试试。'); }
    let thumb: Awaited<ReturnType<typeof encodeWebp>>;
    let large: Awaited<ReturnType<typeof encodeWebp>>;
    try {
      thumb = await encodeWebp(bitmap, 800, 1000, .8);
      large = await encodeWebp(bitmap, 1800, 1800, .82);
    } finally { bitmap.close(); }
    if (!authenticated || generation !== uploadGeneration) return;
    const body = new FormData();
    body.set('title', name);
    body.set('date', date);
    body.set('id', id);
    body.set('expectedRevision', String(revision));
    body.set('width', String(large.width));
    body.set('height', String(large.height));
    body.set('thumb', thumb.blob, 'thumb.webp');
    body.set('large', large.blob, 'large.webp');
    const response = await fetch('/api/photos', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, body });
    const result = await response.json().catch(() => ({ error: '这张暂时贴不上，再试一次。' }));
    if (!authenticated || generation !== uploadGeneration) return;
    if (!response.ok) {
      if (response.status === 401) { clearPhotos(); publishSession({ authenticated: false, configured: true }); return; }
      if (response.status === 409) { loaded = false; await loadPhotos(); throw new ApiError(409, result.error ?? '相册刚在其他设备更新，请刷新后再贴。'); }
      throw new ApiError(response.status, result.error ?? '这张暂时贴不上，再试一次。');
    }
    const manifest = parsePhotoManifest(result);
    closePaste(false);
    applyManifest(manifest, id);
  } catch (error) {
    if (!authenticated || generation !== uploadGeneration || (error as Error).name === 'AbortError') return;
    setError(pasteError, error instanceof ApiError ? error.message : '这张暂时贴不上，再试一次。');
    if (pasteSubmit) { pasteSubmit.disabled = false; pasteSubmit.textContent = '再试一次'; }
    setPasteControls(false);
  } finally {
    if (generation === uploadGeneration) { uploadRequest = null; uploading = false; }
  }
});

if (pasteDialog && pasteFile && pastePick) {
  pastePick.addEventListener('click', () => pasteFile.click());
  pasteSwap?.addEventListener('click', () => pasteFile.click());
  pasteFile.addEventListener('change', () => { const file = pasteFile.files?.[0]; if (file) void applySelectedFile(file); });
  // Drop a photo straight onto the frame.
  pastePick.addEventListener('dragover', event => { event.preventDefault(); pastePick.classList.add('is-over'); });
  pastePick.addEventListener('dragleave', () => pastePick.classList.remove('is-over'));
  pastePick.addEventListener('drop', event => {
    event.preventDefault();
    pastePick.classList.remove('is-over');
    const file = event.dataTransfer?.files?.[0];
    if (file && !uploading) void applySelectedFile(file);
  });
  pasteTitle?.addEventListener('input', () => { titleDirty = true; });
  pasteCancel?.addEventListener('click', () => closePaste(true));
  pasteDialog.addEventListener('click', event => { if (event.target === pasteDialog) closePaste(true); });
  pasteDialog.addEventListener('cancel', event => { event.preventDefault(); closePaste(true); });
  pasteDialog.addEventListener('close', syncDialogClass);
}
if (manageDialog) {
  manageDialog.querySelectorAll<HTMLButtonElement>('[data-photo-manage-cancel]').forEach(button => button.addEventListener('click', () => closePhotoManage(true)));
  manageDialog.addEventListener('click', event => { if (event.target === manageDialog) closePhotoManage(true); });
  manageDialog.addEventListener('cancel', event => { event.preventDefault(); closePhotoManage(true); });
}

/* ---------- Lightbox wiring ---------- */

previous.addEventListener('click', () => void show(requestedIndex - 1, -1));
next.addEventListener('click', () => void show(requestedIndex + 1, 1));
lightboxRetry.addEventListener('click', () => void show(requestedIndex));
lightboxClose.addEventListener('click', () => dialog.close());
dialog.addEventListener('keydown', event => {
  if (current.length < 2) return;
  if (event.key === 'ArrowLeft') void show(requestedIndex - 1, -1);
  else if (event.key === 'ArrowRight') void show(requestedIndex + 1, 1);
  else return;
  event.preventDefault();
});
dialog.addEventListener('click', event => {
  const target = event.target as Element;
  if (target === dialog || target.classList.contains('lightbox-stage')) dialog.close();
});
dialog.addEventListener('touchstart', event => {
  const touch = event.touches[0];
  touchStart = event.touches.length === 1 ? { identifier: touch.identifier, x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
dialog.addEventListener('touchend', event => {
  const start = touchStart;
  touchStart = null;
  if (!start || event.touches.length > 0) return;
  const touch = [...event.changedTouches].find(item => item.identifier === start.identifier);
  if (!touch) return;
  const dx = touch.clientX - start.x;
  const dy = touch.clientY - start.y;
  if (current.length < 2 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
  if (dx < 0) void show(requestedIndex + 1, 1); else void show(requestedIndex - 1, -1);
}, { passive: true });
dialog.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
dialog.addEventListener('close', () => {
  touchStart = null;
  imageGeneration++;
  discardPendingImage();
  syncDialogClass();
  if (!root.classList.contains('is-locked')) trigger?.focus({ preventScroll: true });
});
lightboxEdit.addEventListener('click', () => { const photo = current[index]; if (photo) openPhotoTitle(photo, lightboxEdit); });
lightboxFeature.addEventListener('click', () => { const photo = current[index]; if (photo) void toggleFeatured(photo.id, !featuredIds.has(photo.id), false); });
lightboxDelete.addEventListener('click', () => { const photo = current[index]; if (photo) openPhotoDelete(photo, lightboxDelete); });

/* Visitors who reach for the album get the gate first, then the album once unlocked. */
albumLinks.forEach(link => link.addEventListener('click', event => {
  if (authenticated || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { link.removeAttribute('data-open-login'); return; }
  event.preventDefault();
  pendingAlbum = true;
  link.setAttribute('data-open-login', '');
}));
document.addEventListener('gate:open', () => {
  if (pendingAlbum && authenticated) window.location.assign('/photos/');
  pendingAlbum = false;
});

retry?.addEventListener('click', () => void loadPhotos());
onSessionChange(state => {
  authenticated = state.authenticated;
  if (authenticated) { albumLinks.forEach(link => link.removeAttribute('data-open-login')); void loadPhotos(); }
  else clearPhotos();
});
document.addEventListener('click', event => {
  if ((event.target as Element).closest('[data-session-logout], [data-lock-site]')) { pendingAlbum = false; clearPhotos(); }
}, { capture: true });
// A page restored from the back/forward cache must not show photos without a session.
addEventListener('pagehide', clearPhotos);
addEventListener('pageshow', event => { if (event.persisted) void loadPhotos(); });
void getSession().catch(() => { /* The gate handles unavailable sessions. */ });

