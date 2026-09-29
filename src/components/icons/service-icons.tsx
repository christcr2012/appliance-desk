// The brand kit's small service-icon set (2026-09-29, brand kit v2.0
// "Evergreen" — flagged as unused in docs/ROADMAP.md, built once the
// estimates work wrapped up). Six simple line-art icons for the six
// recurring concepts across the desk/portal: an appliance, a scheduled
// visit, a delivery, a home/service address, a property (multi-unit),
// and support/maintenance. Purely decorative — every place these are
// used, the real label is adjacent text, never the icon alone — so each
// one is aria-hidden.
//
// Traced from the brand kit's own
// 03_Design_System/Service-icons/*.svg files, with the hardcoded brand
// color swapped for `currentColor` (same convention as
// src/components/site/appliance-icon.tsx and theme-toggle.tsx) so these
// pick up whatever text color the surrounding element already has —
// including in dark mode, which a hardcoded hex color wouldn't.

type IconProps = { className?: string };

const commonProps = {
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ApplianceServiceIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M6 2H26V30H6ZM6 8H26 M10 5H12 M22 19A6 6 0 1 1 10 19A6 6 0 1 1 22 19" />
    </svg>
  );
}

export function CalendarServiceIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M4 6H28V29H4ZM4 12H28 M10 2V9 M22 2V9 M10 19L14 23L23 16" />
    </svg>
  );
}

export function DeliveryServiceIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M2 8H20V24H2ZM20 14H26L30 19V24H20 M6 28A3 3 0 1 0 6 22A3 3 0 1 0 6 28 M25 28A3 3 0 1 0 25 22A3 3 0 1 0 25 28" />
    </svg>
  );
}

export function HomeServiceIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M2 15L16 3L30 15 M6 12V29H26V12 M12 29V19H20V29" />
    </svg>
  );
}

export function PropertyServiceIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M3 29V7H17V29 M17 14H29V29 M8 12H12 M8 18H12 M21 19H25 M21 24H25 M9 29V24H13V29" />
    </svg>
  );
}

export function SupportServiceIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M5 18V15A11 11 0 0 1 27 15V18 M5 15H2V24H8V15H5 M27 15H30V24H24V15H27 M27 24V28H17" />
    </svg>
  );
}
