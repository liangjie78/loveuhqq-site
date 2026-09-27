import { getAnniversaryDay, getNextShanghaiMidnight, getUpcomingAnniversary } from '../lib/anniversary';
import { photoStatusDescriptions, photoStatusLabels, photos } from '../data/photos';

const counter = document.querySelector<HTMLElement>('[data-anniversary-count]')!;
const day = document.querySelector<HTMLElement>('[data-anniversary-day]')!;
const milestoneTitle = document.querySelector<HTMLElement>('[data-milestone-title]')!;
const milestoneDate = document.querySelector<HTMLTimeElement>('[data-milestone-date]')!;
const milestoneCount = document.querySelector<HTMLElement>('[data-milestone-count]')!;
const milestoneDays = document.querySelector<HTMLElement>('[data-milestone-days]')!;
let midnightTimer: number | undefined;

function refreshDates() {
  const now = new Date();
  const anniversaryDay = getAnniversaryDay(now);
  day.textContent = String(anniversaryDay);
  counter.hidden = anniversaryDay < 1;
  const upcoming = getUpcomingAnniversary(now);
  document.querySelector<HTMLElement>('[data-milestone-heading]')!.textContent = '下一个';
  document.querySelector<HTMLElement>('[data-milestone-ending]')!.textContent = '时间节点。';
  milestoneTitle.textContent = upcoming.title;
  milestoneDate.dateTime = upcoming.date;
  milestoneDate.textContent = upcoming.date.replaceAll('-', '.');
  milestoneDays.textContent = upcoming.daysRemaining === 0 ? '今天' : String(upcoming.daysRemaining);
  document.querySelector<HTMLElement>('[data-milestone-prefix]')!.hidden = upcoming.daysRemaining === 0;
  document.querySelector<HTMLElement>('[data-milestone-suffix]')!.hidden = upcoming.daysRemaining === 0;
  milestoneCount.hidden = false;
  document.querySelector<HTMLElement>('[data-date-fallback]')!.hidden = true;
  window.clearTimeout(midnightTimer);
  midnightTimer = window.setTimeout(refreshDates, getNextShanghaiMidnight(now).getTime() - now.getTime() + 100);
}

refreshDates();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDates();
}, { passive: true });
window.addEventListener('pageshow', refreshDates, { passive: true });
window.addEventListener('pagehide', () => window.clearTimeout(midnightTimer), { passive: true });

const menuToggle = document.querySelector<HTMLButtonElement>('.menu-toggle')!;
const navigation = document.querySelector<HTMLElement>('#site-nav')!;
menuToggle.hidden = false;
document.documentElement.classList.add('has-script');

function setMenu(open: boolean) {
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  navigation.classList.toggle('is-open', open);
}

menuToggle.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
navigation.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuToggle.focus();
  }
});

// 使用事件委托优化
document.addEventListener('click', (event) => {
  if (!(event.target as Element).closest('.site-header')) setMenu(false);
}, { passive: true });

document.addEventListener('focusin', (event) => {
  if (!(event.target as Element).closest('.site-header')) setMenu(false);
}, { passive: true });

window.matchMedia('(max-width: 700px)').addEventListener('change', () => setMenu(false));

const chapters = [...document.querySelectorAll<HTMLElement>('.chapter')];
const chapterLinks = document.querySelectorAll<HTMLAnchorElement>('#site-nav a, .chapter-nav a');
const visibleChapters = new Map<Element, number>();

if ('IntersectionObserver' in window) {
  const chapterObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      visibleChapters.set(entry.target, entry.intersectionRatio);
      if (entry.intersectionRatio >= .15) entry.target.classList.add('is-revealed');
    }
    const current = [...visibleChapters].sort((a, b) => b[1] - a[1])[0];
    if (!current || current[1] === 0) return;
    for (const link of chapterLinks) {
      if (link.hash === '#' + current[0].id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, { threshold: [0, .15, .35, .5, .65, .85, 1] });

  chapters.forEach((chapter) => chapterObserver.observe(chapter));
  document.documentElement.classList.add('motion-ready');
}

const gallery = document.querySelector<HTMLDialogElement>('.photo-dialog')!;
const galleryImage = gallery.querySelector<HTMLImageElement>('[data-gallery-image]')!;
const galleryCaption = gallery.querySelector<HTMLElement>('[data-gallery-caption]')!;
const galleryTitle = gallery.querySelector<HTMLElement>('#gallery-title')!;
const galleryDescription = gallery.querySelector<HTMLElement>('#gallery-description')!;
const galleryButton = document.querySelector<HTMLButtonElement>('[data-open-gallery]')!;
let photoIndex = 0;
let galleryTrigger: HTMLElement | null = null;

function showPhoto(index: number) {
  photoIndex = (index + photos.length) % photos.length;
  const photo = photos[photoIndex];
  galleryImage.src = photo.src;
  galleryImage.alt = photo.alt;
  galleryTitle.textContent = photoStatusLabels[photo.status];
  galleryDescription.textContent = photoStatusDescriptions[photo.status];
  galleryCaption.textContent = photo.title + ' · ' + (photoIndex + 1) + ' / ' + photos.length;
}

function openGallery(index: number, trigger: HTMLElement) {
  galleryTrigger = trigger;
  showPhoto(index);
  gallery.showModal();
  document.documentElement.classList.add('gallery-open');
}

document.querySelectorAll<HTMLAnchorElement>('[data-photo-index]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openGallery(Number(link.dataset.photoIndex), link);
  });
});
galleryButton.hidden = false;
galleryButton.addEventListener('click', () => openGallery(0, galleryButton));
gallery.querySelector('.close-gallery')!.addEventListener('click', () => gallery.close());
gallery.querySelector('[data-gallery-previous]')!.addEventListener('click', () => showPhoto(photoIndex - 1));
gallery.querySelector('[data-gallery-next]')!.addEventListener('click', () => showPhoto(photoIndex + 1));

// 键盘导航优化
gallery.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    showPhoto(photoIndex - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    showPhoto(photoIndex + 1);
  }
});

gallery.addEventListener('click', (event) => {
  if (event.target === gallery) {
    const bounds = gallery.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) gallery.close();
  }
});

gallery.addEventListener('close', () => {
  document.documentElement.classList.remove('gallery-open');
  galleryTrigger?.focus({ preventScroll: true });
});
