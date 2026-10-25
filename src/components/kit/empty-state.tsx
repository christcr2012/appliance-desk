// AR-0 kit 4.11: one line and at most one button. No paragraph (guard 9.3).
import { ActionButton } from "./action-button";
import type { ActionSpec } from "./types";

export function EmptyState({ title, action }: { title: string; action?: ActionSpec }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card bg-surface px-4 py-10 text-center">
      <p className="text-base font-bold text-ink">{title}</p>
      {action ? <ActionButton spec={action} variant="primary" /> : null}
    </div>
  );
}
