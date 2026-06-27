import type { SVGProps } from "react";

/**
 * Custom legal iconography for SignOff.
 *
 * Deliberately not lucide's generic dots/shields — each icon carries an actual
 * legal metaphor (gavel, scales, document fold, signature line, seal). Drawn on
 * a shared 24×24 grid with consistent stroke weight so they sit together as a
 * set. Size is controlled by the caller via `className` (e.g. `h-4 w-4`).
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Gavel — authority, escalation, the partner's call. */
export function Gavel(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 11 8 6l4 4-5 5z" />
      <path d="m5.5 8.5 4 4" />
      <path d="M10 8.5 18 16.5" />
      <path d="M13.5 20.5h7" />
    </svg>
  );
}

/** Scales of justice — weighing precedent, balance, judgement. */
export function Scales(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v16" />
      <path d="M9 21h6" />
      <path d="M6 7.5h12" />
      <path d="m6 7.5-3 5.5h6z" />
      <path d="m18 7.5-3 5.5h6z" />
      <path d="M3 13a3 1.5 0 0 0 6 0" />
      <path d="M15 13a3 1.5 0 0 0 6 0" />
    </svg>
  );
}

/** Document with a folded corner — a matter, a draft, work product. */
export function DocumentFold(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </svg>
  );
}

/** Signature on a baseline — sign-off, the act of committing a decision. */
export function SignatureLine(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 15c1.6 0 1.9-7 3.2-7s.9 6.2 2.1 6.2 1.1-3.6 2.4-3.6 1 2.8 2.1 2.8 1.4-1.9 2.7-1.9" />
      <path d="M3 19.5h18" />
    </svg>
  );
}

/** Seal / rosette — verified, cleared, an attested record. */
export function Seal(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="9" r="6" />
      <path d="m9.5 9 1.7 1.7 3.3-3.4" />
      <path d="m8.5 14 -1.3 6L12 17.5 16.8 20l-1.3-6" />
    </svg>
  );
}

/** Magnifier with rule lines — review, scrutiny of work product. */
export function ReviewGlass(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
      <path d="M8.5 9.5h5" />
      <path d="M8.5 12.5h3" />
    </svg>
  );
}

/** Workstreams converging on a hub — coordination across agents. */
export function Workstreams(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="2.3" />
      <circle cx="12" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="19" r="1.5" />
      <circle cx="19.5" cy="19" r="1.5" />
      <path d="M12 5v4.7" />
      <path d="m10.3 13.4-4.4 4.2" />
      <path d="m13.7 13.4 4.4 4.2" />
    </svg>
  );
}

/** Section mark — legal citation glyph, drawn rather than typeset. */
export function SectionMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 7.5c0-2-1.4-3-3.2-3C9.9 4.5 8.5 5.6 8.5 7.3c0 3.6 7 2.6 7 6.4 0 1.7-1.4 2.8-3.3 2.8-1.8 0-3.2-1-3.2-3" />
    </svg>
  );
}

/** Pillared building — institutions, regulators, statute. */
export function Statute(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m3 8 9-4 9 4z" />
      <path d="M5 8v8" />
      <path d="M10 8v8" />
      <path d="M14 8v8" />
      <path d="M19 8v8" />
      <path d="M3.5 20h17" />
    </svg>
  );
}
