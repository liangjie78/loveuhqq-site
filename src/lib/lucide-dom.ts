import { createElement } from 'lucide';

export type LucideIconNode = Parameters<typeof createElement>[0];

export function lucideSvg(iconNode: LucideIconNode, size = 16): SVGSVGElement {
  return createElement(iconNode, { width: size, height: size, 'stroke-width': 1.5, 'aria-hidden': 'true', focusable: 'false' }) as SVGSVGElement;
}
