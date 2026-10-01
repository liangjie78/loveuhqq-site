import {
  dotted,
  getAnniversaryDay,
  getNextShanghaiMidnight,
  getRelationshipYear,
  getRelationshipYearMonths,
  getUpcomingAnniversary,
  hundredthDayDate,
  monthNames,
  relationshipStartDate,
  type CalendarMonth,
} from '../lib/anniversary';
import { momentTitles } from '../data/moments';
import './notebook';
import { renderMomentImage } from '../lib/moment-image';

const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const numerals = '一二三四五六七八九十';
const hundredthDay = 100;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];

const yearLabel = (year: number) => (year <= 10 ? `第${numerals[year - 1]}年` : `第 ${year} 年`);
const anniversaryLabel = (year: number) =>
  year === 2 ? '两周年' : year <= 10 ? `${numerals[year - 1]}周年` : `${year} 周年`;

function spokenDate(date: string, currentYear: number) {
  const [year, month, day] = date.split('-').map(Number);
  return year === currentYear ? `${month} 月 ${day} 日` : `${year} 年 ${month} 月 ${day} 日`;
}

/* ---------- The year of days ---------- */

const grid = $('[data-year-grid]');
const readout = $('[data-year-readout]');
const returnToday = $<HTMLButtonElement>('[data-return-today]');
const noteJump = $<HTMLButtonElement>('[data-note-jump]');
const verticalCalendar = window.matchMedia('(max-width: 640px)');
const cellDates = new Map<number, string>();
let renderedYear = 1;
/** The relationship year today falls in, and the year currently on screen. */
let currentYear = 1;
let viewYear = 1;
let anniversaryDay = 0;
let today = 0;
let todayDate = '';
let pickedCell: HTMLElement | null = null;
let pinned = false;
let touchPointerId: number | null = null;
let touchStartX = 0;
let touchStartY = 0;
let touchCell: HTMLElement | null = null;
let touchPriorCell: HTMLElement | null = null;
let touchPriorPinned = false;
let ignoreTouchClick = false;
let writtenDates = new Set<string>();
document.addEventListener('notebook:changed', (event) => {
  writtenDates = new Set((event as CustomEvent<string[]>).detail);
  paintGrid();
});

function buildGrid(months: CalendarMonth[], year: number) {
  if (!grid) return;
  const lastDay = months[months.length - 1].days.at(-1)!;
  grid.style.setProperty('--months', String(months.length));
  grid.replaceChildren(...months.map((month) => {
    const row = document.createElement('div');
    row.className = 'year-row';
    const label = document.createElement('span');
    label.className = 'year-month';
    label.textContent = monthNames[month.month - 1];
    const cells = document.createElement('span');
    cells.className = 'year-cells';
    cells.style.setProperty('--start', String(month.days[0].dayOfMonth));
    for (const day of month.days) {
      const cell = document.createElement('span');
      cell.dataset.day = String(day.day);
      if (day.day === hundredthDay) cell.classList.add('is-hundred');
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
  const firstLabel = $('[data-year-first]')!.previousElementSibling;
  if (firstLabel) firstLabel.textContent = yearLabel(year);
}

function prepareYear(year: number) {
  const months = getRelationshipYearMonths(year);
  if (year !== renderedYear) {
    pickedCell = null;
    pinned = false;
    buildGrid(months, year);
  }
  renderedYear = year;
  cellDates.clear();
  for (const month of months) for (const day of month.days) cellDates.set(day.day, day.date);
  anniversaryDay = months[months.length - 1].days.at(-1)!.day;
}

function describeCell(day: number) {
  const date = cellDates.get(day);
  if (!date) return '';
  const currentYear = Number(todayDate.slice(0, 4));
  const name = day === anniversaryDay
    ? `${anniversaryLabel(renderedYear)} · 第 ${day} 天`
    : `第 ${day} 天`;
  const parts = [day === today ? '今天' : '', spokenDate(date, currentYear), name, momentTitles.get(date) ?? ''];
  if (day > today) parts.push(`还有 ${day - today} 天`);
  return parts.filter(Boolean).join(' · ');
}

/** First and last date of the relationship year currently on screen. */
function viewRange() {
  const days = [...cellDates.keys()];
  if (days.length === 0) return '';
  return `${dotted(cellDates.get(Math.min(...days))!)} — ${dotted(cellDates.get(Math.max(...days))!)}`;
}

/** "已经涂了 N 格" and "这一年共 N 格" describe the year on screen, not always today's. */
function updateYearStats() {
  const days = [...cellDates.keys()];
  const firstDay = days.length ? Math.min(...days) : 1;
  $('[data-filled]')!.textContent = String(Math.min(cellDates.size, Math.max(0, today - firstDay + 1)));
  $('[data-year-total]')!.textContent = String(cellDates.size);
}

function showReadout(day = today, updateNotebook = false) {
  if (!readout) return;
  const inView = cellDates.has(day);
  readout.textContent = inView ? describeCell(day) : viewRange();
  readout.classList.toggle('is-picked', inView && day !== today);
  if (noteJump) noteJump.hidden = !pinned || !inView;
  // While another year is on screen today is not one of its cells, so the control stays live.
  if (returnToday) returnToday.disabled = inView && day === today;
  const date = cellDates.get(day);
  if (date && updateNotebook) document.dispatchEvent(new CustomEvent('journal:date', { detail: date }));
}

function paintGrid() {
  if (!grid) return;
  const cells = $$('[data-day]').filter((cell) => grid.contains(cell));
  let pastCount = 0;
  for (const cell of cells) {
    const day = Number(cell.dataset.day);
    const isPast = day < today;
    cell.classList.toggle('is-past', isPast);
    cell.classList.toggle('is-today', day === today);
    cell.classList.toggle('is-written', writtenDates.has(cellDates.get(day) ?? ''));
    // A steady, scattered tone per day so the filled squares look hand-coloured.
    cell.dataset.tone = String(Math.imul(day, 2654435761) >>> 29 & 3);
    if (isPast) cell.style.setProperty('--n', String(pastCount++));
    else cell.style.removeProperty('--n');
  }
  grid.style.setProperty('--step', `${Math.min(9, 1100 / Math.max(1, pastCount)).toFixed(2)}ms`);
}

if (grid) {
  const pick = (target: EventTarget | null, updateNotebook = false) => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('[data-day]') : null;
    if (!cell) return false;
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
  /** Only the explicit "回到今天" control leaves the year the reader is browsing. */
  const backToToday = () => {
    release();
    if (viewYear === currentYear) return;
    viewYear = currentYear;
    prepareYear(viewYear);
    paintGrid();
    updateYearStats();
    updateYearNav();
    showReadout(today, true);
  };
  returnToday?.addEventListener('click', () => {
    backToToday();
    grid.focus({ preventScroll: true });
  });

  grid.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'mouse' && !pinned) pick(event.target);
  });
  grid.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !pinned) release();
  });
  grid.addEventListener('pointerdown', (event) => {
    ignoreTouchClick = false;
    if (event.pointerType !== 'touch' || touchPointerId !== null) return;
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-day]') : null;
    if (!cell || !grid.contains(cell)) return;
    touchPriorCell = pickedCell;
    touchPriorPinned = pinned;
    pinned = false;
    pick(cell);
    touchPointerId = event.pointerId;
    touchStartX = event.clientX;
    touchStartY = event.clientY;
    touchCell = pickedCell;
    grid.setPointerCapture(event.pointerId);
  });
  grid.addEventListener('pointermove', (event) => {
    if (event.pointerId !== touchPointerId) return;
    const deltaX = Math.abs(event.clientX - touchStartX);
    const deltaY = Math.abs(event.clientY - touchStartY);
    // The mobile grid uses columns for months. Horizontal scrubbing follows that
    // layout while touch-action: pan-y keeps ordinary page scrolling available.
    if (deltaX < 8 || deltaX < deltaY * 1.25) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY);
    if (cell && grid.contains(cell) && pick(cell)) touchCell = pickedCell;
  });
  const finishTouch = (event: PointerEvent, commit: boolean) => {
    if (event.pointerId !== touchPointerId) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY);
    const finalCell = cell instanceof Element ? cell.closest<HTMLElement>('[data-day]') : null;
    if (commit && finalCell && grid.contains(finalCell)) touchCell = finalCell;
    if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
    const selectedCell = touchCell;
    const previousCell = touchPriorCell;
    const wasPinned = touchPriorPinned;
    touchPointerId = null;
    touchCell = null;
    touchPriorCell = null;
    touchPriorPinned = false;
    ignoreTouchClick = true;
    if (!commit || !selectedCell || !grid.contains(selectedCell)) {
      pickedCell?.classList.remove('is-picked');
      pickedCell = wasPinned && previousCell && grid.contains(previousCell) ? previousCell : null;
      pinned = pickedCell !== null;
      pickedCell?.classList.add('is-picked');
      showReadout(pickedCell ? Number(pickedCell.dataset.day) : today);
      return;
    }
    pinned = true;
    pick(selectedCell, true);
    grid.focus({ preventScroll: true });
    if (noteJump) noteJump.hidden = false;
  };
  grid.addEventListener('pointerup', (event) => finishTouch(event, true));
  grid.addEventListener('pointercancel', (event) => finishTouch(event, false));
  grid.addEventListener('click', (event) => {
    // pointerup already commits touch selection; its compatibility click targets the captured grid.
    if (ignoreTouchClick && event.detail > 0) {
      ignoreTouchClick = false;
      return;
    }
    ignoreTouchClick = false;
    // Keep the grid as the keyboard owner after a pick, so arrows work right away.
    if (pick(event.target, true)) {
      pinned = true;
      showReadout(Number(pickedCell!.dataset.day));
      grid.focus({ preventScroll: true });
    }
    else release();
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (pickedCell && !grid.contains(target) && !target.closest('.day-back') && !target.closest('[data-note-jump]')) release();
  });
  noteJump?.addEventListener('click', () => {
    document.querySelector<HTMLElement>('.day-back')?.scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
  });

  // Keyboard days: the grid is one tab stop, arrows walk the cells.
  const move = (target: number) => {
    const days = [...cellDates.keys()];
    const clamped = Math.min(Math.max(...days), Math.max(Math.min(...days), target));
    const cell = grid.querySelector<HTMLElement>(`[data-day="${clamped}"]`);
    if (!cell) return;
    pinned = true;
    pick(cell, true);
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  grid.addEventListener('keydown', (event) => {
    const current = pickedCell?.dataset.day !== undefined ? Number(pickedCell.dataset.day) : today;
    const across = verticalCalendar.matches ? 31 : 1;
    const down = verticalCalendar.matches ? 1 : 31;
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
}

/* ---------- Reviewing another year ---------- */

/**
 * Puts another relationship year on screen without touching the notebook draft.
 * Year 1 is the earliest year the journal can show, and today's year is the last.
 */
function switchYear(year: number) {
  if (year < 1 || year > currentYear || year === viewYear) return;
  viewYear = year;
  prepareYear(viewYear);
  paintGrid();
  updateYearStats();
  updateYearNav();
  showReadout();
}

function updateYearNav() {
  const nav = $('[data-year-nav]');
  const previous = $<HTMLButtonElement>('[data-year-prev]');
  const next = $<HTMLButtonElement>('[data-year-next]');
  if (!nav || !previous || !next) return;
  // Nothing to switch to while the journal is still inside its very first year.
  nav.hidden = currentYear <= 1 && viewYear <= 1;
  previous.disabled = viewYear <= 1;
  next.disabled = viewYear >= currentYear;
}

$('[data-year-prev]')?.addEventListener('click', () => switchYear(viewYear - 1));
$('[data-year-next]')?.addEventListener('click', () => switchYear(viewYear + 1));

/* ---------- Dates ---------- */

let midnightTimer: number | undefined;

function refreshDates() {
  const now = new Date();
  today = getAnniversaryDay(now);
  const upcoming = getUpcomingAnniversary(now);
  const nextIsToday = upcoming.daysRemaining === 0;
  const todayYear = getRelationshipYear(now);
  // Follow the year rollover only while the reader is sitting on the current year.
  if (viewYear === currentYear) viewYear = todayYear;
  currentYear = todayYear;
  prepareYear(viewYear);
  todayDate = cellDates.get(today) ?? upcoming.date;
  for (const element of $$<HTMLTimeElement>('[data-moment-date]')) {
    const future = element.dateTime > todayDate;
    element.closest('li')?.classList.toggle('is-upcoming', future);
    const label = element.closest('li')?.querySelector<HTMLElement>('[data-moment-upcoming]');
    if (label) label.hidden = !future;
  }

  for (const element of $$('[data-day-count]')) element.textContent = String(Math.max(0, today));
  if (countUpDone) $('[data-count-up]')!.textContent = String(Math.max(0, today));

  $('[data-next-title]')!.textContent = upcoming.title;
  $('[data-next-days]')!.textContent = nextIsToday ? '就是今天' : String(upcoming.daysRemaining);
  $('[data-next-prefix]')!.hidden = nextIsToday;
  $('[data-next-suffix]')!.hidden = nextIsToday;
  const nextDate = $<HTMLTimeElement>('[data-next-date]')!;
  nextDate.dateTime = upcoming.date;
  nextDate.textContent = dotted(upcoming.date);

  const hundredthRemaining = hundredthDay - today;
  const letterCount = $('[data-letter-count]')!;
  letterCount.hidden = hundredthRemaining < 0;
  letterCount.innerHTML = hundredthRemaining === 0 ? '就是今天' : `还有 <strong>${hundredthRemaining}</strong> 天`;
  // Once day 100 is behind us the teardown date in the sentence is in the past.
  const letterWait = $('[data-letter-wait]');
  const letterLate = $('[data-letter-late]');
  if (letterWait && letterLate) {
    const past = hundredthRemaining < 0;
    letterWait.hidden = past;
    letterLate.hidden = !past;
  }

  // The stats describe the year on screen, not always the current one.
  updateYearStats();

  paintGrid();
  updateYearNav();
  showReadout(pickedCell ? Number(pickedCell.dataset.day) : today);

  window.clearTimeout(midnightTimer);
  midnightTimer = window.setTimeout(refreshDates, getNextShanghaiMidnight(now).getTime() - now.getTime() + 100);
}

/* ---------- Opening: the day count ticks up once ---------- */

let countUpDone = false;

function countUp() {
  const target = Math.max(0, today);
  const output = $('[data-count-up]')!;
  if (reducedMotion.matches || target === 0) {
    output.textContent = String(target);
    countUpDone = true;
    return;
  }
  const duration = 1500;
  const delay = 950;
  let start = 0;
  const step = (time: number) => {
    start ||= time;
    const progress = Math.min(1, Math.max(0, (time - start - delay) / duration));
    const eased = 1 - Math.pow(1 - progress, 4);
    output.textContent = String(Math.round(eased * target));
    if (progress < 1) requestAnimationFrame(step);
    else countUpDone = true;
  };
  requestAnimationFrame(step);
}

refreshDates();
document.dispatchEvent(new Event('journal:notes-request'));

const momentImageButton = $<HTMLButtonElement>('[data-moment-image]');
momentImageButton?.addEventListener('click', async () => {
  const status = $('[data-moment-image-status]');
  momentImageButton.disabled = true;
  if (status) status.textContent = '正在整理图片…';
  try {
    const entries = $$<HTMLTimeElement>('[data-moment-date]').map((time) => ({
      date: time.dateTime,
      title: time.parentElement?.querySelector('p')?.textContent?.trim() ?? '',
      upcoming: !time.parentElement?.querySelector<HTMLElement>('[data-moment-upcoming]')?.hidden,
    }));
    const blob = await renderMomentImage(entries, relationshipStartDate);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'loveuhqq-记下的日子.png';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (status) status.textContent = '图片已生成，可以从下载记录中打开。';
  } catch {
    if (status) status.textContent = '图片没能生成，请换个浏览器再试。';
  } finally {
    momentImageButton.disabled = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDates();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refreshDates();
});

// The count starts with the rest of the opening: once unlocked and the serif is in.
const whenClassGone = (name: string, event: string) => new Promise<void>((resolve) => {
  if (root.classList.contains(name)) document.addEventListener(event, () => resolve(), { once: true });
  else resolve();
});
Promise.all([whenClassGone('is-locked', 'gate:open'), whenClassGone('fonts-pending', 'fonts:ready')]).then(countUp);

/* ---------- Header ---------- */

const header = $('[data-header]');
const headerDay = $('[data-header-day]');
const heroCount = $('.hero-count');

if (header) {
  let ticking = false;
  const update = () => {
    ticking = false;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) requestAnimationFrame(update);
    ticking = true;
  }, { passive: true });
  update();
}

if ('IntersectionObserver' in window) {
  if (headerDay && heroCount && today > 0) {
    headerDay.hidden = false;
    new IntersectionObserver(([entry]) => {
      headerDay.classList.toggle('is-shown', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }).observe(heroCount);
  }

  const links = $$<HTMLAnchorElement>('.site-nav a');
  const sections = links.map((link) => $(link.hash)).filter((section): section is HTMLElement => Boolean(section));
  const current = new Set<Element>();
  const navObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) current.add(entry.target);
      else current.delete(entry.target);
    }
    const active = sections.find((section) => current.has(section));
    for (const link of links) {
      if (active && link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((section) => navObserver.observe(section));
}

/* ---------- The paper heart ---------- */

const heart = $('[data-heart]');

if (heart) {
  const keepsake = heart.closest<HTMLElement>('.hero-keepsake')!;
  let frame = 0;

  heart.addEventListener('click', (event) => {
    if (reducedMotion.matches) return;
    heart.classList.remove('is-beating');
    void heart.offsetWidth;
    heart.classList.add('is-beating');

    const bounds = keepsake.getBoundingClientRect();
    const originX = event.clientX ? event.clientX - bounds.left : bounds.width / 2;
    const originY = event.clientY ? event.clientY - bounds.top : bounds.height / 2;
    for (let index = 0; index < 7; index += 1) {
      const spark = document.createElement('span');
      const angle = (-90 + (index - 3) * 24 + (Math.random() * 14 - 7)) * (Math.PI / 180);
      const distance = 70 + Math.random() * 60;
      spark.className = 'heart-spark';
      spark.style.left = `${originX}px`;
      spark.style.top = `${originY}px`;
      spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      spark.style.setProperty('--turn', `${Math.round(Math.random() * 60 - 30)}deg`);
      spark.style.setProperty('--size', `${(0.55 + Math.random() * 0.6).toFixed(2)}rem`);
      spark.addEventListener('animationend', () => spark.remove(), { once: true });
      keepsake.append(spark);
    }
  });
  heart.addEventListener('animationend', (event) => {
    if (event.animationName === 'heart-beat') heart.classList.remove('is-beating');
  });

  keepsake.addEventListener('pointermove', (event) => {
    if (!finePointer.matches || reducedMotion.matches || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const bounds = keepsake.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      heart.style.setProperty('--tilt-x', `${(-y * 10).toFixed(2)}deg`);
      heart.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`);
    });
  });
  keepsake.addEventListener('pointerleave', () => {
    cancelAnimationFrame(frame);
    frame = 0;
    heart.style.removeProperty('--tilt-x');
    heart.style.removeProperty('--tilt-y');
  });
}

/* ---------- The sealed letter ---------- */

const envelope = $('[data-envelope]');
const envelopeNote = $('[data-envelope-note]');

if (envelope && envelopeNote) {
  let noteTimer: number | undefined;
  envelope.addEventListener('click', () => {
    envelopeNote.textContent = today < hundredthDay
      ? `还没到拆的时候，${dotted(hundredthDayDate)} 再来。`
      : '信还在写。';
    envelopeNote.classList.add('is-shown');
    envelope.classList.remove('is-wiggling');
    void envelope.offsetWidth;
    envelope.classList.add('is-wiggling');
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => envelopeNote.classList.remove('is-shown'), 3200);
  });
  envelope.addEventListener('animationend', () => envelope.classList.remove('is-wiggling'));
}
