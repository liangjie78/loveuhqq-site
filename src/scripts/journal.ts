import {
  dotted,
  getAnniversaryDay,
  getNextShanghaiMidnight,
  getRelationshipYear,
  getRelationshipYearMonths,
  getUpcomingAnniversary,
  hundredthDayDate,
  monthNames,
  type CalendarMonth,
} from '../lib/anniversary';
import { momentTitles } from '../data/moments';

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
const verticalCalendar = window.matchMedia('(max-width: 640px)');
const cellDates = new Map<number, string>();
let renderedYear = 1;
let anniversaryDay = 0;
let today = 0;
let todayDate = '';
let pickedCell: HTMLElement | null = null;

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
  if (year !== renderedYear) buildGrid(months, year);
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

function showReadout(day = today) {
  if (!readout) return;
  readout.textContent = cellDates.has(day) ? describeCell(day) : `从 ${dotted(cellDates.get(1) ?? '')} 开始`;
  readout.classList.toggle('is-picked', day !== today);
  if (returnToday) returnToday.disabled = day === today;
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
    // A steady, scattered tone per day so the filled squares look hand-coloured.
    cell.dataset.tone = String(Math.imul(day, 2654435761) >>> 29 & 3);
    if (isPast) cell.style.setProperty('--n', String(pastCount++));
    else cell.style.removeProperty('--n');
  }
  grid.style.setProperty('--step', `${Math.min(9, 1100 / Math.max(1, pastCount)).toFixed(2)}ms`);
}

if (grid) {
  let pinned = false;
  const pick = (target: EventTarget | null) => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('[data-day]') : null;
    if (!cell) return false;
    pickedCell?.classList.remove('is-picked');
    pickedCell = cell;
    cell.classList.add('is-picked');
    showReadout(Number(cell.dataset.day));
    return true;
  };
  const release = () => {
    pinned = false;
    pickedCell?.classList.remove('is-picked');
    pickedCell = null;
    showReadout();
  };
  returnToday?.addEventListener('click', () => {
    release();
    grid.focus({ preventScroll: true });
  });

  grid.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'mouse' && !pinned) pick(event.target);
  });
  grid.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !pinned) release();
  });
  grid.addEventListener('click', (event) => {
    // Keep the grid as the keyboard owner after a pick, so arrows work right away.
    if (pick(event.target)) {
      pinned = true;
      grid.focus({ preventScroll: true });
    }
    else release();
  });
  document.addEventListener('click', (event) => {
    if (pickedCell && !grid.contains(event.target as Node)) release();
  });

  // Keyboard days: the grid is one tab stop, arrows walk the cells.
  const move = (target: number) => {
    const days = [...cellDates.keys()];
    const clamped = Math.min(Math.max(...days), Math.max(Math.min(...days), target));
    const cell = grid.querySelector<HTMLElement>(`[data-day="${clamped}"]`);
    if (!cell) return;
    pinned = true;
    pick(cell);
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

/* ---------- Dates ---------- */

let midnightTimer: number | undefined;

function refreshDates() {
  const now = new Date();
  today = getAnniversaryDay(now);
  const upcoming = getUpcomingAnniversary(now);
  const nextIsToday = upcoming.daysRemaining === 0;
  prepareYear(getRelationshipYear(now));
  todayDate = cellDates.get(today) ?? upcoming.date;

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

  const firstDay = cellDates.keys().next().value ?? 1;
  $('[data-filled]')!.textContent = String(Math.max(0, today - firstDay + 1));
  $('[data-year-total]')!.textContent = String(cellDates.size);

  paintGrid();
  if (!pickedCell) showReadout();

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
