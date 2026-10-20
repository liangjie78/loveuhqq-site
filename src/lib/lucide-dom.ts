import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LucideIcon } from 'lucide-react';

export function lucideSvg(Icon: LucideIcon, size = 16): SVGSVGElement {
  const markup = renderToStaticMarkup(createElement(Icon, { size, 'aria-hidden': true, focusable: false }));
  const template = document.createElement('template') as HTMLTemplateElement;
  if (!('content' in template)) return document.createElement('span') as unknown as SVGSVGElement;
  template.innerHTML = markup;
  return template.content.firstElementChild as SVGSVGElement;
}
