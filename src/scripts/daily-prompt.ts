const prompts = [
  '这一天有什么小事，想留在这一页？',
  '这一天吃到了什么好吃的？',
  '这一天哪一刻，让你松了一口气？',
  '这一天有没有一句话，想再记一遍？',
  '这一天看到了什么有意思的东西？',
  '这一天有什么事，比想象中顺利？',
  '这一天有没有一件事，想和对方说说？',
  '这一天听到的哪首歌，还留在脑海里？',
  '有什么话，想留给以后的自己？',
];

const card = document.querySelector<HTMLElement>('[data-daily-prompt]');
if (card) {
  const question = card.querySelector<HTMLElement>('[data-daily-prompt-question]')!;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;

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
}
