/**
 * Splits an element's text into per-character spans for the "develop" reveal.
 * The visual copy is hidden from assistive tech and a plain-text copy is kept,
 * so screen readers never hear the heading one glyph at a time.
 */
export function split(element: HTMLElement): void {
  if (element.dataset.splitDone) return;
  element.dataset.splitDone = 'yes';
  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  let index = 0;
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        for (const char of child.textContent ?? '') {
          if (/\s/.test(char)) { fragment.append(char); continue; }
          const span = document.createElement('span');
          span.className = 'ch';
          span.textContent = char;
          span.style.setProperty('--i', String(index++));
          fragment.append(span);
        }
        child.replaceWith(fragment);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        el.setAttribute('aria-hidden', 'true');
        walk(el);
      }
    }
  };
  walk(element);
  if (!element.querySelector(':scope > .sr-only')) {
    const plain = document.createElement('span');
    plain.className = 'sr-only';
    plain.textContent = text;
    // Wrap direct text spans so only the plain copy is read.
    for (const child of [...element.children]) if (child instanceof HTMLElement && child.classList.contains('ch')) child.setAttribute('aria-hidden', 'true');
    element.append(plain);
  }
}
