/** Hand-drawn 16px stroke icons — no icon library, so weight and metrics stay consistent. */
import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  className: "icon",
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const Lib = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" /></svg>
);
export const Compass = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="6" /><path d="M10.5 5.5 9 9l-3.5 1.5L7 7z" /></svg>
);
export const Plug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 2v3m4-3v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" /></svg>
);
export const Scroll = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 2.5h8v9a2 2 0 0 1-2 2H5.5M4 2.5A1.5 1.5 0 0 0 2.5 4v1.5H4m8 8a2 2 0 0 0 2-2V11h-2" /></svg>
);
export const Gear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2m0 9v2m6.5-6.5h-2m-9 0h-2m11-4.6-1.4 1.4M4.9 11.1l-1.4 1.4m0-9 1.4 1.4m6.2 6.2 1.4 1.4" /></svg>
);
export const Search = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
);
export const Refresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13 7a5 5 0 1 0-.6 3.4M13 4v3h-3" /></svg>
);
export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 3.5v9M3.5 8h9" /></svg>
);
export const Play = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 3.5 12 8l-7 4.5z" /></svg>
);
export const ExternalLink = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" /></svg>
);
export const Dots = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none"/></svg>
);
export const Weave = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2.5 5.5c2 0 3-2 5.5-2s3.5 2 5.5 2M2.5 10.5c2 0 3-2 5.5-2s3.5 2 5.5 2" /></svg>
);
export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m3.5 8.5 3 3 6-7" /></svg>
);
export const Alert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 5.5v3.5M8 11.5h.01M8 2 1.5 13.5h13z" /></svg>
);
