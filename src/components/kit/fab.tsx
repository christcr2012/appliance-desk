// AR-0 kit 4.14: the phone list screen's main action, a round "+" button above the bottom bar. Hidden on desktop.
import { ActionButton } from "./action-button";
import type { ActionSpec } from "./types";

export const FAB_CLASS =
  "fixed right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 h-14 w-14 min-h-14 rounded-full px-0 shadow-raise lg:hidden";

export function Fab({ spec }: { spec: ActionSpec }) {
  return <ActionButton spec={spec} variant="primary" iconOnly="plus" className={FAB_CLASS} />;
}
