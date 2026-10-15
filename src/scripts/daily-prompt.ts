import { dotted, getShanghaiDate } from '../lib/anniversary';

const prompts = [
  '今天有什么小事，想留在这一页？',
  '今天吃到了什么好吃的？',
  '今天哪一刻，让你松了一口气？',
  '今天有没有一句话，想再记一遍？',
  '今天看到了什么有意思的东西？',
  '今天有什么事，比想象中顺利？',
  '今天有没有一件事，想和对方说说？',
  '今天听到的哪首歌，还留在脑海里？',
  '今天想给明天的自己留句话吗？',
];

const card = document.querySelector<HTMLElement>('[data-daily-prompt]');
if (card) {
  const question = card.querySelector<HTMLElement>('[data-daily-prompt-question]')!;
  const dateLabel = card.querySelector<HTMLTimeElement>('[data-daily-prompt-date]')!;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;

  function refreshDate() {
    const date = getShanghaiDate(new Date());
    if (dateLabel.dateTime === date) return;
    dateLabel.dateTime = date;
    dateLabel.textContent = dotted(date);
  }

  card.querySelector('[data-daily-prompt-next]')!.addEventListener('click', () => {
    index = (index + 1) % prompts.length;
    question.textContent = prompts[index];
    question.classList.remove('is-turning');
    if (!reducedMotion.matches) {
      // Restart the small paper-ink animation even when another click arrives mid-animation.
      void question.offsetWidth;
      question.classList.add('is-turning');
    }
  });
  question.addEventListener('animationend', () => question.classList.remove('is-turning'));
  card.querySelector('[data-daily-prompt-write]')!.addEventListener('click', () => {
    refreshDate();
    document.dispatchEvent(new Event('journal:write-today'));
  });
  refreshDate();
  window.setInterval(() => { if (document.visibilityState === 'visible') refreshDate(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshDate(); });
  window.addEventListener('pageshow', refreshDate);
}
