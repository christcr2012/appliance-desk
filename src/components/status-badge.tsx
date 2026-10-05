import {
  StatusSuccessIcon,
  StatusPendingIcon,
  StatusAttentionIcon,
  StatusStoppedIcon,
  StatusInProgressIcon,
} from "@/components/icons/status-icons";

/**
 * One shared way to show a status anywhere in the owner desk or
 * customer portal (2026-09-29 — "finish the icon set" from the
 * roadmap). Before this, every page that showed a colored status badge
 * (leads, estimates, purchase orders, invoices, inventory, jobs) had
 * its own copy-pasted color map and no icon — this replaces all of
 * those with one component, so a status always looks the same
 * everywhere it appears and always carries a small icon, not just
 * color (color alone isn't accessible to someone who can't distinguish
 * colors well).
 *
 * `tone` is the five outcomes every status in this app boils down to —
 * see src/components/icons/status-icons.tsx's own comment for what
 * each one means. Each page maps its own status enum to a tone (a
 * small local `Record<ItsStatus, Tone>`), then renders
 * `<StatusBadge tone={...} label={...} />`.
 */

export type StatusTone = "success" | "pending" | "attention" | "stopped" | "progress";

type IconComponent = (props: { className?: string }) => ReturnType<typeof StatusSuccessIcon>;

const TONE_ICON: Record<StatusTone, IconComponent> = {
  success: StatusSuccessIcon,
  pending: StatusPendingIcon,
  attention: StatusAttentionIcon,
  stopped: StatusStoppedIcon,
  progress: StatusInProgressIcon,
};

const TONE_TEXT_COLOR: Record<StatusTone, string> = {
  success: "text-green-700",
  pending: "text-blue-700",
  attention: "text-amber-700",
  stopped: "text-ink-faint",
  progress: "text-amber-700",
};

const TONE_PILL_COLOR: Record<StatusTone, string> = {
  success: "bg-green-100 text-green-800",
  pending: "bg-blue-100 text-blue-800",
  attention: "bg-amber-100 text-amber-800",
  stopped: "bg-canvas-alt text-ink-soft",
  progress: "bg-amber-100 text-amber-800",
};

export function StatusBadge({
  tone,
  label,
  variant = "text",
  className = "",
}: {
  tone: StatusTone;
  label: string;
  /** "text" — small icon + colored text, no background (matches most
   * list pages already in this app). "pill" — the rounded colored
   * background badge a few pages already used. */
  variant?: "text" | "pill";
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  if (variant === "pill") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_PILL_COLOR[tone]} ${className}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 ${TONE_TEXT_COLOR[tone]} ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  );
}
