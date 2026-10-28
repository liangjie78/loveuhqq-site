import { animate } from 'motion';
import { dotted, getShanghaiDate } from '../lib/anniversary';
import { api, ApiError, emptyCloudNotebook, type CloudNotebook, type SessionState } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession } from '../lib/session';
import type { Wish } from '../lib/notebook';
import { DRAFT_KEY, emptyDrafts, excerpt, mergeCloud, parseDrafts, revisionOf, searchNotes, validateCloud, writtenDates, type Drafts } from '../lib/notebook-sync';
import { momentTitles } from '../data/moments';
import { scrollToElement } from '../motion/pointer';

/** The back of each day, and the list for later — one shared cloud notebook. */

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const noteGuest = $('[data-note-guest]');
const noteLoading = $('[data-note-loading]');
const noteLoadingStatus = $('[data-note-loading-status]');
const notePrivate = $('[data-note-private]');
const noteStatus = $('[data-note-status]');
const noteRetry = $('[data-note-retry]');
const noteForm = $<HTMLFormElement>('[data-note-form]');
const noteInput = $<HTMLTextAreaElement>('#day-note');
const noteUndoButton = $<HTMLButtonElement>('[data-note-undo]');
const noteSearch = $<HTMLInputElement>('#note-search');
const noteSearchClear = $<HTMLButtonElement>('[data-note-search-clear]');
const noteRandom = $<HTMLButtonElement>('[data-note-random]');
const wishGuest = $('[data-wish-guest]');
const wishLoading = $('[data-wish-loading]');
const wishLoadingStatus = $('[data-wish-loading-status]');
const wishPrivate = [...document.querySelectorAll<HTMLElement>('[data-wish-private]')];
const wishList = $('[data-wish-list]');
const wishForm = $<HTMLFormElement>('[data-wish-form]');
const wishInput = $<HTMLInputElement>('#wish-text');
const wishStatus = $('[data-wish-status]');
const wishRetry = $<HTMLButtonElement>('[data-wish-retry]');
const wishRefresh = $<HTMLButtonElement>('[data-wish-refresh]');
const wishUndoButton = $<HTMLButtonElement>('[data-wish-undo]');

interface NoteUndo { date: string; text: string; expectedVersion: number }
interface WishUndo { wish: Wish; expectedVersion: number }
interface WishEdit { id: string; expectedVersion: number; original: Wish }

const draftOf = (values: Record<string, string>, key: string) => Object.hasOwn(values, key) ? values[key] : undefined;
let draftsCache: Drafts | null = null;
let book: CloudNotebook = emptyCloudNotebook();
let authenticated = false;
let ready = false;
let generation = 0;
const pendingRefreshes = new Set<number>();
const queuedExplicitRefreshes = new Map<number, 'note' | 'wish'>();
let date = getShanghaiDate(new Date());
let noteEditing = false;
let noteEditSession = 0;
let noteEditVersion = 0;
let noteEditOriginal = '';
let wishEditing: WishEdit | null = null;
let wishEditSession = 0;
let wishAdding = false;
let noteUndo: NoteUndo | null = null;
let wishUndo: WishUndo | null = null;
const busy = new Set<string>();

function showStatus(area: 'note' | 'wish', text: string) {
  if (area === 'note') (ready ? noteStatus : noteLoadingStatus).textContent = text;
  else (ready ? wishStatus : wishLoadingStatus).textContent = text;
}

function getDrafts(): Drafts {
  if (!authenticated) return emptyDrafts();
  if (draftsCache) return draftsCache;
  try { return draftsCache = parseDrafts(sessionStorage.getItem(DRAFT_KEY)); } catch { return draftsCache = emptyDrafts(); }
}
function saveDrafts() {
  if (!authenticated || !draftsCache) return;
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftsCache)); } catch { /* Keep the in-memory draft. */ }
}
function clearNoteDraft(key: string) { if (!authenticated) return; delete getDrafts().notes[key]; saveDrafts(); }
function clearWishDraft(key: string) { if (!authenticated) return; delete getDrafts().wishes[key]; saveDrafts(); }

function setVisibility() {
  noteGuest.hidden = authenticated;
  wishGuest.hidden = authenticated;
  noteLoading.hidden = !authenticated || ready;
  wishLoading.hidden = !authenticated || ready;
  notePrivate.hidden = !authenticated || !ready;
  for (const area of wishPrivate) area.hidden = !authenticated || !ready;
  $('[data-wish-count]').hidden = !authenticated || !ready;
  $('[data-wish-draw]').hidden = !authenticated || !ready;
  $('[data-wish-result]').hidden = !authenticated || !ready;
}

const dispatchNotebookChanged = () => document.dispatchEvent(new CustomEvent('notebook:changed', { detail: Object.keys(book.notes) }));

function renderNote() {
  if (!ready || !authenticated) return;
  $<HTMLAnchorElement>('[data-date-stories]').href = `/memories/?date=${encodeURIComponent(date)}`;
  $('[data-note-date]').textContent = dotted(date);
  const noteText = $('[data-note-text]');
  const savedNote = book.notes[date];
  const momentTitle = momentTitles.get(date);
  if (savedNote?.trim()) noteText.textContent = savedNote;
  else if (momentTitle) {
    const title = document.createElement('strong');
    title.textContent = momentTitle;
    noteText.replaceChildren('这一天我们记下了：', title, '。想写一句的时候，再写。');
  } else noteText.textContent = '这一天还空着。想记的时候，再写。';
  $('[data-note-edit-label]').textContent = book.notes[date] ? '改一改' : '写一句';
  if (!noteEditing) {
    noteForm.hidden = true;
    $('[data-note-edit]').hidden = false;
    noteText.hidden = false;
    $('[data-note-delete]').hidden = !book.notes[date];
  }
  renderNoteArchive();
  if (noteEditing && revisionOf(book.revisions.notes, date) !== noteEditVersion) showNoteConflict();
}

function openSavedNote(key: string) {
  if (!authenticated || !ready) return;
  if (noteEditing) { showStatus('note', '先收好或取消正在写的这一句。'); noteInput.focus({ preventScroll: true }); return; }
  date = key;
  renderNote();
  noteStatus.textContent = `翻到了 ${dotted(key)}。`;
  const heading = $('[data-note-date]');
  heading.focus({ preventScroll: true });
  scrollToElement($('.dayback'));
  if (!calm.matches) animate(heading, { opacity: [0, 1], filter: ['blur(8px)', 'blur(0px)'], transform: ['translateY(.4em)', 'translateY(0em)'] }, { duration: .9, ease: [.16, 1, .3, 1] });
}

function renderNoteArchive() {
  const dates = writtenDates(book.notes);
  $('[data-notes-count]').textContent = String(dates.length);
  noteRandom.disabled = dates.length === 0;
  $('[data-note-random-hint]').textContent = dates.length ? '从写过的日子里，挑一天回看。' : '写下第一句以后，就能随手翻一页。';
  noteSearchClear.hidden = noteSearch.value.length === 0;
  const matches = searchNotes(book.notes, noteSearch.value);
  const empty = $('[data-notes-empty]');
  empty.hidden = matches.length > 0;
  empty.textContent = dates.length ? '这一句还没找到，换几个字试试。' : '还没有写过的日子，先给今天留一句吧。';
  const focusedDate = (document.activeElement as HTMLElement | null)?.dataset?.noteDate;
  const index = $('[data-notes-list]');
  index.replaceChildren(...matches.map(key => {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'note-entry';
    entry.dataset.noteDate = key;
    if (key === date) entry.setAttribute('aria-current', 'date');
    const label = document.createElement('time');
    label.dateTime = key; label.textContent = dotted(key);
    const text = document.createElement('span');
    text.textContent = excerpt(book.notes[key]);
    entry.append(label, text);
    entry.addEventListener('click', () => openSavedNote(key));
    return entry;
  }));
  if (focusedDate) index.querySelector<HTMLElement>(`[data-note-date="${CSS.escape(focusedDate)}"]`)?.focus({ preventScroll: true });
}

function showNoteConflict() {
  const panel = $('[data-note-conflict]');
  panel.hidden = false;
  panel.querySelector('p')!.textContent = noteEditing ? '这一天在手账里有新内容。草稿还在，可以先刷新对照。' : '这一天在手账里有新内容，请先刷新查看。';
  $('[data-note-latest]').hidden = true;
}
function setNoteLatest() {
  const latest = $('[data-note-latest]');
  latest.textContent = book.notes[date] ? `手账里目前写着：${book.notes[date]}` : '手账里目前没有这一天的记录。';
  latest.hidden = false;
  noteEditVersion = revisionOf(book.revisions.notes, date);
  noteEditOriginal = book.notes[date] ?? '';
  showStatus('note', '最新内容已显示，草稿仍保留。确认后保存会替换手账里的这一版。');
}

function renderWishConflict(message: string) {
  if (!wishEditing) return;
  const panel = wishList.querySelector<HTMLElement>(`[data-wish-row="${CSS.escape(wishEditing.id)}"] [data-wish-conflict]`);
  if (panel) { panel.hidden = false; panel.textContent = message; }
}

function makeButton(text: string, action: () => void, className = 'btn btn-sm btn-quiet') {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className; element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

function renderWishes() {
  if (!ready || !authenticated || wishEditing) return;
  const focused = document.activeElement as HTMLElement | null;
  const focusedId = focused?.dataset?.wishId;
  const focusedAction = focused?.dataset?.wishAction;
  wishList.replaceChildren(...book.wishes.map((wish, index) => {
    const item = document.createElement('li');
    item.className = 'wish';
    item.style.animationDelay = `${Math.min(index, 8) * 40}ms`;
    item.dataset.wishRow = wish.id;
    item.classList.toggle('is-done', wish.done);
    const label = document.createElement('label');
    label.className = 'wish-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.className = 'tick'; checkbox.checked = wish.done;
    checkbox.dataset.wishId = wish.id; checkbox.dataset.wishAction = 'toggle';
    checkbox.disabled = busy.has(`wish:${wish.id}`);
    const text = document.createElement('span'); text.className = 'wish-text'; text.textContent = wish.text;
    label.append(checkbox, text);
    checkbox.addEventListener('change', () => void toggleWish(wish.id, checkbox, wish.done));
    const actions = document.createElement('div'); actions.className = 'wish-actions';
    const story = document.createElement('a');
    story.className = 'btn btn-sm btn-quiet'; story.textContent = wish.done ? '回看后来' : '计划与故事';
    story.href = `/memories/?wish=${encodeURIComponent(wish.id)}#wishes`;
    const edit = makeButton('改一改', () => beginWishEdit(wish));
    edit.dataset.wishId = wish.id; edit.dataset.wishAction = 'edit';
    const remove = makeButton('移除', () => void removeWish(wish), 'btn btn-sm btn-quiet btn-danger');
    remove.setAttribute('aria-label', `移除：${wish.text}`);
    remove.dataset.wishId = wish.id; remove.dataset.wishAction = 'remove';
    remove.disabled = busy.has(`wish:${wish.id}`);
    actions.append(story, edit, remove);
    item.append(label, actions);
    return item;
  }));
  $('[data-wish-empty]').hidden = book.wishes.length > 0;
  $('[data-wish-count]').textContent = book.wishes.length ? `${book.wishes.filter(({ done }) => done).length} / ${book.wishes.length} 件已完成` : '还空着';
  if (focusedId) wishList.querySelector<HTMLElement>(`[data-wish-id="${CSS.escape(focusedId)}"][data-wish-action="${CSS.escape(focusedAction ?? '')}"]`)?.focus({ preventScroll: true });
}

function render() {
  setVisibility();
  if (!authenticated) {
    $('[data-note-text]').textContent = '';
    $('[data-notes-count]').textContent = '0';
    $('[data-notes-list]').replaceChildren();
    noteSearch.value = '';
    noteSearchClear.hidden = true;
    noteRandom.disabled = true;
    $('[data-note-index]').removeAttribute('open');
    $('[data-notes-empty]').textContent = '';
    $('[data-notes-empty]').hidden = true;
    $('[data-note-date]').textContent = '';
    wishList.replaceChildren();
    $('[data-wish-count]').textContent = '';
    $('[data-wish-result]').textContent = '';
    return;
  }
  if (ready) { renderNote(); renderWishes(); }
}

function setControls(form: HTMLElement, disabled: boolean) {
  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button').forEach(control => { control.disabled = disabled; });
}

function beginNoteEdit() {
  if (!ready || !authenticated || noteEditing) return;
  setControls(noteForm, false);
  noteEditing = true;
  noteEditSession++;
  noteEditOriginal = book.notes[date] ?? '';
  noteEditVersion = revisionOf(book.revisions.notes, date);
  noteInput.setCustomValidity('');
  noteInput.value = draftOf(getDrafts().notes, date) ?? noteEditOriginal;
  noteForm.hidden = false;
  $('[data-note-edit]').hidden = true;
  $('[data-note-text]').hidden = true;
  $('[data-note-delete]').hidden = !noteEditOriginal;
  $('[data-note-conflict]').hidden = true;
  $('[data-note-latest]').hidden = true;
  noteStatus.textContent = '';
  noteInput.focus();
  if (!calm.matches) animate(noteForm, { opacity: [0, 1], transform: ['translateY(.75rem)', 'translateY(0rem)'] }, { duration: .7, ease: [.16, 1, .3, 1] });
}

function finishNoteEdit(cancelled: boolean) {
  noteEditSession++;
  noteEditing = false;
  setControls(noteForm, false);
  noteForm.hidden = true;
  noteInput.setCustomValidity('');
  $('[data-note-edit]').hidden = false;
  $('[data-note-text]').hidden = false;
  $('[data-note-conflict]').hidden = true;
  $('[data-note-latest]').hidden = true;
  if (cancelled) clearNoteDraft(date);
  renderNote();
}

function beginWishEdit(wish: Wish) {
  if (!ready || wishEditing || busy.has(`wish:${wish.id}`)) return;
  const current = book.wishes.find(({ id }) => id === wish.id);
  if (!current || current.text !== wish.text || current.done !== wish.done) {
    showStatus('wish', '清单已有更新，请刷新查看后再修改。'); wishRefresh.hidden = false; return;
  }
  wishEditing = { id: current.id, expectedVersion: revisionOf(book.revisions.wishes, current.id), original: { ...current } };
  wishEditSession++;
  renderWishEditor(current, draftOf(getDrafts().wishes, current.id) ?? current.text);
}

function renderWishEditor(wish: Wish, value: string) {
  const item = document.createElement('li');
  item.className = 'wish-edit';
  item.dataset.wishRow = wish.id;
  const label = document.createElement('label'); label.className = 'sr-only'; label.htmlFor = `wish-edit-${wish.id}`;
  label.textContent = '修改这件小事';
  const input = document.createElement('input'); input.className = 'input'; input.type = 'text'; input.id = `wish-edit-${wish.id}`;
  input.maxLength = 120; input.required = true; input.value = value; input.dataset.wishEditInput = '';
  input.setAttribute('aria-label', '修改这件小事');
  input.addEventListener('input', () => {
    if (!wishEditing || !authenticated) return;
    getDrafts().wishes[wish.id] = input.value; saveDrafts();
    input.setCustomValidity('');
  });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void saveWishEdit(wish.id); } });
  const save = makeButton('收好', () => void saveWishEdit(wish.id), 'btn btn-sm btn-solid');
  save.dataset.wishId = wish.id; save.dataset.wishAction = 'save';
  const cancel = makeButton('取消', () => cancelWishEdit(), 'btn btn-sm');
  cancel.dataset.wishId = wish.id; cancel.dataset.wishAction = 'cancel';
  const refresh = makeButton('刷新查看', () => void refreshCloud('wish'), 'btn btn-sm');
  refresh.dataset.wishId = wish.id; refresh.dataset.wishAction = 'refresh'; refresh.hidden = true;
  const buttons = document.createElement('div'); buttons.className = 'row-actions'; buttons.append(save, cancel, refresh);
  const conflict = document.createElement('p'); conflict.className = 'wish-conflict'; conflict.dataset.wishConflict = ''; conflict.hidden = true;
  item.append(label, input, buttons, conflict);
  wishList.querySelector(`[data-wish-row="${CSS.escape(wish.id)}"]`)?.replaceWith(item);
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}

function cancelWishEdit() {
  if (!wishEditing) return;
  clearWishDraft(wishEditing.id);
  wishEditing = null;
  wishEditSession++;
  renderWishes();
  wishInput.focus({ preventScroll: true });
}

function updateWishConflict() {
  if (!wishEditing) return;
  const latest = book.wishes.find(({ id }) => id === wishEditing!.id);
  if (revisionOf(book.revisions.wishes, wishEditing.id) === wishEditing.expectedVersion) return;
  const text = latest ? `手账里已有更新：${latest.text}${latest.done ? '（已完成）' : ''}` : '手账里已移除这件事。';
  renderWishConflict(`${text} 草稿还在，可以先刷新对照。`);
  const refresh = wishList.querySelector<HTMLButtonElement>('[data-wish-action="refresh"]');
  if (refresh) refresh.hidden = false;
}

function applyCloud(value: unknown, explicitRefresh?: 'note' | 'wish') {
  const received = validateCloud(value);
  const wasReady = ready;
  book = wasReady ? mergeCloud(book, received) : received;
  ready = true;
  if (!wasReady && authenticated) wishInput.value = getDrafts().wishText;
  render();
  if (noteEditing && revisionOf(book.revisions.notes, date) !== noteEditVersion) showNoteConflict();
  if (wishEditing) updateWishConflict();
  if (explicitRefresh === 'note' && noteEditing) setNoteLatest();
  if (explicitRefresh === 'wish' && wishEditing) {
    const latest = book.wishes.find(({ id }) => id === wishEditing!.id);
    wishEditing.expectedVersion = revisionOf(book.revisions.wishes, wishEditing.id);
    wishEditing.original = latest ? { ...latest } : { id: wishEditing.id, text: '', done: false };
    const note = latest ? `手账里的新内容：${latest.text}${latest.done ? '（已完成）' : ''}。` : '手账里的这件事已被移除。';
    renderWishConflict(`${note} 草稿仍保留，确认后保存会替换手账里的这一版。`);
    showStatus('wish', '最新内容已显示，草稿仍保留。');
  }
  dispatchNotebookChanged();
}

function reportError(area: 'note' | 'wish', error: unknown) {
  if (error instanceof ApiError && error.status === 401) { publishSession({ authenticated: false, configured: true }); return; }
  if (error instanceof ApiError && error.status === 409) {
    if (area === 'note') showNoteConflict();
    if (area === 'wish' && wishEditing) updateWishConflict();
    showStatus(area, '手账里已有更新，草稿还在。先刷新查看，再决定怎么收好。');
    if (area === 'wish') (ready ? wishRefresh : wishRetry).hidden = false;
    return;
  }
  showStatus(area, '暂时没能连上手账。输入还在，可以重新连接。');
  if (area === 'note') noteRetry.hidden = false;
  if (area === 'wish') (ready ? wishRefresh : wishRetry).hidden = false;
}

async function refreshCloud(explicitRefresh?: 'note' | 'wish') {
  if (!authenticated) return;
  const requestGeneration = generation;
  if (pendingRefreshes.has(requestGeneration)) {
    if (explicitRefresh) queuedExplicitRefreshes.set(requestGeneration, explicitRefresh);
    return;
  }
  pendingRefreshes.add(requestGeneration);
  try {
    const response = await api<CloudNotebook>('/api/notebook');
    if (!authenticated || requestGeneration !== generation) return;
    applyCloud(response, explicitRefresh);
    noteRetry.hidden = true; wishRetry.hidden = true; wishRefresh.hidden = true;
    if (explicitRefresh === 'note' && noteEditing) return;
    if (explicitRefresh === 'wish' && wishEditing) return;
    if (explicitRefresh === 'note') {
      $('[data-note-conflict]').hidden = true;
      $('[data-note-latest]').hidden = true;
      if (noteUndo && revisionOf(book.revisions.notes, noteUndo.date) !== noteUndo.expectedVersion) { noteUndo = null; noteUndoButton.hidden = true; }
    }
    if (explicitRefresh === 'wish' && wishUndo && revisionOf(book.revisions.wishes, wishUndo.wish.id) !== wishUndo.expectedVersion) { wishUndo = null; wishUndoButton.hidden = true; }
    if (explicitRefresh) showStatus(explicitRefresh, '手账已刷新。');
  } catch (error) {
    if (requestGeneration === generation) {
      if (explicitRefresh) reportError(explicitRefresh, error);
      else { reportError('note', error); reportError('wish', error); }
    }
  } finally {
    pendingRefreshes.delete(requestGeneration);
    const queued = queuedExplicitRefreshes.get(requestGeneration);
    queuedExplicitRefreshes.delete(requestGeneration);
    if (queued && authenticated && requestGeneration === generation) void refreshCloud(queued);
  }
}

function setSession(state: SessionState) {
  if (authenticated === state.authenticated) { if (authenticated) void refreshCloud(); return; }
  const wasAuthenticated = authenticated;
  generation++; noteEditSession++; wishEditSession++;
  authenticated = state.authenticated;
  ready = false;
  book = emptyCloudNotebook();
  noteEditing = false; wishEditing = null;
  setControls(noteForm, false);
  noteUndo = null; wishUndo = null;
  noteUndoButton.hidden = true; wishUndoButton.hidden = true;
  noteStatus.textContent = ''; wishStatus.textContent = '';
  noteRetry.hidden = true; wishRetry.hidden = true;
  if (wasAuthenticated && !authenticated) draftsCache = null;
  if (!authenticated) {
    noteInput.value = ''; wishInput.value = '';
    $('[data-note-conflict]').hidden = true;
    $('[data-note-latest]').hidden = true;
    $('[data-note-latest]').textContent = '';
  }
  render();
  dispatchNotebookChanged();
  if (authenticated) void refreshCloud();
}

function mutateKey(area: 'note' | 'wish', key: string, path: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<CloudNotebook | null> {
  const lockKey = `${area}:${key}`;
  if (!authenticated || !ready || busy.has(lockKey)) return Promise.resolve(null);
  busy.add(lockKey);
  const requestGeneration = generation;
  return api<CloudNotebook>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(response => {
    if (!authenticated || requestGeneration !== generation) return null;
    const saved = validateCloud(response);
    book = mergeCloud(book, saved);
    render();
    dispatchNotebookChanged();
    return saved;
  }).catch((error: unknown) => {
    if (requestGeneration === generation) reportError(area, error);
    return null;
  }).finally(() => { busy.delete(lockKey); });
}

const noteBody = (expectedVersion: number, text: string) => ({ expectedVersion, text });

noteInput.addEventListener('input', () => {
  noteInput.setCustomValidity('');
  if (noteEditing && authenticated) { getDrafts().notes[date] = noteInput.value; saveDrafts(); }
});
$('[data-note-edit]').addEventListener('click', beginNoteEdit);
noteSearch.addEventListener('input', renderNoteArchive);
noteSearchClear.addEventListener('click', () => { noteSearch.value = ''; renderNoteArchive(); noteSearch.focus(); });
noteRandom.addEventListener('click', () => {
  const dates = writtenDates(book.notes);
  const candidates = dates.length > 1 ? dates.filter(key => key !== date) : dates;
  if (candidates.length) openSavedNote(candidates[Math.floor(Math.random() * candidates.length)]);
});
$('[data-note-cancel]').addEventListener('click', () => { finishNoteEdit(true); $('[data-note-edit]').focus(); });
$('[data-note-refresh]').addEventListener('click', () => void refreshCloud('note'));
noteRetry.addEventListener('click', () => void refreshCloud());
wishRefresh.addEventListener('click', () => void refreshCloud('wish'));

noteForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!noteEditing || busy.has(`note:${date}`)) return;
  const text = noteInput.value.trim();
  if (!text) { noteInput.setCustomValidity('写一点内容再收好。'); noteInput.reportValidity(); return; }
  const key = date;
  const editSession = noteEditSession;
  setControls(noteForm, true);
  try {
    const saved = await mutateKey('note', key, `/api/notes/${encodeURIComponent(key)}`, 'PUT', noteBody(noteEditVersion, text));
    if (!saved || !noteEditing || noteEditSession !== editSession || date !== key) return;
    clearNoteDraft(key);
    if (noteUndo?.date === key) { noteUndo = null; noteUndoButton.hidden = true; }
    finishNoteEdit(false);
    showStatus('note', '收好了。');
    $('[data-note-edit]').focus();
  } finally { if (noteEditing && noteEditSession === editSession) setControls(noteForm, false); }
});

$('[data-note-delete]').addEventListener('click', async () => {
  if (!noteEditing || !noteEditOriginal || busy.has(`note:${date}`)) return;
  const key = date;
  const removedText = noteEditOriginal;
  const expectedVersion = noteEditVersion;
  const editSession = noteEditSession;
  setControls(noteForm, true);
  try {
    const removed = await mutateKey('note', key, `/api/notes/${encodeURIComponent(key)}`, 'DELETE', { expectedVersion });
    if (!removed || !noteEditing || noteEditSession !== editSession || date !== key) return;
    noteUndo = { date: key, text: removedText, expectedVersion: expectedVersion + 1 };
    noteUndoButton.hidden = false;
    clearNoteDraft(key);
    finishNoteEdit(false);
    showStatus('note', '已移除，可以撤销。');
    $('[data-note-edit]').focus();
  } finally { if (noteEditing && noteEditSession === editSession) setControls(noteForm, false); }
});

noteUndoButton.addEventListener('click', async () => {
  if (!noteUndo || busy.has(`note:${noteUndo.date}`)) return;
  const action = noteUndo;
  const saved = await mutateKey('note', action.date, `/api/notes/${encodeURIComponent(action.date)}`, 'PUT', noteBody(action.expectedVersion, action.text));
  if (!saved) return;
  noteUndo = null; noteUndoButton.hidden = true;
  showStatus('note', '已放回手账里。');
});

const wishPath = (id: string) => `/api/wishes/${encodeURIComponent(id)}`;

async function toggleWish(id: string, checkbox: HTMLInputElement, displayedDone: boolean) {
  if (busy.has(`wish:${id}`)) return;
  const wish = book.wishes.find(item => item.id === id);
  if (!wish) return;
  const requested = checkbox.checked;
  if (wish.done !== displayedDone) {
    checkbox.checked = wish.done;
    showStatus('wish', '清单已有更新，请刷新查看后再修改。'); wishRefresh.hidden = false; return;
  }
  checkbox.closest('.wish')?.classList.toggle('is-done', requested);
  const saved = await mutateKey('wish', id, wishPath(id), 'PUT', { expectedVersion: revisionOf(book.revisions.wishes, id), text: wish.text, done: requested });
  if (!saved) {
    const latest = book.wishes.find(item => item.id === id);
    checkbox.checked = latest?.done ?? wish.done;
    checkbox.closest('.wish')?.classList.toggle('is-done', checkbox.checked);
    return;
  }
  showStatus('wish', requested ? '这一件，做到了。' : '放回待做的清单。');
}

async function removeWish(wish: Wish) {
  const current = book.wishes.find(({ id }) => id === wish.id);
  if (!current || current.text !== wish.text || current.done !== wish.done) {
    showStatus('wish', '清单已有更新，请刷新查看后再移除。'); wishRefresh.hidden = false; return;
  }
  const deletedWish = { ...current };
  const expectedVersion = revisionOf(book.revisions.wishes, current.id);
  const removed = await mutateKey('wish', current.id, wishPath(current.id), 'DELETE', { expectedVersion });
  if (!removed) return;
  wishUndo = { wish: deletedWish, expectedVersion: expectedVersion + 1 };
  wishUndoButton.hidden = false;
  showStatus('wish', '已移除，可以撤销。');
}

wishUndoButton.addEventListener('click', async () => {
  if (!wishUndo) return;
  const action = wishUndo;
  const saved = await mutateKey('wish', action.wish.id, wishPath(action.wish.id), 'PUT', { expectedVersion: action.expectedVersion, text: action.wish.text, done: action.wish.done });
  if (!saved) return;
  wishUndo = null; wishUndoButton.hidden = true;
  showStatus('wish', '已放回清单。');
});

wishForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (wishAdding) return;
  const text = wishInput.value.trim();
  wishInput.setCustomValidity('');
  if (!text) { wishInput.setCustomValidity('写下一件小事再记上。'); wishInput.reportValidity(); return; }
  const id = crypto.randomUUID();
  wishAdding = true;
  const submit = wishForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  wishInput.disabled = true; submit.disabled = true;
  try {
    const saved = await mutateKey('wish', id, wishPath(id), 'PUT', { expectedVersion: 0, text, done: false });
    if (!saved) return;
    if (wishInput.value === text || wishInput.value.trim() === text) {
      const drafts = getDrafts(); drafts.wishText = ''; saveDrafts();
      wishInput.value = '';
    }
    showStatus('wish', '记上了。');
    wishInput.focus();
  } finally { wishAdding = false; wishInput.disabled = false; submit.disabled = false; }
});
wishInput.addEventListener('input', () => {
  wishInput.setCustomValidity('');
  if (!authenticated) return;
  const drafts = getDrafts(); drafts.wishText = wishInput.value; saveDrafts();
});

/* Drawing one: the candidates flicker past before one settles. */
$('[data-wish-draw]').addEventListener('click', () => {
  const result = $('[data-wish-result]');
  const candidates = book.wishes.filter(({ done }) => !done);
  if (!candidates.length) { result.textContent = book.wishes.length ? '都做完了。再添一件？' : '先在清单里写一件，再来抽。'; return; }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const final = `这次就选：${chosen.text}`;
  if (calm.matches || candidates.length < 2) { result.textContent = final; return; }
  result.classList.add('is-shuffling');
  let step = 0;
  const flick = () => {
    if (step++ < 9) {
      result.textContent = candidates[step % candidates.length].text;
      window.setTimeout(flick, 45 + step * 14);
    } else {
      result.classList.remove('is-shuffling');
      result.textContent = final;
      animate(result, { opacity: [0, 1], transform: ['translateY(.4em)', 'translateY(0em)'], filter: ['blur(6px)', 'blur(0px)'] }, { duration: .7, ease: [.16, 1, .3, 1] });
    }
  };
  flick();
});
wishRetry.addEventListener('click', () => void refreshCloud());

async function saveWishEdit(id: string) {
  if (!wishEditing || wishEditing.id !== id || busy.has(`wish:${id}`)) return;
  const input = wishList.querySelector<HTMLInputElement>('[data-wish-edit-input]');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { input.setCustomValidity('写下一件小事再收好。'); input.reportValidity(); return; }
  const edit = wishEditing;
  const token = wishEditSession;
  const row = input.closest('li')!;
  setControls(row, true);
  try {
    const saved = await mutateKey('wish', id, wishPath(id), 'PUT', { expectedVersion: edit.expectedVersion, text, done: edit.original.done });
    if (!saved || !wishEditing || wishEditing.id !== id || wishEditSession !== token) return;
    clearWishDraft(id);
    wishEditing = null;
    wishEditSession++;
    showStatus('wish', '收好了。');
    renderWishes();
    wishList.querySelector<HTMLElement>(`[data-wish-id="${CSS.escape(id)}"][data-wish-action="edit"]`)?.focus({ preventScroll: true });
  } finally {
    if (wishEditing?.id === id && wishEditSession === token) setControls(row, false);
  }
}

document.addEventListener('journal:date', event => {
  if (noteEditing) return;
  date = (event as CustomEvent<string>).detail;
  renderNote();
});
document.addEventListener('journal:notes-request', () => { if (authenticated && ready) dispatchNotebookChanged(); });

/* The prompt row: nine everyday questions, one at a time. */
const prompts = [
  '这一天有什么小事，想留在这一页？', '这一天吃到了什么好吃的？', '这一天哪一刻，让你松了一口气？',
  '这一天有没有一句话，想再记一遍？', '这一天看到了什么有意思的东西？', '这一天有什么事，比想象中顺利？',
  '这一天有没有一件事，想和对方说说？', '这一天听到的哪首歌，还留在脑海里？', '有什么话，想留给以后的自己？',
];
const question = $('[data-daily-prompt-question]');
let promptIndex = 0;
$('[data-daily-prompt-next]').addEventListener('click', () => {
  promptIndex = (promptIndex + 1) % prompts.length;
  question.textContent = prompts[promptIndex];
  question.classList.remove('is-turning');
  if (!calm.matches) { void question.offsetWidth; question.classList.add('is-turning'); }
});
question.addEventListener('animationend', () => question.classList.remove('is-turning'));

onSessionChange(setSession);
void getSession().catch(() => { /* Unknown sessions stay in the guest view. */ });
window.setInterval(() => { if (document.visibilityState === 'visible' && authenticated) void refreshCloud(); }, 10_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && authenticated) void refreshCloud(); });
setVisibility();
render();
