import { ActionButton } from "@/components/kit";
import type { SetupChecklist } from "@/domains/setup/checklist";

/**
 * "Set up your business": shown to the owner on Today until every step is done (W-7). One line with how many steps
 * are done and a Continue button that opens the first step not done yet. It only reads; it never changes a setting.
 */
export function SetupCard({ checklist }: { checklist: SetupChecklist }) {
  if (checklist.complete) return null;
  const next = checklist.steps.find((step) => !step.done) ?? checklist.steps[0];
  if (!next) return null;
  return (
    <section
      aria-label="Set up your business"
      data-testid="setup-card"
      className="flex items-center gap-3 rounded-card border border-info-soft bg-info-soft/50 px-4 py-3.5"
    >
      <p className="min-w-0 flex-1 text-[15px] font-bold text-ink">
        Set up your business · <span className="tabular-nums">{checklist.doneCount} of {checklist.total}</span> done
      </p>
      <ActionButton spec={{ kind: "link", label: "Continue", href: next.href }} variant="primary" />
    </section>
  );
}
