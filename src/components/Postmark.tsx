import { dotted, relationshipStartDate } from '../lib/anniversary';

interface Props {
  /** Prefix for the SVG ids, unique per page. */
  id: string;
  className?: string;
  /** The gate omits the start date because it is the passphrase. */
  dated?: boolean;
}

export default function Postmark({ id, className, dated = true }: Props) {
  const date = dotted(relationshipStartDate);

  return (
    <svg className={['postmark', className].filter(Boolean).join(' ')} viewBox="0 0 236 124" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-ink`} x="-4%" y="-4%" width="108%" height="108%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.7 1.65" result="mottle" />
          <feComposite in="rough" in2="mottle" operator="in" />
        </filter>
        <path id={`${id}-top`} d="M 23 62 A 39 39 0 0 1 101 62" />
        <path id={`${id}-bottom`} d="M 15 62 A 47 47 0 0 0 109 62" />
      </defs>
      <g filter={`url(#${id}-ink)`}>
        <g fill="none" stroke="currentColor">
          <circle cx="62" cy="62" r="56" strokeWidth="2.6" />
          <circle cx="62" cy="62" r="50.5" strokeWidth="1" />
          <path d="M 14 49 H 110 M 14 75 H 110" strokeWidth="1.2" />
          <path d="M 126 32 q 13 -9 26 0 t 26 0 t 26 0 t 26 0 M 126 52 q 13 -9 26 0 t 26 0 t 26 0 t 26 0 M 126 72 q 13 -9 26 0 t 26 0 t 26 0 t 26 0 M 126 92 q 13 -9 26 0 t 26 0 t 26 0 t 26 0" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <g fill="currentColor" className="postmark-text">
          <text fontSize="10.5" letterSpacing="3.2"><textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle">LOVEUHQQ</textPath></text>
          {dated && <text x="62" y="67.5" textAnchor="middle" fontSize="14" letterSpacing=".6">{date}</text>}
          <text fontSize="10" letterSpacing="5"><textPath href={`#${id}-bottom`} startOffset="50%" textAnchor="middle">第一天</textPath></text>
        </g>
      </g>
    </svg>
  );
}
