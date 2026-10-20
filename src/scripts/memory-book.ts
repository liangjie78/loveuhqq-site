import { api, ApiError } from '../lib/cloud-notebook';
import { getSession, onSessionChange, publishSession, refreshSession } from '../lib/session';
import { parsePhotoManifest, photoUrl, type PrivatePhoto } from '../lib/photos';
import type { CloudNotebook, Wish } from '../lib/notebook';
import { audioMaxBytes, audioMaxSeconds, memoryApiRoot, memoryAudioUrl, type MemoryBootstrap, type MemoryStory, type MemoryLetter, type MemoryPlace, type StoryInput, type LetterInput, type PartInput } from '../lib/memory-book';
import { createSharedDesktop } from './shared-desktop';
import { buildMemoryExport } from '../lib/memory-export';

const $ = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document) => parent.querySelector<T>(selector)!;
const all = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document) => [...parent.querySelectorAll<T>(selector)];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const button = (text: string, action: () => void, className = 'text-button') => { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };
const status = $('[data-memory-status]');
const exportButton = $<HTMLButtonElement>('[data-memory-export]');
const exportStatus = $('[data-memory-export-status]');
const privateRoot = $('[data-memory-private]');
const storyForm = $<HTMLFormElement>('[data-story-form]');
const letterForm = $<HTMLFormElement>('[data-letter-form]');
const placeForm = $<HTMLFormElement>('[data-place-form]');
const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const value = (form: HTMLFormElement, name: string) => field(form, name).value;
const set = (form: HTMLFormElement, name: string, content: string) => { field(form, name).value = content; };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const empty = (): MemoryBootstrap => ({ member: null, members: [], stories: [], letters: [], places: [], wishPlans: [] });
let book = empty();
let authenticated = false;
let generation = 0;
let photos: PrivatePhoto[] = [];
let notebook: CloudNotebook | null = null;
let selectedStory: string | null = new URLSearchParams(location.search).get('story');
let selectedLetter: string | null = null;
let storyEditVersion = 0;
let letterEditVersion = 0;
let placeEditVersion = 0;
let renderedStory = '';
let renderedLetter = '';
let request: AbortController | null = null;
let exportRequest: AbortController | null = null;
let exportTimeout: ReturnType<typeof setTimeout> | null = null;
let exportUrl: string | null = null;
let exportRelease: ReturnType<typeof setTimeout> | null = null;
const mutations = new Set<AbortController>();
const cleanups = new Set<() => void>();
const recordingCleanups = new WeakMap<HTMLElement, () => void>();
let filter = new URLSearchParams(location.search);
let selectedPlaceYear = '';
let loading: Promise<void> | null = null;
let lastWriteConflict = false;
let switching = false;
let remotePending = false;
let loadedOnce = false;
const renderedLists = new Map<HTMLElement, string>();
const discardIdentityMessage = '还没保存。换身份后，这份内容不会留下。要继续吗？';
const desk = createSharedDesktop($('[data-shared-desktop]'), { onOpenStory: openStory, onUnauthorized: unauthorized });

function report(error: unknown) {
  if (error instanceof ApiError && error.status === 401) { unauthorized(); return; }
  status.textContent = error instanceof ApiError ? error.message : '暂时没能连接。输入还在，可以重新试一次。';
  $('[data-memory-retry]').hidden = false;
}
function unauthorized() { publishSession({ authenticated: false, configured: true }); }
function releaseExportUrl() {
  if (exportRelease !== null) clearTimeout(exportRelease);
  exportRelease = null;
  if (exportUrl !== null) URL.revokeObjectURL(exportUrl);
  exportUrl = null;
}
function cancelExport() {
  exportRequest?.abort(); exportRequest = null;
  if (exportTimeout !== null) clearTimeout(exportTimeout);
  exportTimeout = null;
  releaseExportUrl();
  exportButton.disabled = false;
  exportStatus.textContent = '';
}
async function exportVisibleRecords() {
  if (exportRequest || !authenticated || switching || !book.member) return;
  cancelExport();
  const controller = new AbortController(); exportRequest = controller;
  const token = generation;
  const memberId = book.member.id;
  const current = () => exportRequest === controller && authenticated && !switching && token === generation && book.member?.id === memberId;
  const active = () => current() && !controller.signal.aborted;
  exportButton.disabled = true;
  exportStatus.textContent = '正在整理已保存的记录…';
  exportTimeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const notes = await api<CloudNotebook>('/api/notebook', { signal: controller.signal });
    if (!active()) return;
    const fresh = await api<MemoryBootstrap>(`${memoryApiRoot}/bootstrap`, { signal: controller.signal });
    if (!active()) return;
    if (fresh.member?.id !== memberId) {
      cancelExport(); exportStatus.textContent = '署名已变化，请确认后重新导出。'; void load(); return;
    }
    const session = await refreshSession();
    if (!active() || fresh.member?.id !== memberId || !session.authenticated) return;
    const exportedAt = new Date().toISOString();
    const json = JSON.stringify(buildMemoryExport(fresh, notes.wishes, exportedAt), null, 2);
    if (!active() || fresh.member?.id !== memberId) return;
    exportUrl = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = exportUrl;
    link.download = `loveuhqq-visible-records-${exportedAt.replace(/:/g, '-')}.json`;
    document.body.append(link); link.click(); link.remove();
    exportRelease = setTimeout(releaseExportUrl, 1_000);
    exportStatus.textContent = '已发起下载。';
  } catch (error) {
    if (!current()) return;
    if (error instanceof ApiError && error.status === 401) { unauthorized(); return; }
    exportStatus.textContent = '暂时没能导出，请再试一次。';
  } finally {
    if (exportRequest === controller) {
      if (book.member?.id !== memberId) {
        exportStatus.textContent = '署名已变化，请确认后重新导出。'; void load();
      } else if (controller.signal.aborted) exportStatus.textContent = '暂时没能导出，请再试一次。';
      if (exportTimeout !== null) clearTimeout(exportTimeout);
      exportTimeout = null; exportRequest = null; exportButton.disabled = false;
    }
  }
}
function resetMedia() { cleanups.forEach(clean => clean()); cleanups.clear(); all<HTMLMediaElement>('audio, video', privateRoot).forEach(media => { media.pause(); media.removeAttribute('src'); media.load(); }); }
function disposeRecordings(parent: HTMLElement) { all<HTMLElement>('.memory-recording', parent).forEach(node => { const clean = recordingCleanups.get(node); clean?.(); if (clean) cleanups.delete(clean); }); }
function clearSelectors() {
  $<HTMLSelectElement>('[data-place-story]').replaceChildren(new Option('暂不关联', ''));
  $<HTMLSelectElement>('[data-place-wish]').replaceChildren(new Option('暂不关联', ''));
  const year = $<HTMLSelectElement>('[data-place-year]');
  year.replaceChildren(new Option('所有年份', '')); delete year.dataset.years; selectedPlaceYear = '';
  all<HTMLOptionElement>('option', field(letterForm, 'recipientId')).forEach(option => { option.textContent = option.value === 'one' ? '第一位' : '第二位'; });
}
function discardShownContent() {
  cancelExport();
  renderedStory = renderedLetter = '';
  generation++;
  request?.abort(); request = null;
  mutations.forEach(controller => controller.abort()); mutations.clear();
  loading = null;
  stopScreening(); screening = []; screeningIndex = 0;
  resetMedia(); desk.clear();
  book = empty(); photos = []; notebook = null; selectedLetter = null; loadedOnce = false;
  all<HTMLFormElement>('form', privateRoot).forEach(form => { form.reset(); delete form.dataset.dirty; });
  for (const selector of ['[data-story-list]', '[data-story-detail]', '[data-story-photos]', '[data-story-wishes]', '[data-memory-wishes]', '[data-letter-list]', '[data-letter-detail]', '[data-screening-options]', '[data-screening-order]', '[data-place-list]']) $(selector).replaceChildren();
  $('[data-screening-stage]').replaceChildren(el('p', '选几页真实的内容，再开始播放。'));
  $('[data-screening-progress]').textContent = '';
  $<HTMLInputElement>('[data-story-search]').value = '';
  clearSelectors();
  $('[data-story-filter-hint]').textContent = '';
  all<HTMLImageElement>('img', privateRoot).forEach(image => image.removeAttribute('src'));
  renderedLists.clear();
  storyForm.hidden = letterForm.hidden = placeForm.hidden = true;
  $('[data-story-detail]').hidden = $('[data-letter-detail]').hidden = true;
  $('[data-memory-identity]').hidden = true;
  $('[data-memory-identity-unselected]').hidden = true;
  all<HTMLElement>('[data-section-locked]').forEach(node => { node.hidden = false; });
  all<HTMLElement>('[data-section-private]').forEach(node => { node.hidden = true; });
  all<HTMLElement>('[data-needs-member]').forEach(node => { node.hidden = true; });
}
function clearPrivate() {
  discardShownContent();
  $('[data-memory-locked]').hidden = false;
  status.textContent = '';
}
async function load() {
  if (!authenticated || switching) return;
  if (loading) return loading;
  const token = generation;
  const controller = new AbortController(); request = controller;
  // The ten-second refresh runs while someone may be reading; only the first load
  // announces itself, and it stops as soon as anything is on screen.
  if (!loadedOnce) status.textContent = '正在翻开回忆册…';
  loading = (async () => {
    try {
      const next = await api<MemoryBootstrap>(`${memoryApiRoot}/bootstrap`, { signal: controller.signal });
      if (token !== generation || !authenticated) return;
      if (book.member && book.member.id !== next.member?.id) {
        cancelExport();
        if (hasUnsavedChanges() && !window.confirm(discardIdentityMessage)) {
          await api<MemoryBootstrap>(`${memoryApiRoot}/identity`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ id: book.member.id }) });
          if (token !== generation || !authenticated) return;
          postMemberChanged();
          status.textContent = '';
          return;
        }
        if (token !== generation || !authenticated) return;
        resetMedia(); stopScreening(); screening = []; screeningIndex = 0; desk.clear();
        all<HTMLFormElement>('form', privateRoot).forEach(form => { form.reset(); delete form.dataset.dirty; });
        clearSelectors();
        all<HTMLElement>('[data-story-detail], [data-letter-detail], [data-screening-stage], [data-screening-order]', privateRoot).forEach(node => node.replaceChildren());
        storyForm.hidden = letterForm.hidden = placeForm.hidden = true;
      }
      book = next;
      if (next.member) {
        const [manifest, notes] = await Promise.all([api('/api/photos', { signal: controller.signal }), api<CloudNotebook>('/api/notebook', { signal: controller.signal })]);
        if (token !== generation || !authenticated) return;
        photos = parsePhotoManifest(manifest).photos; notebook = notes;
      } else { photos = []; notebook = null; }
      render(); status.textContent = ''; $('[data-memory-retry]').hidden = true;
      loadedOnce = true;
    } catch (error) { if (token === generation && !controller.signal.aborted) report(error); }
    finally { if (token === generation) { request = null; loading = null; } }
  })();
  return loading;
}
async function write(path: string, method: string, body?: unknown): Promise<boolean> {
  lastWriteConflict = false;
  const token = generation;
  const controller = new AbortController(); mutations.add(controller);
  try {
    const next = await api<MemoryBootstrap>(`${memoryApiRoot}${path}`, { method, signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (token !== generation || !authenticated) return false;
    book = next; render(); status.textContent = '收好了。'; return true;
  } catch (error) { if (token === generation && !controller.signal.aborted) { lastWriteConflict = error instanceof ApiError && error.status === 409; report(error); } return false; }
  finally { mutations.delete(controller); }
}
async function submit(form: HTMLFormElement, task: () => Promise<void>) {
  if (form.dataset.busy) return;
  form.dataset.busy = 'yes';
  all<HTMLButtonElement>('button', form).forEach(control => { control.disabled = true; });
  let feedback = form.querySelector<HTMLElement>('.memory-form-feedback'); if (!feedback) { feedback = el('p', '', 'memory-form-feedback'); feedback.setAttribute('role', 'status'); form.append(feedback); }
  feedback.textContent = '正在收好…';
  try { await task(); feedback.textContent = status.textContent || '这次操作已完成。'; } finally { delete form.dataset.busy; all<HTMLButtonElement>('button', form).forEach(control => { control.disabled = false; }); }
}
function memberName(id: string) { return id === 'one' ? '男生' : '女生'; }
function conflictReview(form: HTMLFormElement, latest: () => { text: string; accept: () => void }) {
  if (!lastWriteConflict || form.querySelector('[data-conflict-review]')) return;
  const section = el('section'); section.dataset.conflictReview = '';
  section.append(el('p', '服务端已有更新，当前输入还在。先查看最新内容，再决定是否用当前输入替换。'));
  section.append(button('查看最新内容', () => { void (async () => {
    await load(); if (!form.isConnected || !book.member) return;
    const current = latest(); section.replaceChildren(el('p', '手账里的最新内容：'), el('p', current.text, 'memory-prose'), button('确认保留当前输入，准备重新保存', () => { current.accept(); section.remove(); status.textContent = '当前输入已保留，检查后再按保存。'; }));
  })(); })); form.append(section);
}
function hasUnsavedChanges(): boolean {
  if (!storyForm.hidden && storyForm.dataset.dirty === 'yes') return true;
  if (!letterForm.hidden && letterForm.dataset.dirty === 'yes') return true;
  if (!placeForm.hidden && placeForm.dataset.dirty === 'yes') return true;
  if (privateRoot.querySelector('form[data-dirty="yes"]')) return true;
  if (privateRoot.querySelector('[data-recording-pending="yes"]')) return true;
  const note = privateRoot.querySelector<HTMLInputElement>('input[aria-label="便签或票根内容"]');
  return !!note?.value.trim();
}
async function selectIdentity(id: string) {
  if (switching || (id !== 'one' && id !== 'two') || book.member?.id === id) return;
  switching = true;
  cancelExport();
  let failed = false;
  const controller = new AbortController();
  try {
    const elsewhere = await askOtherDrafts();
    if (!authenticated || book.member?.id === id) return;
    if ((hasUnsavedChanges() || elsewhere) && !window.confirm(discardIdentityMessage)) return;
    discardShownContent();
    privateRoot.hidden = false;
    $('[data-memory-locked]').hidden = true;
    status.textContent = '正在选择…';
    const token = generation;
    mutations.add(controller);
    const next = await api<MemoryBootstrap>(`${memoryApiRoot}/identity`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ id }) });
    if (token !== generation || !authenticated) return;
    postMemberChanged();
    book = next;
    if (next.member) {
      const [manifest, notes] = await Promise.all([api('/api/photos', { signal: controller.signal }), api<CloudNotebook>('/api/notebook', { signal: controller.signal })]);
      if (token !== generation || !authenticated) return;
      photos = parsePhotoManifest(manifest).photos; notebook = notes;
    } else { photos = []; notebook = null; }
    render();
    status.textContent = '';
    $('[data-memory-retry]').hidden = true;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    report(error);
    failed = true;
  } finally {
    mutations.delete(controller);
    switching = false;
    const pending = remotePending;
    remotePending = false;
    if ((failed || pending) && authenticated) void load();
  }
}
function render() {
  $('[data-memory-locked]').hidden = true;
  loadedOnce = true;
  const member = book.member;
  const identityBar = $('[data-memory-identity]');
  const unselectedCard = $('[data-memory-identity-unselected]');
  if (member) {
    const otherId = member.id === 'one' ? 'two' : 'one';
    $('[data-current-identity]').textContent = memberName(member.id);
    const switchBtn = $<HTMLButtonElement>('[data-switch-identity]');
    switchBtn.dataset.switchTo = otherId;
    switchBtn.textContent = `换成${memberName(otherId)}`;
    identityBar.hidden = false;
    unselectedCard.hidden = true;
    all<HTMLElement>('[data-section-locked]').forEach(node => { node.hidden = true; });
    all<HTMLElement>('[data-section-private]').forEach(node => { node.hidden = false; });
    all<HTMLElement>('[data-needs-member]').forEach(node => { node.hidden = false; });
  } else {
    identityBar.hidden = true;
    unselectedCard.hidden = false;
    resetMedia(); stopScreening(); screening = []; screeningIndex = 0; desk.clear();
    all<HTMLElement>('[data-section-locked]').forEach(node => { node.hidden = false; });
    all<HTMLElement>('[data-section-private]').forEach(node => { node.hidden = true; });
    all<HTMLElement>('[data-needs-member]').forEach(node => { node.hidden = true; });
  }
  all<HTMLOptionElement>('option', field(letterForm, 'recipientId')).forEach(option => { option.textContent = memberName(option.value); });
  if (!member) {
    renderedLists.clear();
    all<HTMLElement>('[data-story-list], [data-story-detail], [data-letter-list], [data-letter-detail], [data-place-list], [data-screening-options], [data-screening-order]').forEach(node => node.replaceChildren());
    storyForm.hidden = letterForm.hidden = placeForm.hidden = true; return;
  }
  renderStoryList(); renderStory(); renderWishes(); renderLetters(); renderLetter(); renderScreeningOptions(); renderPlaces();
  desk.update({ member, stories: book.stories, photos });
  jumpToHash();
}
let pendingHash = location.hash.slice(1);
function jumpToHash() {
  if (!pendingHash) return;
  let target: HTMLElement | null = null;
  try { target = document.getElementById(decodeURIComponent(pendingHash)); } catch { /* A malformed hash is simply ignored. */ }
  pendingHash = '';
  if (target && !target.hidden) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
function matchesFilter(story: MemoryStory) {
  const search = $<HTMLInputElement>('[data-story-search]').value.trim().toLocaleLowerCase();
  return (!filter.get('date') || story.date === filter.get('date')) && (!filter.get('photo') || story.photoIds.includes(filter.get('photo')!)) && (!filter.get('wish') || story.wishIds.includes(filter.get('wish')!) || book.wishPlans.some(plan => plan.id === filter.get('wish') && plan.storyId === story.id))
    && (!search || `${story.title} ${story.date} ${story.text} ${story.parts.map(part => `${part.text ?? ''} ${part.reply ?? ''}`).join(' ')}`.toLocaleLowerCase().includes(search));
}
// The refresh runs every ten seconds while the page is visible. Rebuilding a list
// with identical content would drop keyboard focus, so skip when nothing changed.
function renderList(target: HTMLElement, key: string, build: () => void) {
  if (renderedLists.get(target) === key) return;
  renderedLists.set(target, key);
  build();
}
function renderStoryList() {
  const stories = book.stories.filter(matchesFilter).sort((a, b) => b.date.localeCompare(a.date));
  const list = $('[data-story-list]');
  $('[data-story-filter-hint]').textContent = filter.has('date') || filter.has('photo') || filter.has('wish') ? '正在翻看这个入口关联的故事。也可以看全部，或为它新写一篇。' : '';
  // Only what a card shows: a version bump alone does not change the list.
  const key = JSON.stringify(stories.map(story => [story.id, story.date, story.title, story.photoIds.length, story.parts.filter(part => part.submitted).length]).concat([book.stories.length]));
  renderList(list, key, () => {
    list.replaceChildren();
    if (!stories.length) list.append(el('p', book.stories.length ? '这里还没找到相符的故事。' : '还没有故事。第一篇，留给我们自己写。'));
    stories.forEach(story => { const card = button('', () => openStory(story.id), 'memory-card'); card.append(el('span', story.date, 'memory-meta'), el('h3', story.title), el('p', `${story.photoIds.length} 张照片 · ${story.parts.filter(part => part.submitted).length} 份已提交的版本`)); list.append(card); });
  });
}
function openStory(id: string) {
  selectedStory = id; storyForm.hidden = true; renderStory();
  const url = new URL(location.href); url.searchParams.set('story', id); history.replaceState(null, '', url);
  $('[data-story-detail]').scrollIntoView({ behavior: 'auto', block: 'start' });
}
function imageFor(photo: PrivatePhoto, size: 'thumb' | 'large' = 'large') { const image = el('img'); image.src = photoUrl(photo.id, size); image.alt = photo.title; image.width = photo.width; image.height = photo.height; image.loading = 'lazy'; return image; }
function renderStory() {
  const detail = $('[data-story-detail]');
  const story = book.stories.find(item => item.id === selectedStory);
  detail.hidden = !story;
  if (!story) { renderedStory = ''; detail.replaceChildren(); return; }
  const snapshot = JSON.stringify([story, book.members, photos, notebook?.wishes, book.wishPlans, book.places]);
  if (detail.dataset.storyId === story.id && (renderedStory === snapshot || [...detail.querySelectorAll('audio')].some(audio => !audio.paused))) return;
  // Keep an active personal draft and its recording when metadata refreshes.
  const active = detail.querySelector<HTMLFormElement>('form[data-part-form]');
  if (active && active.dataset.storyId === story.id && active.dataset.dirty === 'yes') return;
  if (detail.dataset.storyId === story.id && detail.querySelector('form[data-dirty="yes"]')) return;
  detail.dataset.storyId = story.id;
  renderedStory = snapshot;
  disposeRecordings(detail); detail.replaceChildren(); detail.dataset.layout = story.layout;
  detail.append(el('p', story.date, 'memory-meta'), el('h3', story.title), el('p', story.text, 'memory-prose'));
  detail.append(button('改这一页', () => openStoryForm(story)));
  const wall = el('div', '', 'memory-story-photos'); story.photoIds.forEach(id => { const photo = photos.find(item => item.id === id); if (photo) wall.append(imageFor(photo)); }); detail.append(wall);
  const parts = el('div', '', 'memory-parts');
  for (const member of book.members) {
    const part = story.parts.find(item => item.memberId === member.id);
    const section = el('section', '', 'memory-part'); section.append(el('h4', `${member.name} 的这一页`));
    if (part?.text !== undefined) { section.append(el('p', part.text || '还没有写下正文。', 'memory-prose')); if (part.reply) section.append(el('p', `回应：${part.reply}`, 'memory-prose')); (part.audioIds ?? []).forEach(id => section.append(audioCard(id))); }
    else section.append(el('p', part?.submitted ? '已经写好，等两个人一起打开。' : '还没提交自己的版本。'));
    if (member.id === book.member?.id) {
      const edit = button('写自己的版本', () => {
        edit.hidden = true;
        const form = el('form', '', 'memory-form'); form.dataset.partForm = ''; form.dataset.storyId = story.id;
        const text = labeledTextarea('我记得的这一页', part?.text ?? ''); const reply = labeledTextarea('想回应对方的话', part?.reply ?? '', 3000);
        const submitted = el('input'); submitted.type = 'checkbox'; submitted.checked = part?.submitted ?? false;
        const label = el('label', '', 'memory-check'); label.append(submitted, el('span', '我写好了，可以提交（两人揭晓模式会等另一份提交）'));
        let audioIds = [...(part?.audioIds ?? [])]; let partEditVersion = part?.version ?? 0;
        text.input.maxLength = 10000; reply.input.maxLength = 3000;
        form.append(text.label, reply.label, label, recorder({ storyId: story.id }, id => { audioIds.push(id); form.dataset.dirty = 'yes'; }));
        const save = el('button', '收好自己的版本', 'pencil-button'); save.type = 'submit';
        form.append(save, button('先不改', () => { disposeRecordings(form); form.remove(); edit.hidden = false; }));
        form.addEventListener('input', () => { form.dataset.dirty = 'yes'; });
        form.addEventListener('submit', event => { event.preventDefault(); void submit(form, async () => { const body: PartInput = { expectedVersion: partEditVersion, text: text.input.value, reply: reply.input.value, submitted: submitted.checked, audioIds }; if (await write(`/stories/${story.id}/part`, 'PUT', body)) { delete form.dataset.dirty; renderStory(); } else conflictReview(form, () => { const latest = book.stories.find(item => item.id === story.id)?.parts.find(item => item.memberId === member.id); return { text: `${latest?.text ?? ''}\n${latest?.reply ?? ''}`, accept() { partEditVersion = latest?.version ?? 0; } }; }); }); });
        section.append(form); text.input.focus();
      }); section.append(edit);
    }
    parts.append(section);
  }
  detail.append(parts);
  if (story.revealTogether) detail.append(el('p', story.openedAt ? '两个人的版本已经一起打开。' : '两个人都提交后，这一页才会揭晓。提交前可以继续改自己的版本。', 'memory-meta'));
  const wishes = (notebook?.wishes ?? []).filter(wish => story.wishIds.includes(wish.id) || book.wishPlans.some(plan => plan.id === wish.id && plan.storyId === story.id));
  for (const wish of wishes) {
    const plan = book.wishPlans.find(item => item.id === wish.id);
    const card = el('section', '', 'memory-wish-plan');
    card.append(el('h4', `从往后走到后来：${wish.text}`), el('p', `${wish.done ? '已经一起做过' : '还想一起做'} · ${plan?.plannedDate ?? '还没定日期'}`, 'memory-meta'));
    const edit = button('安排这件事', () => {
      edit.hidden = true;
      const form = wishPlan(wish, story);
      form.append(button('先不改', () => { form.remove(); edit.hidden = false; })); card.append(form);
    });
    card.append(edit); detail.append(card);
  }
  const locations = book.places.filter(place => place.storyIds.includes(story.id));
  if (locations.length) { const area = el('section'); area.append(el('h4', '这一页里的地点')); locations.forEach(place => area.append(button(`${place.name} · 查看地点`, () => { selectedPlaceYear = String(place.year); renderPlaces(); $('#places').scrollIntoView({ block: 'start' }); document.querySelector<HTMLElement>(`[data-place-id="${CSS.escape(place.id)}"]`)?.focus({ preventScroll: true }); }))); detail.append(area); }
}
function labeledTextarea(text: string, initial: string, maxLength = 10000) { const label = el('label', text); const input = el('textarea'); input.rows = 5; input.maxLength = maxLength; input.value = initial; label.append(input); return { label, input }; }
function openStoryForm(story?: MemoryStory) {
  all<HTMLElement>('[data-conflict-review]', storyForm).forEach(node => node.remove());
  storyForm.reset(); delete storyForm.dataset.dirty; storyEditVersion = story?.version ?? 0;
  set(storyForm, 'id', story?.id ?? crypto.randomUUID()); set(storyForm, 'title', story?.title ?? ''); set(storyForm, 'date', story?.date ?? filter.get('date') ?? today()); set(storyForm, 'text', story?.text ?? ''); set(storyForm, 'layout', story?.layout ?? 'journal');
  (field(storyForm, 'revealTogether') as HTMLInputElement).checked = story?.revealTogether ?? false;
  $('[data-story-form-title]').textContent = story ? '改这一页' : '写一篇故事';
  const picker = $('[data-story-photos]'); picker.replaceChildren();
  for (const photo of photos) { const label = el('label', '', 'memory-photo-choice'); const input = el('input'); input.type = 'checkbox'; input.name = 'photoIds'; input.value = photo.id; input.checked = story ? story.photoIds.includes(photo.id) : filter.get('photo') === photo.id; label.append(imageFor(photo, 'thumb'), input, el('span', photo.title)); picker.append(label); }
  if (!photos.length) picker.append(el('p', '还没有照片，可以先去相册贴一张。'));
  const wishes = $('[data-story-wishes]'); wishes.replaceChildren();
  for (const wish of notebook?.wishes ?? []) { const label = el('label', '', 'memory-choice'); const input = el('input'); input.type = 'checkbox'; input.name = 'wishIds'; input.value = wish.id; input.checked = story ? story.wishIds.includes(wish.id) : filter.get('wish') === wish.id; label.append(input, el('span', wish.text)); wishes.append(label); }
  if (!notebook?.wishes.length) wishes.append(el('p', '清单还空着，想好再关联。'));
  storyForm.hidden = false; storyForm.scrollIntoView({ block: 'start' }); field(storyForm, 'title').focus();
}
function checked(form: HTMLFormElement, name: string) { return all<HTMLInputElement>(`input[name="${name}"]:checked`, form).map(input => input.value); }
storyForm.addEventListener('submit', event => { event.preventDefault(); void submit(storyForm, async () => {
  const id = value(storyForm, 'id'); const body: StoryInput = { expectedVersion: storyEditVersion, title: value(storyForm, 'title'), date: value(storyForm, 'date'), text: value(storyForm, 'text'), layout: value(storyForm, 'layout') as StoryInput['layout'], revealTogether: (field(storyForm, 'revealTogether') as HTMLInputElement).checked, photoIds: checked(storyForm, 'photoIds'), wishIds: checked(storyForm, 'wishIds') };
  if (await write(`/stories/${id}`, 'PUT', body)) { delete storyForm.dataset.dirty; storyForm.hidden = true; openStory(id); }
  else conflictReview(storyForm, () => { const latest = book.stories.find(item => item.id === id); return { text: latest ? `${latest.title}\n${latest.date}\n${latest.text}` : '这篇故事暂时不存在。', accept() { storyEditVersion = latest?.version ?? 0; } }; });
}); });

function renderWishes() {
  const list = $('[data-memory-wishes]');
  // Preserve an open scheduling draft while the surrounding book refreshes.
  if (list.querySelector('form[data-dirty="yes"]')) return;
  list.replaceChildren();
  if (!notebook?.wishes.length) { list.append(el('p', '往后的清单还空着。'), Object.assign(el('a', '回到往后的小清单 →', 'text-link'), { href: '/#future' })); return; }
  for (const wish of notebook.wishes) {
    const plan = book.wishPlans.find(item => item.id === wish.id);
    const story = book.stories.find(item => item.id === plan?.storyId) ?? book.stories.find(item => item.wishIds.includes(wish.id));
    const card = el('article', '', 'paper-card'); card.append(el('h3', wish.text), el('p', `${wish.done ? '已经做过' : '还想一起做'}${plan?.plannedDate ? ` · 商定在 ${plan.plannedDate}` : ' · 还没定日期'}`, 'memory-meta'));
    if (story) card.append(button(`翻开后来：${story.title}`, () => openStory(story.id)));
    const edit = button('安排这件事', () => { edit.hidden = true; const form = wishPlan(wish); const close = button('先不改', () => { form.remove(); edit.hidden = false; }); form.append(close); card.append(form); });
    card.append(edit, button('为这件事写故事', () => { filter.set('wish', wish.id); openStoryForm(); })); list.append(card);
  }
}
function wishPlan(wish: Wish, story?: MemoryStory) {
  const plan = book.wishPlans.find(item => item.id === wish.id);
  let planVersion = plan?.version ?? 0;
  const form = el('form', '', 'memory-form memory-wish-plan');
  form.append(el('h4', `从往后走到后来：${wish.text}`));
  const dateLabel = el('label', '商定的日期（可以留空）'); const date = el('input'); date.type = 'date'; date.value = plan?.plannedDate ?? ''; dateLabel.append(date);
  const storyLabel = el('label', '把后来收进哪一篇故事'); const select = el('select'); select.add(new Option('暂不关联', '')); book.stories.forEach(item => select.add(new Option(item.title, item.id))); select.value = plan?.storyId ?? story?.id ?? ''; storyLabel.append(select);
  const doneLabel = el('label', '', 'memory-check'); const done = el('input'); done.type = 'checkbox'; done.checked = wish.done; doneLabel.append(done, el('span', '这件事已经一起做过了'));
  form.append(dateLabel, storyLabel, doneLabel, el('p', '调整完成状态会保留故事和照片。', 'memory-meta'));
  form.addEventListener('input', () => { form.dataset.dirty = 'yes'; });
  const save = el('button', '收好安排与关联', 'pencil-button'); save.type = 'submit'; form.append(save);
  form.addEventListener('submit', event => { event.preventDefault(); void submit(form, async () => {
    const token = generation;
    if (done.checked !== wish.done) {
      try { const updated = await api<CloudNotebook>(`/api/wishes/${encodeURIComponent(wish.id)}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: notebook?.revisions.wishes[wish.id] ?? 0, text: notebook?.wishes.find(item => item.id === wish.id)?.text ?? wish.text, done: done.checked }) }); if (token !== generation) return; notebook = updated; } catch (error) { if (token === generation) report(error); return; }
    }
    if (await write(`/wishPlans/${wish.id}`, 'PUT', { expectedVersion: planVersion, plannedDate: date.value || null, storyId: select.value || null })) { delete form.dataset.dirty; renderWishes(); renderStory(); }
    else conflictReview(form, () => { const latest = book.wishPlans.find(item => item.id === wish.id); return { text: `日期：${latest?.plannedDate ?? '未定'}；故事：${book.stories.find(item => item.id === latest?.storyId)?.title ?? '未关联'}`, accept() { planVersion = latest?.version ?? 0; } }; });
  }); }); return form;
}

function renderLetters() {
  const list = $('[data-letter-list]');
  renderList(list, JSON.stringify(book.letters.map(letter => [letter.id, letter.title, letter.senderId, letter.recipientId, letter.openDate, letter.status, letter.readable])), () => {
    list.replaceChildren();
    if (!book.letters.length) list.append(el('p', '邮局里还没有信，想写的时候再来。'));
    for (const letter of book.letters) {
      const card = button('', () => { void (async () => {
        const token = generation; const controller = new AbortController(); mutations.add(controller); card.disabled = true;
        try { const latest = await api<MemoryLetter>(`${memoryApiRoot}/letters/${letter.id}`, { signal: controller.signal }); if (token !== generation) return; book.letters = book.letters.map(item => item.id === latest.id ? latest : item); selectedLetter = letter.id; renderLetter(); $('[data-letter-detail]').scrollIntoView({ block: 'start' }); }
        catch (error) { if (token === generation && !controller.signal.aborted) report(error); } finally { mutations.delete(controller); card.disabled = false; }
      })(); }, 'memory-card'); card.append(el('p', `${memberName(letter.senderId)} → ${memberName(letter.recipientId)}`, 'memory-meta'), el('h3', letter.title), el('p', `${letter.openDate} · ${letter.status === 'draft' ? '草稿' : letter.readable ? '可以拆信' : '已封好'}`)); list.append(card);
    }
  });
}
function letterInput(letter: MemoryLetter, audioIds = letter.audioIds ?? []): LetterInput { return { expectedVersion: letter.version, title: letter.title, text: letter.text ?? '', recipientId: letter.recipientId, openDate: letter.openDate, pairKey: letter.pairKey, audioIds }; }
function renderLetter() {
  const detail = $('[data-letter-detail]'); const letter = book.letters.find(item => item.id === selectedLetter); detail.hidden = !letter;
  if (!letter) { renderedLetter = ''; detail.replaceChildren(); return; }
  const snapshot = JSON.stringify([letter, book.members]);
  if (detail.dataset.letterId === letter.id && (renderedLetter === snapshot || [...detail.querySelectorAll('audio')].some(audio => !audio.paused))) return;
  if (detail.dataset.letterId === letter.id && detail.querySelector('[data-recording-pending="yes"]')) return;
  detail.dataset.letterId = letter.id;
  renderedLetter = snapshot;
  disposeRecordings(detail); detail.replaceChildren(); detail.append(el('p', `${memberName(letter.senderId)} 寄给 ${memberName(letter.recipientId)} · ${letter.openDate}`, 'memory-meta'), el('h3', letter.title));
  if (letter.text !== undefined && (letter.readable || letter.status === 'draft' && letter.senderId === book.member?.id)) { detail.append(el('p', letter.text, 'memory-prose')); (letter.audioIds ?? []).forEach(id => detail.append(audioCard(id))); }
  else detail.append(el('p', letter.status === 'sealed' ? '信已经封好，到了约定的日子，收信人再来拆开。' : '这封信还在写。'));
  if (letter.pairKey) detail.append(el('p', `一起拆信的约定：${letter.pairKey}`, 'memory-meta'));
  if (letter.senderId === book.member?.id) {
    if (letter.status === 'draft') {
      detail.append(button('接着写', () => openLetter(letter)), button('确认封好这封信', () => sealLetter(letter), 'pencil-button'));
      detail.append(recorder({ letterId: letter.id }, async id => { if (!await write(`/letters/${letter.id}`, 'PUT', letterInput(letter, [...(letter.audioIds ?? []), id]))) throw new Error('Audio attachment failed'); }));
    } else detail.append(button('撤回为草稿', () => withdrawLetter(letter)));
  }
}
// These two actions sit at the bottom of the page, far from the hero's status line,
// so they report next to the reading card instead.
function letterFeedback(message: string) {
  const detail = $('[data-letter-detail]');
  let line = detail.querySelector<HTMLElement>('[data-letter-feedback]');
  if (!line) { line = el('p', '', 'memory-meta'); line.dataset.letterFeedback = ''; line.setAttribute('role', 'status'); detail.append(line); }
  line.textContent = message;
}
async function sealLetter(letter: MemoryLetter) {
  const ok = await write(`/letters/${letter.id}/seal`, 'POST', { expectedVersion: letter.version });
  if (!ok) letterFeedback(lastWriteConflict ? '这封信已在别处更新，请稍后再试。' : '这次没能封好，信的内容还在，可以再试一次。');
}
async function withdrawLetter(letter: MemoryLetter) {
  const ok = await write(`/letters/${letter.id}/withdraw`, 'POST', { expectedVersion: letter.version });
  if (!ok) letterFeedback(lastWriteConflict ? '这封信已在别处更新，请稍后再试。' : '这次没能撤回，信还在封存中，可以再试一次。');
}
function openLetter(letter?: MemoryLetter) {
  all<HTMLElement>('[data-conflict-review]', letterForm).forEach(node => node.remove());
  letterForm.reset(); delete letterForm.dataset.dirty; letterEditVersion = letter?.version ?? 0; set(letterForm, 'id', letter?.id ?? crypto.randomUUID()); set(letterForm, 'title', letter?.title ?? ''); set(letterForm, 'text', letter?.text ?? ''); set(letterForm, 'openDate', letter?.openDate ?? today()); set(letterForm, 'pairKey', letter?.pairKey ?? ''); set(letterForm, 'recipientId', letter?.recipientId ?? (book.member?.id === 'one' ? 'two' : 'one'));
  letterForm.hidden = false; field(letterForm, 'title').focus();
}
letterForm.addEventListener('submit', event => { event.preventDefault(); void submit(letterForm, async () => { const id = value(letterForm, 'id'); const existing = book.letters.find(item => item.id === id); const body: LetterInput = { expectedVersion: letterEditVersion, title: value(letterForm, 'title'), text: value(letterForm, 'text'), recipientId: value(letterForm, 'recipientId') as LetterInput['recipientId'], openDate: value(letterForm, 'openDate'), pairKey: value(letterForm, 'pairKey'), audioIds: existing?.audioIds ?? [] }; if (await write(`/letters/${id}`, 'PUT', body)) { delete letterForm.dataset.dirty; selectedLetter = id; letterForm.hidden = true; renderLetter(); } else conflictReview(letterForm, () => { const latest = book.letters.find(item => item.id === id); return { text: latest ? `${latest.title}\n${latest.text ?? '信件暂不可读'}` : '信件暂时不存在。', accept() { letterEditVersion = latest?.version ?? 0; } }; }); }); });

function audioCard(id: string) {
  const card = el('div', '', 'memory-audio-card'); const audio = el('audio'); audio.controls = true; audio.preload = 'none'; audio.src = memoryAudioUrl(id);
  const hint = el('p'); hint.setAttribute('role', 'status'); const retry = button('再打开一次录音', () => { hint.textContent = '正在重新打开…'; audio.src = memoryAudioUrl(id); audio.load(); void load(); }); retry.hidden = true;
  audio.addEventListener('error', () => { hint.textContent = '录音暂时没能打开，可能仍在同步，可以稍后再试。'; retry.hidden = false; });
  audio.addEventListener('canplay', () => { hint.textContent = ''; retry.hidden = true; }); card.append(el('p', '留在这一页的声音'), audio, hint, retry); return card;
}
function recorder(owner: { storyId?: string; letterId?: string }, onUploaded: (id: string) => void | Promise<void>) {
  const box = el('section', '', 'memory-recording'); box.append(el('h4', '留一段声音'), el('p', '最多 60 秒、4 MiB。录好后先试听，再收进这一页。', 'memory-meta'));
  const feedback = el('p', '', 'memory-recording-status'); feedback.setAttribute('role', 'status');
  const preview = el('audio'); preview.controls = true; preview.hidden = true;
  const file = el('input'); file.type = 'file'; file.accept = 'audio/*'; file.setAttribute('aria-label', '上传已有录音');
  let blob: Blob | null = null; let duration = 0; let objectUrl = ''; let media: MediaRecorder | null = null; let stream: MediaStream | null = null; let timeout: ReturnType<typeof setTimeout> | undefined; let started = 0; let savedId: string | null = null; let attached = false; let disposed = false; let probe: HTMLAudioElement | null = null; let probeGeneration = 0;
  const release = () => { disposed = true; probeGeneration++; if (timeout) clearTimeout(timeout); if (media?.state === 'recording') { media.ondataavailable = null; media.onstop = null; media.stop(); } stream?.getTracks().forEach(track => track.stop()); stream = null; probe?.pause(); probe?.removeAttribute('src'); probe?.load(); probe = null; preview.pause(); preview.removeAttribute('src'); preview.load(); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; blob = null; savedId = null; };
  cleanups.add(release);
  recordingCleanups.set(box, release);
  const choose = async (next: Blob, recordedDuration?: number) => {
    if (disposed) return; const token = generation; const probeToken = ++probeGeneration;
    box.dataset.recordingPending = 'yes'; box.dispatchEvent(new Event('input', { bubbles: true }));
    if (objectUrl) URL.revokeObjectURL(objectUrl); blob = next; savedId = null; attached = false; upload.textContent = '收进这一页'; objectUrl = URL.createObjectURL(next); preview.src = objectUrl; preview.hidden = false; upload.disabled = true;
    duration = recordedDuration ?? await new Promise<number>(resolve => { probe?.pause(); probe?.removeAttribute('src'); probe?.load(); const pending = new Audio(); probe = pending; pending.preload = 'metadata'; pending.onloadedmetadata = () => { const length = pending.duration; pending.removeAttribute('src'); pending.load(); resolve(length); }; pending.onerror = () => resolve(NaN); pending.src = objectUrl; });
    if (disposed || token !== generation || probeToken !== probeGeneration) return;
    if (!Number.isFinite(duration) || duration <= 0 || duration > audioMaxSeconds || next.size > audioMaxBytes) { feedback.textContent = '请选择 60 秒内、4 MiB 以内，浏览器能够试听的录音。'; return; }
    feedback.textContent = `可以试听了，约 ${Math.ceil(duration)} 秒。${owner.storyId ? '上传后还要收好自己的版本。' : ''}`; upload.disabled = false;
  };
  const record = button('开始录音', () => { void (async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { feedback.textContent = '这个浏览器暂不支持录音，可以上传已有录音。'; return; }
    const token = generation;
    try {
      record.disabled = true; box.dataset.recordingPending = 'yes'; box.dispatchEvent(new Event('input', { bubbles: true })); stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation || !box.isConnected) { stream.getTracks().forEach(track => track.stop()); return; }
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      media = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined); const chunks: BlobPart[] = []; started = Date.now();
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => { if (timeout) clearTimeout(timeout); stream?.getTracks().forEach(track => track.stop()); stream = null; stop.disabled = true; record.disabled = false; if (token === generation) void choose(new Blob(chunks, { type: media?.mimeType ?? 'audio/webm' }), Math.min(60, (Date.now() - started) / 1000)); };
      media.start(); stop.disabled = false; feedback.textContent = '正在录音，最长一分钟。'; timeout = setTimeout(() => { if (media?.state === 'recording') media.stop(); }, audioMaxSeconds * 1000);
    } catch { record.disabled = false; feedback.textContent = '没有取得麦克风权限。可以允许录音后重试，也可以上传已有录音。'; stream?.getTracks().forEach(track => track.stop()); }
  })(); });
  const stop = button('录好了', () => { if (media?.state === 'recording') media.stop(); }); stop.disabled = true;
  const upload = button('收进这一页', () => { void (async () => {
    if (!blob || upload.disabled) return; const token = generation; const controller = new AbortController(); mutations.add(controller); upload.disabled = true; file.disabled = true; record.disabled = true;
    try {
      if (!savedId) {
        const query = new URLSearchParams(owner as Record<string, string>);
        const response = await fetch(`${memoryApiRoot}/audio?${query}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Audio-Duration': String(duration) }, body: blob });
        const data = await response.json(); if (!response.ok) throw new ApiError(response.status, data.error ?? '录音暂时没能收好。');
        if (token !== generation) return; savedId = data.id;
      }
      await onUploaded(savedId!); if (token !== generation) return; attached = true; upload.textContent = '录音已上传'; delete box.dataset.recordingPending; feedback.textContent = owner.storyId ? '录音已上传。收好自己的版本后，换设备也能听。' : '录音已收进信里。';
      if (owner.letterId) renderLetter();
    } catch (error) { if (token === generation) { feedback.textContent = '没能收好，录音还在，可以重试。'; report(error); } }
    finally { mutations.delete(controller); if (token === generation && !disposed) { upload.disabled = attached; file.disabled = false; record.disabled = false; } }
  })(); }, 'pencil-button'); upload.disabled = true;
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (selected) void choose(selected); });
  box.append(record, stop, file, preview, feedback, upload); return box;
}

type Slide = { kind: 'story' | 'photo'; id: string };
let screening: Slide[] = [];
let screeningIndex = 0;
let screeningTimer: ReturnType<typeof setInterval> | null = null;
function stopScreening() { if (screeningTimer) clearInterval(screeningTimer); screeningTimer = null; $('[data-screening-play]').textContent = '自动播放'; $('[data-screening-stage]').classList.remove('is-playing'); }
function slideTitle(slide: Slide) { return slide.kind === 'story' ? book.stories.find(item => item.id === slide.id)?.title ?? '故事已移除' : photos.find(item => item.id === slide.id)?.title ?? '照片已移除'; }
function renderScreeningOptions() {
  const selected = new Set(all<HTMLInputElement>('input:checked', $('[data-screening-options]')).map(input => input.value));
  const container = $('[data-screening-options]'); container.replaceChildren();
  for (const slide of [...book.stories.map(item => ({ kind: 'story' as const, id: item.id })), ...photos.map(item => ({ kind: 'photo' as const, id: item.id }))]) { const label = el('label', '', 'memory-choice'); const input = el('input'); input.type = 'checkbox'; input.value = `${slide.kind}:${slide.id}`; input.checked = selected.has(input.value); label.append(input, el('span', `${slide.kind === 'story' ? '故事' : '照片'} · ${slideTitle(slide)}`)); container.append(label); }
}
function renderScreeningOrder() {
  const order = $('[data-screening-order]'); order.replaceChildren();
  screening.forEach((slide, index) => { const row = el('li'); row.append(el('span', slideTitle(slide))); const up = button('往前', () => { [screening[index - 1], screening[index]] = [screening[index], screening[index - 1]]; stopScreening(); renderScreeningOrder(); showSlide(); }); up.disabled = index === 0; const down = button('往后', () => { [screening[index + 1], screening[index]] = [screening[index], screening[index + 1]]; stopScreening(); renderScreeningOrder(); showSlide(); }); down.disabled = index === screening.length - 1; row.append(up, down); order.append(row); });
}
function showSlide() {
  const stage = $('[data-screening-stage]'); stage.replaceChildren(); const slide = screening[screeningIndex];
  if (!slide) { stage.append(el('p', '选几页真实的内容，再开始播放。')); return; }
  if (slide.kind === 'story') { const story = book.stories.find(item => item.id === slide.id); if (story) { stage.append(el('p', story.date, 'memory-meta'), el('h3', story.title)); const photo = photos.find(item => story.photoIds.includes(item.id)); if (photo) stage.append(imageFor(photo)); stage.append(el('p', story.text, 'memory-prose')); story.parts.filter(part => part.text).forEach(part => stage.append(el('p', `${memberName(part.memberId)}：${part.text}`, 'memory-prose'))); } }
  else { const photo = photos.find(item => item.id === slide.id); if (photo) stage.append(imageFor(photo), el('h3', photo.title), el('p', photo.date ?? '', 'memory-meta')); }
  $('[data-screening-progress]').textContent = `第 ${screeningIndex + 1} 页，共 ${screening.length} 页。${matchMedia('(prefers-reduced-motion: reduce)').matches ? '已按减少动态效果偏好关闭自动播放，请手动翻页。' : ''}`;
}
$<HTMLFormElement>('[data-screening-form]').addEventListener('submit', event => { event.preventDefault(); stopScreening(); screening = all<HTMLInputElement>('input:checked', $('[data-screening-options]')).map(input => { const [kind, id] = input.value.split(':'); return { kind: kind as Slide['kind'], id }; }); screeningIndex = 0; renderScreeningOrder(); showSlide(); });
$('[data-screening-prev]').addEventListener('click', () => { stopScreening(); screeningIndex = Math.max(0, screeningIndex - 1); showSlide(); });
$('[data-screening-next]').addEventListener('click', () => { stopScreening(); screeningIndex = Math.min(screening.length - 1, screeningIndex + 1); showSlide(); });
$('[data-screening-restart]').addEventListener('click', () => { stopScreening(); screeningIndex = 0; showSlide(); });
$('[data-screening-play]').addEventListener('click', () => { if (screeningTimer) { stopScreening(); return; } if (!screening.length) return; if (matchMedia('(prefers-reduced-motion: reduce)').matches) { showSlide(); return; } $('[data-screening-play]').textContent = '暂停'; $('[data-screening-stage]').classList.add('is-playing'); screeningTimer = setInterval(() => { if (screeningIndex >= screening.length - 1) { stopScreening(); return; } screeningIndex++; showSlide(); }, 5500); });

function renderPlaces() {
  const year = $<HTMLSelectElement>('[data-place-year]');
  const places = book.places.filter(place => !selectedPlaceYear || String(place.year) === selectedPlaceYear);
  const list = $('[data-place-list]');
  renderList(list, JSON.stringify(places.map(place => [place.id, place.name, place.year, place.storyIds, place.wishIds])), () => {
    list.replaceChildren();
    if (!places.length) list.append(el('p', book.places.length ? '这一年还没有记下地点。' : '有想记的地方时，再写下来。暂时留空也没关系。'));
    for (const place of places) {
      const card = el('article', '', 'memory-card'); card.dataset.placeId = place.id; card.tabIndex = -1;
      // Coordinates and version are not part of the render key, so resolve the latest
      // record by ID; a retained card must not reopen the editor with stale state.
      card.append(el('h3', place.name), el('p', String(place.year), 'memory-meta'), button('改这个地点', () => openPlace(book.places.find(item => item.id === place.id) ?? place)));
      place.storyIds.forEach(id => { const story = book.stories.find(item => item.id === id); if (story) card.append(button(`翻开：${story.title}`, () => openStory(id))); });
      place.wishIds.forEach(id => { const wish = notebook?.wishes.find(item => item.id === id); if (wish) card.append(button(`往后的小事：${wish.text}`, () => { $('#wishes').scrollIntoView({ block: 'start' }); })); }); list.append(card);
    }
  });
  // Rebuilding the select would close it under a reader, so only touch it on change.
  const years = [...new Set(book.places.map(place => place.year))].sort((a, b) => b - a);
  if (year.dataset.years !== JSON.stringify(years)) {
    year.dataset.years = JSON.stringify(years);
    year.replaceChildren(new Option('所有年份', ''));
    years.forEach(item => year.add(new Option(String(item), String(item))));
  }
  year.value = selectedPlaceYear;
}
function openPlace(place?: MemoryPlace) {
  all<HTMLElement>('[data-conflict-review]', placeForm).forEach(node => node.remove());
  placeForm.querySelector('details')?.removeAttribute('open');
  placeForm.reset(); delete placeForm.dataset.dirty; placeEditVersion = place?.version ?? 0; set(placeForm, 'id', place?.id ?? crypto.randomUUID()); set(placeForm, 'name', place?.name ?? ''); set(placeForm, 'year', String(place?.year ?? Number(today().slice(0, 4)))); set(placeForm, 'latitude', place?.lat == null ? '' : String(place.lat)); set(placeForm, 'longitude', place?.lng == null ? '' : String(place.lng));
  const stories = $<HTMLSelectElement>('[data-place-story]'); stories.replaceChildren(new Option('暂不关联', '')); book.stories.forEach(story => stories.add(new Option(story.title, story.id))); stories.value = place?.storyIds[0] ?? selectedStory ?? '';
  const wishes = $<HTMLSelectElement>('[data-place-wish]'); wishes.replaceChildren(new Option('暂不关联', '')); notebook?.wishes.forEach(wish => wishes.add(new Option(wish.text, wish.id))); wishes.value = place?.wishIds[0] ?? filter.get('wish') ?? '';
  placeForm.hidden = false; placeForm.scrollIntoView({ block: 'start' }); field(placeForm, 'name').focus();
}
placeForm.addEventListener('submit', event => { event.preventDefault(); void submit(placeForm, async () => { const storyId = value(placeForm, 'storyId'); const wishId = value(placeForm, 'wishId'); const id = value(placeForm, 'id'); const latitude = value(placeForm, 'latitude').trim(); const longitude = value(placeForm, 'longitude').trim(); if (await write(`/places/${id}`, 'PUT', { expectedVersion: placeEditVersion, name: value(placeForm, 'name'), lat: latitude === '' ? null : Number(latitude), lng: longitude === '' ? null : Number(longitude), year: Number(value(placeForm, 'year')), storyIds: storyId ? [storyId] : [], wishIds: wishId ? [wishId] : [] })) { delete placeForm.dataset.dirty; placeForm.hidden = true; } else conflictReview(placeForm, () => { const latest = book.places.find(item => item.id === id); return { text: latest ? `${latest.name} · ${latest.year}${latest.lat == null ? ' · 未填坐标' : ` · ${latest.lat}, ${latest.lng}`}` : '地点暂时不存在。', accept() { placeEditVersion = latest?.version ?? 0; } }; }); }); });

const identityChanges = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('loveuhqq_member') : null;
let remoteTimer: ReturnType<typeof setTimeout> | null = null;
let remoteAsk = true;

function postMemberChanged() {
  identityChanges?.postMessage('changed');
  try { localStorage.setItem('loveuhqq_member_changed', String(Date.now())); } catch { /* Optional cross-tab fallback. */ }
}
function askOtherDrafts(): Promise<boolean> {
  const channel = identityChanges;
  if (!channel) return Promise.resolve(false);
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    let settled = false;
    const finish = (dirty: boolean) => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('message', onMessage);
      resolve(dirty);
    };
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      const record = data as { type?: unknown; id?: unknown };
      if (typeof data === 'object' && data !== null && record.type === 'dirty' && record.id === id) finish(true);
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'query-dirty', id });
    window.setTimeout(() => finish(false), 200);
  });
}
function applyRemoteIdentity() {
  if (!authenticated) { clearPrivate(); return; }
  discardShownContent();
  void load();
}
function scheduleRemote(mayAsk: boolean) {
  cancelExport();
  if (switching) { remotePending = true; return; }
  if (!mayAsk) remoteAsk = false;
  if (remoteTimer !== null) return;
  remoteTimer = setTimeout(() => {
    const ask = remoteAsk;
    remoteTimer = null;
    remoteAsk = true;
    if (ask && hasUnsavedChanges() && !window.confirm(discardIdentityMessage)) {
      const previous = book.member?.id;
      if (previous) void api<MemoryBootstrap>(`${memoryApiRoot}/identity`, { method: 'POST', body: JSON.stringify({ id: previous }) }).then(() => postMemberChanged()).catch(report);
      return;
    }
    applyRemoteIdentity();
  }, 40);
}
identityChanges?.addEventListener('message', event => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null) {
    const record = data as { type?: unknown; id?: unknown };
    if (record.type === 'query-dirty' && typeof record.id === 'string' && hasUnsavedChanges()) identityChanges?.postMessage({ type: 'dirty', id: record.id });
    return;
  }
  if (data === 'changed') scheduleRemote(false);
});
window.addEventListener('storage', event => { if (event.key === 'loveuhqq_member_changed') scheduleRemote(true); });

$('[data-memory-retry]').addEventListener('click', () => { void load(); });
exportButton.addEventListener('click', () => { void exportVisibleRecords(); });
$('[data-story-new]').addEventListener('click', () => openStoryForm());
$('[data-story-cancel]').addEventListener('click', () => { storyForm.hidden = true; delete storyForm.dataset.dirty; });
$('[data-letter-new]').addEventListener('click', () => openLetter());
$('[data-letter-cancel]').addEventListener('click', () => { letterForm.hidden = true; delete letterForm.dataset.dirty; });
$('[data-place-new]').addEventListener('click', () => openPlace());
$('[data-place-cancel]').addEventListener('click', () => { placeForm.hidden = true; delete placeForm.dataset.dirty; });
$<HTMLInputElement>('[data-story-search]').addEventListener('input', renderStoryList);
$('[data-story-filter-clear]').addEventListener('click', () => { filter = new URLSearchParams(); $<HTMLInputElement>('[data-story-search]').value = ''; renderStoryList(); });
$<HTMLSelectElement>('[data-place-year]').addEventListener('change', event => { selectedPlaceYear = (event.target as HTMLSelectElement).value; renderPlaces(); });
onSessionChange(state => { authenticated = state.authenticated; if (!authenticated) clearPrivate(); else if (!exportRequest) void load(); });
document.addEventListener('click', event => { if ((event.target as Element).closest('[data-session-logout], [data-lock-site]')) { authenticated = false; clearPrivate(); } }, { capture: true });
window.addEventListener('pagehide', clearPrivate);
window.addEventListener('pageshow', event => { if (event.persisted) { clearPrivate(); void refreshSession().then(state => { authenticated = state.authenticated; if (authenticated) void load(); }).catch(report); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopScreening(); else if (authenticated && !switching) void load(); });
window.setInterval(() => { if (authenticated && !switching && document.visibilityState === 'visible' && !mutations.size) void load(); }, 10_000);
for (const form of [storyForm, letterForm, placeForm]) form.addEventListener('input', () => { form.dataset.dirty = 'yes'; });
all<HTMLButtonElement>('[data-select-identity]').forEach(button => button.addEventListener('click', () => { void selectIdentity(button.dataset.selectIdentity ?? ''); }));
$('[data-switch-identity]').addEventListener('click', () => { void selectIdentity($<HTMLButtonElement>('[data-switch-identity]').dataset.switchTo ?? ''); });
document.addEventListener('memory:identity-changed', () => scheduleRemote(false));

function initNavObserver() {
  const links = all<HTMLAnchorElement>('.site-nav a');
  if (!links.length || !('IntersectionObserver' in window)) return;
  const sections = links.map(link => document.querySelector<HTMLElement>(link.hash)).filter((s): s is HTMLElement => !!s);
  if (!sections.length) return;
  const current = new Set<Element>();
  const navObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) current.add(entry.target);
      else current.delete(entry.target);
    }
    const active = sections.find(section => current.has(section));
    for (const link of links) {
      if (active && link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-40% 0px -45% 0px' });
  sections.forEach(section => navObserver.observe(section));
}

void getSession().catch(report);
initNavObserver();
jumpToHash();
