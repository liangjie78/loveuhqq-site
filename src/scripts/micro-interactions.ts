const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const heartArea = document.querySelector<HTMLElement>('.hero-visual');
const heartTilt = heartArea?.querySelector<HTMLElement>('.paper-heart-tilt');

if (heartArea && heartTilt) {
  let frame = 0;
  let pointerX = 0;
  let pointerY = 0;

  heartArea.addEventListener('mousemove', (event) => {
    if (!finePointer.matches || reducedMotion.matches) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const bounds = heartArea.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (pointerX - bounds.left - bounds.width / 2) / (bounds.width / 2)));
      const y = Math.max(-1, Math.min(1, (pointerY - bounds.top - bounds.height / 2) / (bounds.height / 2)));
      heartTilt.style.setProperty('--tilt-x', `${(-y * 4).toFixed(2)}deg`);
      heartTilt.style.setProperty('--tilt-y', `${(x * 4).toFixed(2)}deg`);
    });
  });

  const resetTilt = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    heartTilt.style.removeProperty('--tilt-x');
    heartTilt.style.removeProperty('--tilt-y');
  };
  heartArea.addEventListener('mouseleave', resetTilt);
  reducedMotion.addEventListener('change', resetTilt);
  finePointer.addEventListener('change', resetTilt);
}

const heartColors = ['#f472b6', '#fb7185', '#fda4af'];

document.addEventListener('click', (event) => {
  if (reducedMotion.matches || event.detail === 0) return;
  const target = event.target;
  if (target instanceof Element && (target.closest('input, textarea, select') || (target instanceof HTMLElement && target.isContentEditable))) return;

  const heart = document.createElement('span');
  heart.className = 'floating-heart';
  heart.textContent = '♥';
  heart.setAttribute('aria-hidden', 'true');
  heart.style.left = `${event.clientX}px`;
  heart.style.top = `${event.clientY}px`;
  heart.style.setProperty('--heart-color', heartColors[Math.floor(Math.random() * heartColors.length)]);
  heart.style.setProperty('--drift-x', `${Math.round(Math.random() * 24 - 12)}px`);
  heart.style.setProperty('--heart-rotation', `${Math.round(Math.random() * 30 - 15)}deg`);

  const cleanup = () => {
    window.clearTimeout(fallback);
    heart.remove();
  };
  const fallback = window.setTimeout(cleanup, 1000);
  heart.addEventListener('animationend', cleanup, { once: true });
  (document.querySelector('dialog[open]') ?? document.body).append(heart);
});
