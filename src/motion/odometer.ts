/** Rolling-digit counter. Each digit is a column that slides to its value. */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function odometer(element: HTMLElement, value: number, delay = 0): void {
  const text = String(Math.max(0, Math.round(value)));
  element.setAttribute('aria-label', text);
  if (calm() || !element.isConnected) { element.textContent = text; return; }
  const previous = element.querySelectorAll('.odo-col').length;
  if (previous !== text.length) {
    element.replaceChildren(...[...text].map(() => {
      const col = document.createElement('span');
      col.className = 'odo-col';
      col.setAttribute('aria-hidden', 'true');
      for (let n = 0; n <= 9; n++) { const d = document.createElement('span'); d.textContent = String(n); col.append(d); }
      return col;
    }));
    element.classList.add('odo');
    void element.offsetWidth;
  }
  [...element.querySelectorAll<HTMLElement>('.odo-col')].forEach((col, index) => {
    col.style.transitionDelay = `${delay + index * 90}ms`;
    col.style.transform = `translateY(${-Number(text[index]) * 10}%)`;
  });
}
