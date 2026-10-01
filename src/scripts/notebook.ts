import { dotted, relationshipStartDate } from '../lib/anniversary';
import { api, ApiError, emptyCloudNotebook, type CloudNotebook, type SessionState } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession } from '../lib/session';
import { isCalendarDate, notebookKey, parseNotebook, type Notebook, type Wish } from '../lib/notebook';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const noteGuest = $('[data-note-guest]');
const noteLoading = $('[data-note-loading]');
const noteLoadingStatus = $('[data-note-loading-status]');
const notePrivate = $('[data-note-private]');
const noteStatus = $('[data-note-status]');
const noteRetry = $('[data-note-retry]');
const noteForm = $<HTMLFormElement>('[data-note-form]');
const noteInput = $<HTMLTextAreaElement>('#day-note');
const noteUndoButton = $<HTMLButtonElement>('[data-note-undo]');
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
const toolsStatus = $('[data-notebook-status]');
const fileInput = $<HTMLInputElement>('[data-notebook-file]');
const importDialog = $<HTMLDialogElement>('[data-import-dialog]');
const importForm = $<HTMLFormElement>('[data-import-form]');
const importConflicts = $('[data-import-conflicts]');
const importCancel = $<HTMLButtonElement>('[data-import-cancel]');

interface Drafts {
  version: 1;
  notes: Record<string, string>;
  wishText: string;
  wishes: Record<string, string>;
}
interface NoteUndo { date: string; text: string; expectedVersion: number }
interface WishUndo { wish: Wish; expectedVersion: number }
interface WishEdit { id: string; expectedVersion: number; original: Wish }
type ImportConflict =
  | { type: 'note'; key: string; cloud?: string; incoming: string; deleted: boolean }
  | { type: 'wish'; key: string; cloud?: Wish; incoming: Wish; deleted: boolean };
type ImportOperation =
  | { type: 'note'; key: string; text: string; expectedVersion: number }
  | { type: 'wish'; wish: Wish; expectedVersion: number };

const DRAFT_KEY = 'loveuhqq_notebook_drafts_v1';
const emptyDrafts = (): Drafts => ({ version: 1, notes: {}, wishText: '', wishes: {} });
const revisionOf = (revisions: Record<string, number>, key: string) => Object.hasOwn(revisions, key) ? revisions[key] : 0;
const draftOf = (values: Record<string, string>, key: string) => Object.hasOwn(values, key) ? values[key] : undefined;
let draftsCache: Drafts | null = null;
let book: CloudNotebook = emptyCloudNotebook();
let authenticated = false;
let ready = false;
let generation = 0;
const pendingRefreshes = new Set<number>();
const queuedExplicitRefreshes = new Map<number, 'note' | 'wish'>();
let date = relationshipStartDate;
let noteEditing = false;
let noteEditSession = 0;
let noteEditVersion = 0;
let noteEditOriginal = '';
let wishEditing: WishEdit | null = null;
let wishEditSession = 0;
let wishAdding = false;
let noteUndo: NoteUndo | null = null;
let wishUndo: WishUndo | null = null;
let importing = false;
const busy = new Set<string>();

function showStatus(area: 'note' | 'wish' | 'tools', text: string) {
  const target = area === 'note' ? noteStatus : area === 'wish' ? wishStatus : toolsStatus;
  if (area === 'note' && !ready) noteLoadingStatus.textContent = text;
  else if (area === 'wish' && !ready) wishLoadingStatus.textContent = text;
  else target.textContent = text;
}

function getDrafts(): Drafts {
  if (!authenticated) return emptyDrafts();
  if (draftsCache) return draftsCache;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return draftsCache = emptyDrafts();
    const value = JSON.parse(raw) as Partial<Drafts>;
    const notes = value.notes && typeof value.notes === 'object' && !Array.isArray(value.notes) ? value.notes : {};
    const wishes = value.wishes && typeof value.wishes === 'object' && !Array.isArray(value.wishes) ? value.wishes : {};
    return draftsCache = {
      version: 1,
      notes: Object.fromEntries(Object.entries(notes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      wishText: typeof value.wishText === 'string' ? value.wishText : '',
      wishes: Object.fromEntries(Object.entries(wishes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    };
  } catch {
    return draftsCache = emptyDrafts();
  }
}

function saveDrafts() {
  if (!authenticated || !draftsCache) return;
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftsCache)); } catch { /* Keep the current tab's in-memory draft. */ }
}

function clearNoteDraft(key: string) {
  if (!authenticated) return;
  const drafts = getDrafts();
  delete drafts.notes[key];
  saveDrafts();
}

function clearWishDraft(key: string) {
  if (!authenticated) return;
  const drafts = getDrafts();
  delete drafts.wishes[key];
  saveDrafts();
}

function validateCloud(value: unknown): CloudNotebook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cloud notebook');
  const record = value as Partial<CloudNotebook>;
  const parsed = parseNotebook(JSON.stringify(value));
  const revisions = record.revisions;
  if (!revisions || typeof revisions !== 'object' || !revisions.notes || typeof revisions.notes !== 'object' || Array.isArray(revisions.notes) || !revisions.wishes || typeof revisions.wishes !== 'object' || Array.isArray(revisions.wishes)) throw new Error('Invalid revisions');
  const notes: Record<string, number> = {};
  for (const [key, revision] of Object.entries(revisions.notes)) {
    if (!isCalendarDate(key) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid note revision');
    notes[key] = revision;
  }
  const wishes: Record<string, number> = {};
  for (const [key, revision] of Object.entries(revisions.wishes)) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(key) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid wish revision');
    wishes[key] = revision;
  }
  return { ...parsed, revisions: { notes, wishes } };
}

function mergeCloud(currentValue: CloudNotebook, incomingValue: CloudNotebook): CloudNotebook {
  const current = validateCloud(currentValue);
  const incoming = validateCloud(incomingValue);
  const notes: Record<string, string> = { ...current.notes };
  const noteVersions: Record<string, number> = { ...current.revisions.notes };
  const noteKeys = new Set([...Object.keys(current.revisions.notes), ...Object.keys(incoming.revisions.notes), ...Object.keys(current.notes), ...Object.keys(incoming.notes)]);
  for (const key of noteKeys) {
    const before = revisionOf(current.revisions.notes, key);
    const after = revisionOf(incoming.revisions.notes, key);
    if (after >= before) {
      if (Object.hasOwn(incoming.notes, key)) notes[key] = incoming.notes[key];
      else delete notes[key];
      if (Object.hasOwn(incoming.revisions.notes, key)) noteVersions[key] = after;
      else delete noteVersions[key];
    }
  }

  const currentById = new Map(current.wishes.map((wish) => [wish.id, wish]));
  const incomingById = new Map(incoming.wishes.map((wish) => [wish.id, wish]));
  const wishVersions: Record<string, number> = { ...current.revisions.wishes };
  const wishIds = new Set([...Object.keys(current.revisions.wishes), ...Object.keys(incoming.revisions.wishes), ...currentById.keys(), ...incomingById.keys()]);
  for (const id of wishIds) {
    const before = revisionOf(current.revisions.wishes, id);
    const after = revisionOf(incoming.revisions.wishes, id);
    if (after >= before) {
      if (Object.hasOwn(incoming.revisions.wishes, id)) wishVersions[id] = after;
      else delete wishVersions[id];
    }
  }
  const wishes: Wish[] = [];
  const order = [...current.wishes.map(({ id }) => id), ...incoming.wishes.map(({ id }) => id).filter((id) => !currentById.has(id))];
  for (const id of order) {
    const before = revisionOf(current.revisions.wishes, id);
    const after = revisionOf(incoming.revisions.wishes, id);
    const selected = after >= before ? incomingById.get(id) : currentById.get(id);
    if (selected && !wishes.some((wish) => wish.id === id)) wishes.push(selected);
  }
  return { version: 1, notes, wishes, revisions: { notes: noteVersions, wishes: wishVersions } };
}

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

function dispatchNotebookChanged() {
  document.dispatchEvent(new CustomEvent('notebook:changed', { detail: Object.keys(book.notes) }));
}

function renderNote() {
  if (!ready || !authenticated) return;
  $('[data-note-date]').textContent = dotted(date);
  $('[data-note-text]').textContent = book.notes[date] ?? '这一天还空着。想记的时候，再写。';
  $('[data-note-edit-label]').textContent = book.notes[date] ? '改一改' : '写一句';
  if (!noteEditing) {
    noteForm.hidden = true;
    $('[data-note-edit]').hidden = false;
    $('[data-note-text]').hidden = false;
    $('[data-note-delete]').hidden = !book.notes[date];
  }
  $('[data-notes-count]').textContent = String(Object.keys(book.notes).length);
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedDate = focused?.dataset.noteDate;
  const index = $('[data-notes-list]');
  index.replaceChildren();
  for (const key of Object.keys(book.notes).sort().reverse()) {
    const entry = document.createElement('button');
    entry.type = 'button'; entry.className = 'text-button note-index-entry';
    entry.dataset.noteDate = key;
    entry.textContent = `${dotted(key)}　${[...book.notes[key]].slice(0, 36).join('')}`;
    entry.addEventListener('click', () => {
      if (noteEditing) { showStatus('note', '先收好或取消正在写的这一句。'); return; }
      date = key; renderNote(); $('[data-note-date]').scrollIntoView({ block: 'center' });
    });
    index.append(entry);
  }
  if (focusedDate) index.querySelector<HTMLElement>(`[data-note-date="${CSS.escape(focusedDate)}"]`)?.focus({ preventScroll: true });
  if (noteEditing && revisionOf(book.revisions.notes, date) !== noteEditVersion) showNoteConflict();
}

function showNoteConflict() {
  const panel = $('[data-note-conflict]');
  panel.hidden = false;
  panel.querySelector<HTMLElement>('p')!.textContent = noteEditing
    ? '这一天在云端有新内容。草稿还在，可以先刷新对照。'
    : '这一天在云端有新内容，请先刷新查看。';
  $('[data-note-latest]').hidden = true;
}

function setNoteLatest() {
  const latest = $('[data-note-latest]');
  latest.textContent = book.notes[date] ? `云端目前写着：${book.notes[date]}` : '云端目前没有这一天的记录。';
  latest.hidden = false;
  noteEditVersion = revisionOf(book.revisions.notes, date);
  noteEditOriginal = book.notes[date] ?? '';
  showStatus('note', '最新内容已显示，草稿仍保留。确认后保存会替换云端这一版。');
}

function renderWishConflict(message: string) {
  if (!wishEditing) return;
  const item = wishList.querySelector<HTMLElement>(`[data-wish-row="${CSS.escape(wishEditing.id)}"]`);
  if (!item) return;
  const panel = item.querySelector<HTMLElement>('[data-wish-conflict]');
  if (panel) { panel.hidden = false; panel.textContent = message; }
}

function renderWishes() {
  if (!ready || !authenticated || wishEditing) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedId = focused?.dataset.wishId;
  const focusedAction = focused?.dataset.wishAction;
  wishList.replaceChildren();
  for (const wish of book.wishes) {
    const item = document.createElement('li');
    item.dataset.wishRow = wish.id;
    item.classList.toggle('is-done', wish.done);
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = wish.done;
    checkbox.dataset.wishId = wish.id; checkbox.dataset.wishAction = 'toggle';
    checkbox.disabled = busy.has(`wish:${wish.id}`);
    const text = document.createElement('span'); text.textContent = wish.text;
    label.append(checkbox, text);
    checkbox.addEventListener('change', () => void toggleWish(wish.id, checkbox, wish.done));
    const actions = document.createElement('div'); actions.className = 'wish-actions';
    const edit = makeButton('改一改', () => beginWishEdit(wish));
    edit.dataset.wishId = wish.id; edit.dataset.wishAction = 'edit';
    const remove = makeButton('移除', () => void removeWish(wish));
    remove.setAttribute('aria-label', `移除：${wish.text}`);
    remove.dataset.wishId = wish.id; remove.dataset.wishAction = 'remove';
    remove.disabled = busy.has(`wish:${wish.id}`);
    actions.append(edit, remove);
    item.append(label, actions); wishList.append(item);
  }
  $('[data-wish-empty]').hidden = book.wishes.length > 0;
  $('[data-wish-count]').textContent = book.wishes.length ? `${book.wishes.filter(({ done }) => done).length} / ${book.wishes.length} 件已完成` : '还空着';
  $('[data-wish-result]').textContent = '';
  if (focusedId) wishList.querySelector<HTMLElement>(`[data-wish-id="${CSS.escape(focusedId)}"][data-wish-action="${CSS.escape(focusedAction ?? '')}"]`)?.focus({ preventScroll: true });
}

function render() {
  setVisibility();
  if (!authenticated) {
    $('[data-note-text]').textContent = '';
    $('[data-notes-count]').textContent = '0';
    $('[data-notes-list]').replaceChildren();
    wishList.replaceChildren();
    $('[data-wish-count]').textContent = '';
    $('[data-wish-result]').textContent = '';
    return;
  }
  if (ready) { renderNote(); renderWishes(); }
}

function makeButton(text: string, action: () => void, className = 'text-button') {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className; element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

function beginNoteEdit() {
  if (!ready || !authenticated || noteEditing) return;
  noteForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button').forEach((control) => { control.disabled = false; });
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
}

function finishNoteEdit(cancelled: boolean) {
  noteEditSession++;
  noteEditing = false;
  noteForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button').forEach((control) => { control.disabled = false; });
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
  item.dataset.wishRow = wish.id; item.classList.toggle('is-done', wish.done);
  const label = document.createElement('label'); label.className = 'sr-only'; label.htmlFor = `wish-edit-${wish.id}`;
  label.textContent = '修改这件小事';
  const input = document.createElement('input'); input.type = 'text'; input.id = `wish-edit-${wish.id}`;
  input.maxLength = 120; input.required = true; input.value = value; input.dataset.wishEditInput = '';
  input.setAttribute('aria-label', '修改这件小事');
  input.addEventListener('input', () => {
    if (!wishEditing || !authenticated) return;
    getDrafts().wishes[wish.id] = input.value; saveDrafts();
    input.setCustomValidity('');
  });
  const save = makeButton('收好', () => void saveWishEdit(wish.id), 'pencil-button');
  save.dataset.wishId = wish.id; save.dataset.wishAction = 'save';
  const cancel = makeButton('取消', () => cancelWishEdit());
  cancel.dataset.wishId = wish.id; cancel.dataset.wishAction = 'cancel';
  const refresh = makeButton('刷新查看', () => void refreshCloud('wish'));
  refresh.dataset.wishId = wish.id; refresh.dataset.wishAction = 'refresh'; refresh.hidden = true;
  const buttons = document.createElement('div'); buttons.className = 'wish-edit-actions'; buttons.append(save, cancel, refresh);
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
  $('#wish-text').focus({ preventScroll: true });
}

function updateWishConflict() {
  if (!wishEditing) return;
  const latest = book.wishes.find(({ id }) => id === wishEditing!.id);
  const revision = revisionOf(book.revisions.wishes, wishEditing.id);
  if (revision === wishEditing.expectedVersion) return;
  const text = latest ? `云端已有更新：${latest.text}${latest.done ? '（已完成）' : ''}` : '云端已移除这件事。';
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
    const note = latest ? `最新云端内容：${latest.text}${latest.done ? '（已完成）' : ''}。` : '最新云端内容：这件事已被移除。';
    renderWishConflict(`${note} 草稿仍保留，确认后保存会替换云端这一版。`);
    showStatus('wish', '最新内容已显示，草稿仍保留。');
  }
  dispatchNotebookChanged();
}

function handleUnauthorized() {
  publishSession({ authenticated: false, configured: true });
}

function reportError(area: 'note' | 'wish' | 'tools', error: unknown) {
  if (error instanceof ApiError && error.status === 401) { handleUnauthorized(); return; }
  if (error instanceof ApiError && error.status === 409) {
    if (area === 'note') showNoteConflict();
    if (area === 'wish' && wishEditing) updateWishConflict();
    showStatus(area, '云端已有更新，草稿还在。先刷新查看，再决定怎么收好。');
    if (area === 'wish' && ready) wishRefresh.hidden = false;
    if (area === 'wish' && !ready) wishRetry.hidden = false;
    return;
  }
  const message = '暂时没能连接云端手账。输入还在，可以重新连接。';
  showStatus(area, message);
  if (area === 'note') noteRetry.hidden = false;
  if (area === 'wish' && ready) wishRefresh.hidden = false;
  if (area === 'wish' && !ready) wishRetry.hidden = false;
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
    noteRetry.hidden = true; wishRetry.hidden = true;
    wishRefresh.hidden = true;
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
  if (authenticated === state.authenticated) {
    if (authenticated) void refreshCloud();
    return;
  }
  const wasAuthenticated = authenticated;
  generation++;
  noteEditSession++;
  wishEditSession++;
  authenticated = state.authenticated;
  ready = false;
  book = emptyCloudNotebook();
  noteEditing = false; wishEditing = null;
  noteForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button').forEach((control) => { control.disabled = false; });
  noteUndo = null; wishUndo = null;
  noteUndoButton.hidden = true; wishUndoButton.hidden = true;
  noteStatus.textContent = ''; wishStatus.textContent = ''; toolsStatus.textContent = '';
  noteRetry.hidden = true; wishRetry.hidden = true;
  if (wasAuthenticated && !authenticated) draftsCache = null;
  if (!authenticated) {
    noteInput.value = ''; wishInput.value = '';
    $('[data-note-conflict]').hidden = true;
    $('[data-note-latest]').hidden = true;
    $('[data-note-latest]').textContent = '';
    importConflicts.replaceChildren();
    importDialog.open && importDialog.close('cancel');
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
  const submit = api<CloudNotebook>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return submit.then((response) => {
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

function noteBody(expectedVersion: number, text: string) { return { expectedVersion, text }; }

noteInput.addEventListener('input', () => {
  noteInput.setCustomValidity('');
  if (noteEditing && authenticated) { getDrafts().notes[date] = noteInput.value; saveDrafts(); }
});
$('[data-note-edit]').addEventListener('click', beginNoteEdit);
$('[data-note-cancel]').addEventListener('click', () => { finishNoteEdit(true); $('[data-note-edit]').focus(); });
$('[data-note-refresh]').addEventListener('click', () => void refreshCloud('note'));
noteRetry.addEventListener('click', () => void refreshCloud());
wishRefresh.addEventListener('click', () => void refreshCloud('wish'));

noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!noteEditing || busy.has(`note:${date}`)) return;
  const text = noteInput.value.trim();
  if (!text) { noteInput.setCustomValidity('写一点内容再收好。'); noteInput.reportValidity(); return; }
  const key = date;
  const editSession = noteEditSession;
  const controls = [...noteForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')];
  controls.forEach((control) => { control.disabled = true; });
  try {
    const saved = await mutateKey('note', key, `/api/notes/${encodeURIComponent(key)}`, 'PUT', noteBody(noteEditVersion, text));
    if (!saved || !noteEditing || noteEditSession !== editSession || date !== key) return;
    clearNoteDraft(key);
    if (noteUndo?.date === key) { noteUndo = null; noteUndoButton.hidden = true; }
    finishNoteEdit(false);
    showStatus('note', '收好了，云端已保存。');
    $('[data-note-edit]').focus();
  } finally { if (noteEditing && noteEditSession === editSession) controls.forEach((control) => { control.disabled = false; }); }
});

$('[data-note-delete]').addEventListener('click', async () => {
  if (!noteEditing || !noteEditOriginal || busy.has(`note:${date}`)) return;
  const key = date;
  const removedText = noteEditOriginal;
  const deleteExpectedVersion = noteEditVersion;
  const editSession = noteEditSession;
  const controls = [...noteForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')];
  controls.forEach((control) => { control.disabled = true; });
  try {
    const removed = await mutateKey('note', key, `/api/notes/${encodeURIComponent(key)}`, 'DELETE', { expectedVersion: deleteExpectedVersion });
    if (!removed || !noteEditing || noteEditSession !== editSession || date !== key) return;
    noteUndo = { date: key, text: removedText, expectedVersion: deleteExpectedVersion + 1 };
    noteUndoButton.hidden = false;
    clearNoteDraft(key);
    finishNoteEdit(false);
    showStatus('note', '已移除，可以撤销。');
    $('[data-note-edit]').focus();
  } finally { if (noteEditing && noteEditSession === editSession) controls.forEach((control) => { control.disabled = false; }); }
});

noteUndoButton.addEventListener('click', async () => {
  if (!noteUndo || busy.has(`note:${noteUndo.date}`)) return;
  const action = noteUndo;
  const saved = await mutateKey('note', action.date, `/api/notes/${encodeURIComponent(action.date)}`, 'PUT', noteBody(action.expectedVersion, action.text));
  if (!saved) return;
  noteUndo = null; noteUndoButton.hidden = true;
  showStatus('note', '已放回云端。');
});

function wishPath(id: string) { return `/api/wishes/${encodeURIComponent(id)}`; }

async function toggleWish(id: string, checkbox: HTMLInputElement, displayedDone: boolean) {
  if (busy.has(`wish:${id}`)) return;
  const wish = book.wishes.find((item) => item.id === id);
  if (!wish) return;
  const requested = checkbox.checked;
  if (wish.done !== displayedDone) {
    checkbox.checked = wish.done;
    showStatus('wish', '清单已有更新，请刷新查看后再修改。'); wishRefresh.hidden = false; return;
  }
  const saved = await mutateKey('wish', id, wishPath(id), 'PUT', {
    expectedVersion: revisionOf(book.revisions.wishes, id), text: wish.text, done: requested,
  });
  if (!saved) {
    const latest = book.wishes.find((item) => item.id === id);
    checkbox.checked = latest?.done ?? wish.done;
    return;
  }
  showStatus('wish', requested ? '这一件，做到了。' : '放回待做的清单。');
}

async function removeWish(wish: Wish) {
  const snapshot = book;
  const current = snapshot.wishes.find(({ id }) => id === wish.id);
  if (!current || current.text !== wish.text || current.done !== wish.done) {
    showStatus('wish', '清单已有更新，请刷新查看后再移除。'); wishRefresh.hidden = false; return;
  }
  const deletedWish = { ...current };
  const deleteExpectedVersion = revisionOf(snapshot.revisions.wishes, current.id);
  const removed = await mutateKey('wish', current.id, wishPath(current.id), 'DELETE', { expectedVersion: deleteExpectedVersion });
  if (!removed) return;
  wishUndo = { wish: deletedWish, expectedVersion: deleteExpectedVersion + 1 };
  wishUndoButton.hidden = false;
  showStatus('wish', '已移除，可以撤销。');
}

wishUndoButton.addEventListener('click', async () => {
  if (!wishUndo) return;
  const action = wishUndo;
  const saved = await mutateKey('wish', action.wish.id, wishPath(action.wish.id), 'PUT', {
    expectedVersion: action.expectedVersion, text: action.wish.text, done: action.wish.done,
  });
  if (!saved) return;
  wishUndo = null; wishUndoButton.hidden = true;
  showStatus('wish', '已放回清单。');
});

wishForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (wishAdding) return;
  const text = wishInput.value.trim();
  wishInput.setCustomValidity('');
  if (!text) { wishInput.setCustomValidity('写下一件小事再记上。'); wishInput.reportValidity(); return; }
  const id = crypto.randomUUID();
  const submittedText = text;
  wishAdding = true;
  const submit = wishForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  wishInput.disabled = true;
  submit.disabled = true;
  try {
    const saved = await mutateKey('wish', id, wishPath(id), 'PUT', { expectedVersion: 0, text, done: false });
    if (!saved) return;
    if (wishInput.value === submittedText) {
      const drafts = getDrafts(); drafts.wishText = ''; saveDrafts();
      wishInput.value = '';
    }
    showStatus('wish', '记上了，云端已保存。');
    wishInput.focus();
  } finally { wishAdding = false; wishInput.disabled = false; submit.disabled = false; }
});

wishInput.addEventListener('input', () => {
  wishInput.setCustomValidity('');
  if (!authenticated) return;
  const drafts = getDrafts(); drafts.wishText = wishInput.value; saveDrafts();
});
$('[data-wish-draw]').addEventListener('click', () => {
  const candidates = book.wishes.filter(({ done }) => !done);
  $('[data-wish-result]').textContent = candidates.length ? `这次就选：${candidates[Math.floor(Math.random() * candidates.length)].text}` : book.wishes.length ? '都做完了。再添一件？' : '先在清单里写一件，再来抽。';
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
  const controls = [...row.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
  controls.forEach((control) => { control.disabled = true; });
  try {
    const saved = await mutateKey('wish', id, wishPath(id), 'PUT', {
      expectedVersion: edit.expectedVersion, text, done: edit.original.done,
    });
    if (!saved || !wishEditing || wishEditing.id !== id || wishEditSession !== token) return;
    clearWishDraft(id);
    wishEditing = null;
    wishEditSession++;
    showStatus('wish', '收好了，云端已保存。');
    renderWishes();
    wishList.querySelector<HTMLElement>(`[data-wish-id="${CSS.escape(id)}"][data-wish-action="edit"]`)?.focus({ preventScroll: true });
  } finally {
    if (wishEditing?.id === id && wishEditSession === token) controls.forEach((control) => { control.disabled = false; });
  }
}

document.addEventListener('journal:date', (event) => {
  if (noteEditing) return;
  date = (event as CustomEvent<string>).detail;
  renderNote();
});
document.addEventListener('journal:notes-request', () => { if (authenticated && ready) dispatchNotebookChanged(); });

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('[data-notebook-export]').addEventListener('click', () => {
  if (!authenticated || !ready) return;
  const backup: Notebook = { version: 1, notes: { ...book.notes }, wishes: book.wishes.map((wish) => ({ ...wish })) };
  download(JSON.stringify(backup, null, 2), 'loveuhqq-notebook.json');
  showStatus('tools', '云端手账已导出。');
});

function describeWish(wish: Wish) { return `${wish.text}${wish.done ? '（已完成）' : '（还没完成）'}`; }

async function chooseImportConflicts(conflicts: ImportConflict[]): Promise<Map<string, boolean> | null> {
  if (!conflicts.length) return new Map();
  importConflicts.replaceChildren();
  conflicts.forEach((conflict, index) => {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'notebook-conflict';
    const legend = document.createElement('legend');
    legend.textContent = conflict.type === 'note' ? dotted(conflict.key) : '往后的小清单';
    const cloud = document.createElement('p');
    cloud.textContent = `云端：${conflict.deleted ? '已移除' : conflict.type === 'note' ? conflict.cloud : describeWish(conflict.cloud!)}`;
    const incoming = document.createElement('p'); incoming.textContent = `导入：${conflict.type === 'note' ? conflict.incoming : describeWish(conflict.incoming)}`;
    const choices = document.createElement('div'); choices.className = 'notebook-conflict-choices';
    const labels = conflict.deleted ? ['保留已移除', '从备份恢复'] : ['保留云端', '用导入内容'];
    for (const [value, labelText, checked] of [['cloud', labels[0], true], ['incoming', labels[1], false]] as const) {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'radio'; input.name = `notebook-conflict-${index}`;
      input.value = value; input.checked = checked;
      label.append(input, document.createTextNode(labelText)); choices.append(label);
    }
    fieldset.append(legend, cloud, incoming, choices); importConflicts.append(fieldset);
  });
  return new Promise((resolve) => {
    const onClose = () => {
      if (importDialog.returnValue !== 'import') { resolve(null); return; }
      const result = new Map<string, boolean>();
      conflicts.forEach((conflict, index) => {
        const choice = importForm.querySelector<HTMLInputElement>(`[name="notebook-conflict-${index}"]:checked`);
        result.set(`${conflict.type}:${conflict.key}`, choice?.value === 'incoming');
      });
      resolve(result);
    };
    const onSubmit = (event: SubmitEvent) => { event.preventDefault(); importDialog.close('import'); };
    const onCancel = () => importDialog.close('cancel');
    importDialog.addEventListener('close', onClose, { once: true });
    importForm.addEventListener('submit', onSubmit, { once: true });
    importCancel.addEventListener('click', onCancel, { once: true });
    importDialog.showModal();
  });
}

function planImport(incoming: Notebook, snapshot: CloudNotebook, choices: Map<string, boolean>): ImportOperation[] {
  const operations: ImportOperation[] = [];
  for (const [key, text] of Object.entries(incoming.notes)) {
    const current = snapshot.notes[key];
    const deleted = current === undefined && revisionOf(snapshot.revisions.notes, key) > 0;
    const conflict = (current !== undefined && current !== text) || deleted;
    if (current === text || (conflict && !choices.get(`note:${key}`))) continue;
    operations.push({ type: 'note', key, text, expectedVersion: revisionOf(snapshot.revisions.notes, key) });
  }
  for (const wish of incoming.wishes) {
    const current = snapshot.wishes.find(({ id }) => id === wish.id);
    const same = current?.text === wish.text && current.done === wish.done;
    const deleted = current === undefined && revisionOf(snapshot.revisions.wishes, wish.id) > 0;
    const conflict = (current !== undefined && !same) || deleted;
    if (same || (conflict && !choices.get(`wish:${wish.id}`))) continue;
    operations.push({ type: 'wish', wish, expectedVersion: revisionOf(snapshot.revisions.wishes, wish.id) });
  }
  return operations;
}

async function importNotebook(incoming: Notebook) {
  if (!authenticated || !ready || importing) return;
  importing = true;
  $('[data-notebook-import]').setAttribute('aria-disabled', 'true');
  $('[data-notebook-local-import]').setAttribute('aria-disabled', 'true');
  const snapshot = validateCloud(book);
  try {
    const conflicts: ImportConflict[] = [];
    for (const [key, text] of Object.entries(incoming.notes)) {
      const cloud = snapshot.notes[key];
      const deleted = cloud === undefined && revisionOf(snapshot.revisions.notes, key) > 0;
      if ((cloud !== undefined && cloud !== text) || deleted) conflicts.push({ type: 'note', key, cloud, incoming: text, deleted });
    }
    for (const wish of incoming.wishes) {
      const cloud = snapshot.wishes.find(({ id }) => id === wish.id);
      const deleted = !cloud && revisionOf(snapshot.revisions.wishes, wish.id) > 0;
      if ((cloud && (cloud.text !== wish.text || cloud.done !== wish.done)) || deleted) conflicts.push({ type: 'wish', key: wish.id, cloud, incoming: wish, deleted });
    }
    const choices = await chooseImportConflicts(conflicts);
    if (!choices || !authenticated) return;
    const operations = planImport(incoming, snapshot, choices);
    if (!operations.length) { showStatus('tools', '没有新内容需要放回；相同内容已略过。'); return; }
    const requestGeneration = generation;
    let completed = 0;
    let failure: unknown = null;
    for (let offset = 0; offset < operations.length && !failure; offset += 4) {
      const batch = operations.slice(offset, offset + 4);
      showStatus('tools', `正在放回手账：${completed} / ${operations.length}`);
      const results = await Promise.all(batch.map(async (operation) => {
        const path = operation.type === 'note' ? `/api/notes/${encodeURIComponent(operation.key)}` : wishPath(operation.wish.id);
        const body = operation.type === 'note'
          ? { expectedVersion: operation.expectedVersion, text: operation.text }
          : { expectedVersion: operation.expectedVersion, text: operation.wish.text, done: operation.wish.done };
        try { return { ok: true as const, value: validateCloud(await api<CloudNotebook>(path, { method: 'PUT', body: JSON.stringify(body) })) }; }
        catch (error) { return { ok: false as const, error }; }
      }));
      if (!authenticated || requestGeneration !== generation) return;
      for (const result of results) {
        if (result.ok) { book = mergeCloud(book, result.value); completed++; }
        else if (!failure) failure = result.error;
      }
      render(); dispatchNotebookChanged();
    }
    if (failure) {
      reportError('tools', failure);
      const reason = failure instanceof ApiError && failure.status === 409 ? '云端有记录刚被改过，已停止；刷新后可再导入。' : '连接中断，已停止。';
      showStatus('tools', `已放回 ${completed} 条，${reason} 再次导入会略过相同内容。`);
      return;
    }
    showStatus('tools', `已放回 ${completed} 条。相同内容已略过。`);
  } finally {
    importing = false;
    $('[data-notebook-import]').removeAttribute('aria-disabled');
    $('[data-notebook-local-import]').removeAttribute('aria-disabled');
  }
}

$('[data-notebook-import]').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 8_000_000) throw new Error('Backup too large');
    await importNotebook(parseNotebook(await file.text()));
  } catch {
    showStatus('tools', '这份文件不是可用的手账备份，原内容没有改动。');
  } finally { fileInput.value = ''; }
});

$('[data-notebook-local-import]').addEventListener('click', () => {
  if (!authenticated || !ready) return;
  try {
    const raw = localStorage.getItem(notebookKey);
    if (raw === null) { showStatus('tools', '这台设备里还没有旧手账。'); return; }
    void importNotebook(parseNotebook(raw));
  } catch {
    showStatus('tools', '这台设备里的旧手账无法读取；原数据没有改动。');
  }
});

onSessionChange(setSession);
void getSession().catch(() => { /* Unknown sessions remain in the guest view until a later session event. */ });

window.setInterval(() => { if (document.visibilityState === 'visible' && authenticated) void refreshCloud(); }, 10_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && authenticated) void refreshCloud();
});

setVisibility();
render();
