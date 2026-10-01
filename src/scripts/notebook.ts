import { dotted, relationshipStartDate } from '../lib/anniversary';
import { emptyNotebook, mergeNotebooks, notebookKey, parseNotebook, type Notebook } from '../lib/notebook';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const form = $<HTMLFormElement>('[data-note-form]');
const textarea = $<HTMLTextAreaElement>('#day-note');
const status = $('[data-notebook-status]');
const undoButton = $<HTMLButtonElement>('[data-notebook-undo]');
const noteUndoButton = $<HTMLButtonElement>('[data-note-undo]');
let book = emptyNotebook();
let date = relationshipStartDate;
let editing = false;
let original = '';
let undo: ((latest: Notebook) => void) | null = null;

function read(): Notebook {
  const raw = localStorage.getItem(notebookKey);
  return raw === null ? emptyNotebook() : parseNotebook(raw);
}
/** One live region at a time: both are role="status" and would announce the same string twice. */
function message(text: string) {
  const noteStatus = $('[data-note-status]');
  if (editing) { noteStatus.textContent = text; status.textContent = ''; }
  else { status.textContent = text; noteStatus.textContent = ''; }
}

/** Read again at commit time so other tabs' unrelated writing is preserved. */
function commit(change: (latest: Notebook) => void, success: string): boolean {
  try {
    const latest = read();
    change(latest);
    const validated = parseNotebook(JSON.stringify(latest));
    localStorage.setItem(notebookKey, JSON.stringify(validated));
    book = validated;
    message(success);
    document.dispatchEvent(new CustomEvent('notebook:changed', { detail: Object.keys(book.notes) }));
    render();
    return true;
  } catch (error) {
    message(error instanceof Error && error.message === 'Note changed' ? '这一天在另一个页面改过了。请先取消，查看最新内容再写。' : '没能收好。可能是浏览器不允许保存，或已有记录无法读取；输入还在，请先复制留存。');
    return false;
  }
}

function renderNote() {
  $('[data-note-date]').textContent = dotted(date);
  $('[data-note-text]').textContent = book.notes[date] || '这一天还空着。想记的时候，再写。';
  $('[data-note-edit-label]').textContent = book.notes[date] ? '改一改' : '写一句';
}
function button(text: string, action: () => void) {
  const element = document.createElement('button');
  element.type = 'button'; element.className = 'text-button'; element.textContent = text;
  element.addEventListener('click', action);
  return element;
}
function render() {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedWish = focused?.dataset.wishId;
  const focusedAction = focused?.dataset.wishAction;
  renderNote();
  $('[data-notes-count]').textContent = String(Object.keys(book.notes).length);
  const index = $('[data-notes-list]'); index.replaceChildren();
  for (const key of Object.keys(book.notes).sort().reverse()) {
    const entry = button(`${dotted(key)}　${[...book.notes[key]].slice(0, 36).join('')}`, () => {
      if (editing) { message('先收好或取消正在写的这一句。'); return; }
      date = key; renderNote(); $('[data-note-date]').scrollIntoView({ block: 'center' });
    });
    entry.classList.add('note-index-entry'); index.append(entry);
  }
  const list = $('[data-wish-list]'); list.replaceChildren();
  for (const wish of book.wishes) {
    const item = document.createElement('li'); item.classList.toggle('is-done', wish.done);
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = wish.done;
    checkbox.dataset.wishId = wish.id; checkbox.dataset.wishAction = 'toggle';
    const text = document.createElement('span'); text.textContent = wish.text;
    label.append(checkbox, text);
    checkbox.addEventListener('change', () => {
      const done = checkbox.checked;
      if (!commit((latest) => { const target = latest.wishes.find(({ id }) => id === wish.id); if (target) target.done = done; }, done ? '这一件，做到了。' : '放回待做的清单。')) checkbox.checked = !done;
    });
    const remove = button('移除', () => {
      let removed = wish;
      const position = book.wishes.findIndex(({ id }) => id === wish.id);
      if (commit((latest) => { removed = latest.wishes.find(({ id }) => id === wish.id) ?? wish; latest.wishes = latest.wishes.filter(({ id }) => id !== wish.id); }, '已移除，可以撤销。')) {
        undo = (latest) => { if (!latest.wishes.some(({ id }) => id === removed.id)) latest.wishes.splice(position, 0, removed); };
        undoButton.hidden = false;
        noteUndoButton.hidden = true;
      }
    });
    remove.setAttribute('aria-label', `移除：${wish.text}`);
    remove.dataset.wishId = wish.id; remove.dataset.wishAction = 'remove';
    item.append(label, remove); list.append(item);
  }
  $('[data-wish-empty]').hidden = book.wishes.length > 0;
  $('[data-wish-count]').textContent = book.wishes.length ? `${book.wishes.filter(({ done }) => done).length} / ${book.wishes.length} 件已完成` : '还空着';
  $('[data-wish-result]').textContent = '';
  if (focusedWish) {
    const next = list.querySelector<HTMLElement>(`[data-wish-id="${focusedWish}"][data-wish-action="${focusedAction}"]`);
    (next ?? $('#wish-text')).focus({ preventScroll: true });
  }
}

function finishEditing() {
  editing = false; form.hidden = true;
  textarea.setCustomValidity('');
  $('[data-note-edit]').hidden = false; $('[data-note-text]').hidden = false;
  renderNote();
}
document.addEventListener('journal:date', (event) => {
  if (editing) return;
  date = (event as CustomEvent<string>).detail;
  renderNote();
});
document.addEventListener('journal:notes-request', () => {
  document.dispatchEvent(new CustomEvent('notebook:changed', { detail: Object.keys(book.notes) }));
});
$('[data-note-edit]').addEventListener('click', () => {
  editing = true; original = book.notes[date] ?? ''; textarea.value = original;
  // Opened fresh every time, so no earlier "write something first" message may linger:
  // a stale custom validity would block submit before the handler ever runs.
  textarea.setCustomValidity('');
  form.hidden = false; $('[data-note-edit]').hidden = true; $('[data-note-text]').hidden = true;
  $('[data-note-delete]').hidden = !original; textarea.focus();
});
$('[data-note-cancel]').addEventListener('click', () => { finishEditing(); $('[data-note-edit]').focus(); });
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = textarea.value.trim();
  if (!text) { textarea.setCustomValidity('写一点内容再收好。'); textarea.reportValidity(); return; }
  if (commit((latest) => {
    if ((latest.notes[date] ?? '') !== original) throw new Error('Note changed');
    latest.notes[date] = text;
  }, '收好了，留在这台设备。')) {
    // This day has writing again, so a pending "removed that note" undo no longer applies.
    undo = null; undoButton.hidden = true; noteUndoButton.hidden = true;
    finishEditing(); $('[data-note-edit]').focus();
  }
});
textarea.addEventListener('input', () => textarea.setCustomValidity(''));
$('[data-note-delete]').addEventListener('click', () => {
  const key = date; const previous = original;
  if (commit((latest) => { if ((latest.notes[key] ?? '') !== original) throw new Error('Note changed'); delete latest.notes[key]; }, '已移除，可以撤销。')) {
    undo = (latest) => { if (latest.notes[key]) throw new Error('Note changed'); latest.notes[key] = previous; };
    noteUndoButton.hidden = false; undoButton.hidden = true; finishEditing(); $('[data-note-edit]').focus();
  }
});
$<HTMLFormElement>('[data-wish-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#wish-text'); const text = input.value.trim();
  if (!text) { input.setCustomValidity('写下一件小事再记上。'); input.reportValidity(); return; }
  const id = crypto.randomUUID();
  if (commit((latest) => { latest.wishes.push({ id, text, done: false }); }, '记上了。')) { input.value = ''; input.focus(); }
});
$<HTMLInputElement>('#wish-text').addEventListener('input', (event) => (event.target as HTMLInputElement).setCustomValidity(''));
$('[data-wish-draw]').addEventListener('click', () => {
  const candidates = book.wishes.filter(({ done }) => !done);
  $('[data-wish-result]').textContent = candidates.length ? `这次就选：${candidates[Math.floor(Math.random() * candidates.length)].text}` : book.wishes.length ? '都做完了。再添一件？' : '先在清单里写一件，再来抽。';
});
for (const trigger of [undoButton, noteUndoButton]) trigger.addEventListener('click', () => {
  const done = Boolean(undo && commit(undo, '已放回。'));
  if (done) { undo = null; undoButton.hidden = true; noteUndoButton.hidden = true; }
  if (trigger === noteUndoButton) {
    // Either outcome belongs next to the note, not only in the far-away backup status.
    $('[data-note-status]').textContent = done ? '已放回。' : status.textContent;
    if (done) $('[data-note-edit]').focus();
  } else if (done) $('#wish-text').focus();
});
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('[data-notebook-export]').addEventListener('click', () => {
  try { book = read(); download(JSON.stringify(book, null, 2), 'loveuhqq-notebook.json'); message('手账已导出。放回备份时，同一天已有的记录会保留。'); }
  catch { message('无法读取记录，暂时没有导出。原记录没有改动。'); }
});
const fileInput = $<HTMLInputElement>('[data-notebook-file]');
$('[data-notebook-import]').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  try {
    if (file.size > 8_000_000) throw new Error('Too large');
    const incoming = parseNotebook(await file.text());
    commit((latest) => Object.assign(latest, mergeNotebooks(latest, incoming)), '已放回备份。同一天已有的记录保留，清单不会重复添加。');
  } catch { message('这份文件不是可用的手账备份。原来的记录没有改动。'); }
  fileInput.value = '';
});
window.addEventListener('storage', (event) => {
  if (event.key !== notebookKey && event.key !== null) return;
  try { book = read(); render(); document.dispatchEvent(new CustomEvent('notebook:changed', { detail: Object.keys(book.notes) })); }
  catch { message('另一个页面的记录无法读取，请先保留当前输入。'); }
});
try { book = read(); }
catch { message('已有记录无法读取，或浏览器不允许保存。请保留原备份；写下的内容暂时不能收好。'); }
render();
