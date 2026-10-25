// AR-0 kit 4.8: the one thing to do next on a record. Renders nothing when there is no next step.
import { ActionButton } from "./action-button";
import type { ActionSpec } from "./types";

export const NEXT_STEP_EYEBROW = "Next step";

export function NextStepCard({ title, actions, tone }: { title: string; actions: ActionSpec[]; tone?: "attention" | "info" }) {
  if (!title.trim() || actions.length === 0) return null;
  const look =
    tone === "attention"
      ? "bg-warning-bg/40 border border-warning-bg"
      : tone === "info"
        ? "bg-info-soft/50 border border-info-soft"
        : "bg-surface border border-line";
  return (
    <section aria-label={NEXT_STEP_EYEBROW} data-tone={tone ?? "neutral"} className={`rounded-card px-4 py-3.5 ${look}`}>
      <p className={`text-xs font-bold ${tone === "attention" ? "text-warning-ink" : tone === "info" ? "text-info-ink" : "text-ink-soft"}`}>
        {NEXT_STEP_EYEBROW}
      </p>
      <p className="mt-1 text-base font-bold text-ink">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.slice(0, 2).map((spec, index) => (
          <ActionButton key={`${spec.kind}-${spec.label}`} spec={spec} variant={index === 0 ? "primary" : "secondary"} className="flex-1 lg:flex-none" />
        ))}
      </div>
    </section>
  );
}
