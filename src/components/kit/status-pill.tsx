// AR-0 kit 4.17: a short status word in a colored pill. With `info`, the pill opens its glossary explanation.
import { GlossaryPopover } from "./glossary-popover";
import { Icon } from "./icons";
import type { GlossaryKey, Tone } from "./types";

export const PILL_TONE: Record<Tone, string> = {
  good: "bg-success-soft text-success",
  attention: "bg-warning-bg text-warning-ink",
  info: "bg-info-soft text-info-ink",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-tint text-ink-soft",
};

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold";

export function StatusPill({ label, tone, info, next }: { label: string; tone: Tone; info?: GlossaryKey; next?: string }) {
  const className = `${PILL} ${PILL_TONE[tone]}`;
  if (!info && !next) {
    return (
      <span className={className} data-tone={tone}>
        {label}
      </span>
    );
  }
  return (
    <GlossaryPopover
      term={info}
      next={next}
      triggerLabel={info ? `${label}: what this means` : `${label}: what happens next`}
      // The invisible ::before grows the tap area to 44 px tall without changing how the pill looks.
      triggerClassName={`${className} relative before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
      trigger={
        <>
          <span>{label}</span>
          <Icon name="info" size={20} className="h-3.5 w-3.5" />
        </>
      }
    />
  );
}
