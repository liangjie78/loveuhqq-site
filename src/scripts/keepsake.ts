import { getAnniversaryDay, getNextShanghaiMidnight, getUpcomingAnniversary } from '../lib/anniversary';
import { photos } from '../data/photos';

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
  document.querySelector<HTMLElement>('#anniversary-title')!.textContent = '下一个值得期待的日子';
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
});
window.addEventListener('pageshow', refreshDates);
window.addEventListener('pagehide', () => window.clearTimeout(midnightTimer));

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
document.addEventListener('click', (event) => {
  if (!(event.target as Element).closest('.site-header')) setMenu(false);
});

const gallery = document.querySelector<HTMLDialogElement>('.photo-dialog')!;
const galleryImage = gallery.querySelector<HTMLImageElement>('[data-gallery-image]')!;
const galleryCaption = gallery.querySelector<HTMLElement>('[data-gallery-caption]')!;
const galleryButton = document.querySelector<HTMLButtonElement>('[data-open-gallery]')!;
let photoIndex = 0;
let galleryTrigger: HTMLElement | null = null;

function showPhoto(index: number) {
  photoIndex = (index + photos.length) % photos.length;
  const photo = photos[photoIndex];
  galleryImage.src = photo.src;
  galleryImage.alt = photo.alt;
  galleryCaption.textContent = photo.title + ' · ' + (photoIndex + 1) + ' / ' + photos.length;
}

function openGallery(index: number, trigger: HTMLElement) {
  galleryTrigger = trigger;
  showPhoto(index);
  gallery.showModal();
  document.body.classList.add('gallery-open');
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
gallery.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    showPhoto(photoIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  }
});
gallery.addEventListener('click', (event) => {
  if (event.target === gallery) {
    const bounds = gallery.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) gallery.close();
  }
});
gallery.addEventListener('close', () => {
  document.body.classList.remove('gallery-open');
  galleryTrigger?.focus({ preventScroll: true });
});
