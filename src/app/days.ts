import {
  dotted, getAnniversaryDay, getMomentDateStatus, getNextShanghaiMidnight, getRelationshipYear,
  getRelationshipYearMonths, getUpcomingAnniversary, monthNames, type CalendarMonth,
} from '../lib/anniversary';
import { anniversaryLabel, dayTone, describeDay, yearLabel } from '../lib/calendar-labels';
import { momentTitles } from '../data/moments';
import { odometer } from '../motion/odometer';
import { scrollToElement } from '../motion/pointer';
import { whenOpen } from '../motion/reveal';

/** The year of lights: one dot a day, the readout, the stats and the cover count. */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const vertical = matchMedia('(max-width: 40rem)');
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];

const grid = $('[data-year-grid]')!;
const readout = $('[data-year-readout]')!;
const readoutBar = $('.calendar-readout-bar');
const returnToday = $<HTMLButtonElement>('[data-return-today]')!;
const noteJump = $<HTMLButtonElement>('[data-note-jump]')!;
const cellDates = new Map<number, string>();
let renderedYear = 1;
let currentYear = 1;
let viewYear = 1;
let anniversaryDay = 0;
let today = 0;
let todayDate = '';
let pickedCell: HTMLElement | null = null;
let pinned = false;
let writtenDates = new Set<string>();
let opened = false;

function setMomentSelection(date: string | null) {
  for (const ticket of $$<HTMLButtonElement>('[data-moment-ticket]')) {
    const selected = ticket.dataset.momentTicketDate === date;
    ticket.classList.toggle('is-selected', selected);
    if (selected) ticket.setAttribute('aria-current', 'date'); else ticket.removeAttribute('aria-current');
  }
}

function buildGrid(months: CalendarMonth[], year: number) {
  const lastDay = months.at(-1)!.days.at(-1)!;
  grid.style.setProperty('--months', String(months.length));
  grid.replaceChildren(...months.map(month => {
    const row = document.createElement('div');
    row.className = 'calendar-row';
    const label = document.createElement('span');
    label.className = 'calendar-month';
    label.textContent = monthNames[month.month - 1];
    const cells = document.createElement('span');
    cells.className = 'calendar-cells';
    cells.style.setProperty('--start', String(month.days[0].dayOfMonth));
    for (const day of month.days) {
      const cell = document.createElement('span');
      cell.dataset.day = String(day.day);
      if (day.day === 100) cell.classList.add('is-hundred');
      if (day.day === lastDay.day) cell.classList.add('is-anniversary');
      if (momentTitles.has(day.date)) cell.classList.add('is-moment');
      cells.append(cell);
    }
    row.append(label, cells);
    return row;
  }));
  const first = months[0].days[0];
  grid.setAttribute('aria-label', `${yearLabel(year)}的日历，从 ${dotted(first.date)} 到 ${dotted(lastDay.date)}，可用方向键翻看`);
  $('[data-year-first]')!.textContent = dotted(first.date);
  $('[data-year-last]')!.textContent = dotted(lastDay.date);
  $('[data-year-label]')!.textContent = anniversaryLabel(year);
  $('[data-year-first-label]')!.textContent = year === 1 ? '第一天' : yearLabel(year);
}

function prepareYear(year: number) {
  const months = getRelationshipYearMonths(year);
  if (year !== renderedYear) { pickedCell = null; pinned = false; buildGrid(months, year); }
  renderedYear = year;
  cellDates.clear();
  for (const month of months) for (const day of month.days) cellDates.set(day.day, day.date);
  anniversaryDay = months.at(-1)!.days.at(-1)!.day;
}

const describeCell = (day: number) => {
  const date = cellDates.get(day);
  if (!date) return '';
  return describeDay({ day, date, today, anniversaryDay, relationshipYear: renderedYear, currentYear: Number(todayDate.slice(0, 4)), moment: momentTitles.get(date) });
};
function viewRange() {
  const days = [...cellDates.keys()];
  return days.length ? `${dotted(cellDates.get(Math.min(...days))!)} — ${dotted(cellDates.get(Math.max(...days))!)}` : '';
}

function updateYearStats() {
  const days = [...cellDates.keys()];
  const firstDay = days.length ? Math.min(...days) : 1;
  const filled = Math.min(cellDates.size, Math.max(0, today - firstDay + 1));
  const filledOut = $('[data-filled]')!;
  if (opened) odometer(filledOut, filled); else filledOut.textContent = String(filled);
  $('[data-year-total]')!.textContent = String(cellDates.size);
}

function showReadout(day = today, updateNotebook = false) {
  const inView = cellDates.has(day);
  readout.textContent = inView ? describeCell(day) : viewRange();
  readout.classList.toggle('is-picked', inView && day !== today);
  noteJump.hidden = !pinned || !inView;
  returnToday.disabled = inView && day === today;
  const date = cellDates.get(day);
  if (updateNotebook) {
    setMomentSelection(date ?? null);
    if (date) document.dispatchEvent(new CustomEvent('journal:date', { detail: date }));
  }
}

function paintGrid() {
  let lit = 0;
  for (const cell of grid.querySelectorAll<HTMLElement>('[data-day]')) {
    const day = Number(cell.dataset.day);
    const past = day < today;
    cell.classList.toggle('is-past', past);
    cell.classList.toggle('is-today', day === today);
    cell.classList.toggle('is-written', writtenDates.has(cellDates.get(day) ?? ''));
    cell.dataset.tone = String(dayTone(day));
    if (past) cell.style.setProperty('--n', String(Math.round(lit++ * (1000 / Math.max(1, today)))));
  }
}

document.addEventListener('notebook:changed', event => {
  writtenDates = new Set((event as CustomEvent<string[]>).detail);
  paintGrid();
});

/* ---------- Picking days: hover, tap, swipe and keys ---------- */

const pick = (target: EventTarget | null, updateNotebook = false) => {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[data-day]') : null;
  if (!cell || !grid.contains(cell)) return false;
  pickedCell?.classList.remove('is-picked');
  pickedCell = cell;
  cell.classList.add('is-picked');
  showReadout(Number(cell.dataset.day), updateNotebook);
  return true;
};
const release = () => {
  pinned = false;
  pickedCell?.classList.remove('is-picked');
  pickedCell = null;
  showReadout(today, true);
};
const backToToday = () => {
  release();
  if (viewYear === currentYear) return;
  viewYear = currentYear;
  prepareYear(viewYear); paintGrid(); updateYearStats(); updateYearNav(); showReadout(today, true);
};
returnToday.addEventListener('click', () => { backToToday(); grid.focus({ preventScroll: true }); });

let touchId: number | null = null;
let touchStart = { x: 0, y: 0 };
let touchCell: HTMLElement | null = null;
let touchPrior: HTMLElement | null = null;
let touchPriorPinned = false;
let ignoreClick = false;

grid.addEventListener('pointerover', event => { if (event.pointerType === 'mouse' && !pinned) pick(event.target); });
grid.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !pinned) release(); });
grid.addEventListener('pointerdown', event => {
  ignoreClick = false;
  if (event.pointerType !== 'touch' || touchId !== null) return;
  const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-day]') : null;
  if (!cell || !grid.contains(cell)) return;
  touchPrior = pickedCell; touchPriorPinned = pinned; pinned = false;
  pick(cell);
  touchId = event.pointerId; touchStart = { x: event.clientX, y: event.clientY }; touchCell = pickedCell;
  grid.setPointerCapture(event.pointerId);
});
grid.addEventListener('pointermove', event => {
  if (event.pointerId !== touchId) return;
  const dx = Math.abs(event.clientX - touchStart.x);
  const dy = Math.abs(event.clientY - touchStart.y);
  // Months are columns on phones: sideways scrubbing previews, vertical movement stays page scroll.
  if (dx < 8 || dx < dy * 1.25) return;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  if (under && grid.contains(under) && pick(under)) touchCell = pickedCell;
});
const finishTouch = (event: PointerEvent, commit: boolean) => {
  if (event.pointerId !== touchId) return;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  const finalCell = under instanceof Element ? under.closest<HTMLElement>('[data-day]') : null;
  if (commit && finalCell && grid.contains(finalCell)) touchCell = finalCell;
  if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
  const selected = touchCell; const previous = touchPrior; const wasPinned = touchPriorPinned;
  touchId = null; touchCell = null; touchPrior = null; touchPriorPinned = false; ignoreClick = true;
  if (!commit || !selected || !grid.contains(selected)) {
    pickedCell?.classList.remove('is-picked');
    pickedCell = wasPinned && previous && grid.contains(previous) ? previous : null;
    pinned = pickedCell !== null;
    pickedCell?.classList.add('is-picked');
    showReadout(pickedCell ? Number(pickedCell.dataset.day) : today);
    return;
  }
  pinned = true;
  pick(selected, true);
  grid.focus({ preventScroll: true });
  noteJump.hidden = false;
};
grid.addEventListener('pointerup', event => finishTouch(event, true));
grid.addEventListener('pointercancel', event => finishTouch(event, false));
grid.addEventListener('click', event => {
  if (ignoreClick && event.detail > 0) { ignoreClick = false; return; }
  ignoreClick = false;
  if (pick(event.target, true)) {
    pinned = true;
    showReadout(Number(pickedCell!.dataset.day));
    grid.focus({ preventScroll: true });
  } else release();
});
document.addEventListener('click', event => {
  const target = event.target as Element;
  if (pickedCell && !grid.contains(target) && !target.closest('.dayback, [data-note-jump], [data-moment-ticket], .calendar-readout-bar')) release();
});

const showDayBack = () => {
  const dayBack = $<HTMLElement>('.dayback');
  if (!dayBack) return;
  dayBack.focus({ preventScroll: true });
  scrollToElement(dayBack);
};
noteJump.addEventListener('click', showDayBack);

const move = (target: number) => {
  const days = [...cellDates.keys()];
  const clamped = Math.min(Math.max(...days), Math.max(Math.min(...days), target));
  const cell = grid.querySelector<HTMLElement>(`[data-day="${clamped}"]`);
  if (!cell) return;
  pinned = true;
  pick(cell, true);
  // Keep the picked dot clear of the sticky readout.
  cell.style.scrollMarginTop = `${(readoutBar?.offsetHeight ?? 0) + (document.querySelector<HTMLElement>('[data-header]')?.offsetHeight ?? 0) + 8}px`;
  cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};
grid.addEventListener('keydown', event => {
  const current = pickedCell?.dataset.day !== undefined ? Number(pickedCell.dataset.day) : today;
  const across = vertical.matches ? 31 : 1;
  const down = vertical.matches ? 1 : 31;
  switch (event.key) {
    case 'ArrowLeft': move(current - across); break;
    case 'ArrowRight': move(current + across); break;
    case 'ArrowUp': move(current - down); break;
    case 'ArrowDown': move(current + down); break;
    case 'Home': move(Math.min(...cellDates.keys())); break;
    case 'End': move(Math.max(...cellDates.keys())); break;
    case 'Escape': release(); break;
    default: return;
  }
  event.preventDefault();
});

for (const ticket of $$<HTMLButtonElement>('[data-moment-ticket]')) {
  ticket.addEventListener('click', () => {
    const date = ticket.dataset.momentTicketDate;
    if (!date) return;
    const year = getRelationshipYear(new Date(`${date}T12:00:00.000Z`));
    if (year >= 1 && year <= currentYear && year !== viewYear) switchYear(year);
    const entry = [...cellDates].find(([, cellDate]) => cellDate === date);
    const cell = entry ? grid.querySelector<HTMLElement>(`[data-day="${entry[0]}"]`) : null;
    if (cell) {
      pinned = true;
      pick(cell, true);
    } else {
      pickedCell?.classList.remove('is-picked');
      pickedCell = null;
      pinned = true;
      setMomentSelection(date);
      readout.textContent = `${dotted(date)} · ${momentTitles.get(date) ?? ''}`;
      readout.classList.add('is-picked');
      returnToday.disabled = false;
      noteJump.hidden = false;
      document.dispatchEvent(new CustomEvent('journal:date', { detail: date }));
    }
    showDayBack();
  });
}

/* ---------- Other years ---------- */

function switchYear(year: number) {
  if (year < 1 || year > currentYear || year === viewYear) return;
  viewYear = year;
  prepareYear(viewYear); setMomentSelection(null); paintGrid(); updateYearStats(); updateYearNav(); showReadout();
}
function updateYearNav() {
  const nav = $('[data-year-nav]')!;
  const previous = $<HTMLButtonElement>('[data-year-prev]')!;
  const next = $<HTMLButtonElement>('[data-year-next]')!;
  nav.hidden = currentYear <= 1 && viewYear <= 1;
  previous.disabled = viewYear <= 1;
  next.disabled = viewYear >= currentYear;
}
$('[data-year-prev]')!.addEventListener('click', () => switchYear(viewYear - 1));
$('[data-year-next]')!.addEventListener('click', () => switchYear(viewYear + 1));

/* ---------- Dates ---------- */

let midnightTimer: number | undefined;
function refreshDates() {
  const now = new Date();
  today = getAnniversaryDay(now);
  const upcoming = getUpcomingAnniversary(now);
  const nextIsToday = upcoming.daysRemaining === 0;
  const todayYear = getRelationshipYear(now);
  if (viewYear === currentYear) viewYear = todayYear;
  currentYear = todayYear;
  prepareYear(viewYear);
  todayDate = cellDates.get(today) ?? upcoming.date;

  for (const element of $$<HTMLTimeElement>('[data-moment-date]')) {
    const status = getMomentDateStatus(element.dateTime, now);
    const item = element.closest('li');
    item?.classList.toggle('is-upcoming', status === 'upcoming');
    const label = item?.querySelector<HTMLElement>('[data-moment-status]');
    if (label) { label.textContent = status === 'upcoming' ? '还没到' : status === 'today' ? '时候已到' : ''; label.hidden = status === 'past'; }
  }
  for (const element of $$('[data-day-count]')) element.textContent = String(Math.max(0, today));
  if (opened) odometer($('[data-count-up]')!, today);
  document.querySelector<HTMLCanvasElement>('[data-aura="cover"]')?.setAttribute('data-days', String(today));

  $('[data-next-title]')!.textContent = upcoming.title;
  const nextDays = $('[data-next-days]')!;
  if (nextIsToday) { nextDays.removeAttribute('aria-label'); nextDays.classList.remove('odo'); nextDays.textContent = '就是今天'; }
  else if (opened) odometer(nextDays, upcoming.daysRemaining);
  else nextDays.textContent = String(upcoming.daysRemaining);
  $('[data-next-prefix]')!.hidden = nextIsToday;
  $('[data-next-suffix]')!.hidden = nextIsToday;
  const nextDate = $<HTMLTimeElement>('[data-next-date]')!;
  nextDate.dateTime = upcoming.date;
  nextDate.textContent = dotted(upcoming.date);

  updateYearStats(); paintGrid(); updateYearNav();
  showReadout(pickedCell ? Number(pickedCell.dataset.day) : today);
  window.clearTimeout(midnightTimer);
  midnightTimer = window.setTimeout(refreshDates, Math.max(1000, getNextShanghaiMidnight(now).getTime() - now.getTime() + 100));
}

refreshDates();
document.dispatchEvent(new Event('journal:notes-request'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshDates(); });
addEventListener('pageshow', event => { if (event.persisted) refreshDates(); });

/* ---------- Opening: the count rolls, the lights come on ---------- */

const count = $('[data-count-up]')!;
if (!calm.matches) grid.classList.add('is-unlit');
void whenOpen().then(() => {
  opened = true;
  window.setTimeout(() => odometer(count, today), calm.matches ? 0 : 1100);
  const io = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    grid.classList.add('is-lighting');
    requestAnimationFrame(() => grid.classList.remove('is-unlit'));
    window.setTimeout(() => grid.classList.remove('is-lighting'), 2200);
    odometer($('[data-filled]')!, Number($('[data-filled]')!.textContent) || Math.min(cellDates.size, today));
    const next = $('[data-next-days]')!;
    if (/^\d+$/.test(next.textContent ?? '')) odometer(next, Number(next.textContent), 200);
  }, { threshold: .25 });
  io.observe(grid);
});

/* ---------- Header day chip ---------- */

const chip = $('[data-header-day]');
const coverCount = $('.cover-count');
if (chip && coverCount && today > 0) {
  chip.hidden = false;
  new IntersectionObserver(([entry]) => {
    chip.classList.toggle('is-shown', !entry.isIntersecting && entry.boundingClientRect.top < 0);
  }).observe(coverCount);
}
