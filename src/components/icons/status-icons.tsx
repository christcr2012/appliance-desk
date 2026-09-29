// A small set of semantic status icons (2026-09-29 — "finish the icon
// set" from the roadmap). Five icons cover every status this app shows
// anywhere: something finished/approved/good (check), something
// waiting/scheduled (clock), something that needs attention but isn't
// wrong (alert triangle — e.g. "past due," "changes requested"),
// something cancelled/failed/declined (x), and something actively
// happening right now (a simple in-progress arrow). Every status across
// every entity (leads, jobs, maintenance requests, estimates, invoices,
// agreements, purchase orders, appliances) maps to one of these five —
// see src/components/status-badge.tsx for the mapping.
//
// Same drawing conventions as src/components/icons/service-icons.tsx:
// currentColor (so it always matches the surrounding text color,
// including in dark mode), aria-hidden (the real status word is always
// right next to it), sized small (viewBox 0 0 20 20) for inline use next
// to a line of text rather than as a page-header icon.

type IconProps = { className?: string };

const commonProps = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Done, approved, paid, active, resolved — the "good outcome" icon. */
export function StatusSuccessIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M17 10A7 7 0 1 1 3 10A7 7 0 1 1 17 10 M7 10L9 12L13 8" />
    </svg>
  );
}

/** New, waiting, scheduled, awaiting a response — the "not yet" icon. */
export function StatusPendingIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M17 10A7 7 0 1 1 3 10A7 7 0 1 1 17 10 M10 6V10L13 12" />
    </svg>
  );
}

/** Needs attention but isn't a failure — past due, changes requested,
 * high value, low stock. */
export function StatusAttentionIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M10 3L18 17H2ZM10 8V12 M10 14.5V14.6" />
    </svg>
  );
}

/** Cancelled, declined, failed, expired, retired — the "did not happen /
 * stopped" icon. */
export function StatusStoppedIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M17 10A7 7 0 1 1 3 10A7 7 0 1 1 17 10 M7.5 7.5L12.5 12.5 M12.5 7.5L7.5 12.5" />
    </svg>
  );
}

/** Actively happening right now — in progress, being reviewed, being
 * prepared. */
export function StatusInProgressIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M17 6A7 6.99 0 1 0 17.5 10.5 M17 3V6.5H13.5" />
    </svg>
  );
}

/** A small "+" for every "+ New X" / "+ Add X" primary create button
 * across the desk, so the action reads as visually distinct from a
 * plain text link even before you read the words. */
export function PlusIcon({ className = "" }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M10 4V16 M4 10H16" />
    </svg>
  );
}
