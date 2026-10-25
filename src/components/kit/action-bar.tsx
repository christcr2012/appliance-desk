// AR-0 kit 4.13: the phone record page's sticky bottom bar (1–2 actions). Hidden on desktop, where the header holds them.
import { ActionButton } from "./action-button";
import type { ActionSpec } from "./types";

export function ActionBar({ actions, label = "Actions" }: { actions: ActionSpec[]; label?: string }) {
  const shown = actions.slice(0, 2);
  if (shown.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className="sticky bottom-0 z-20 -mx-5 mt-4 border-t border-line bg-surface px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className={`grid gap-2 ${shown.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {shown.map((spec, index) => (
          <ActionButton
            key={`${spec.kind}-${spec.label}`}
            spec={spec}
            size="lg"
            variant={spec.primary || (index === 0 && !shown.some((s) => s.primary)) ? "primary" : "secondary"}
            className="w-full"
          />
        ))}
      </div>
    </div>
  );
}
