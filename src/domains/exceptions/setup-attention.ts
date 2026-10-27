import type { ExceptionItem } from "./rules";
import { getSetupGuideState } from "@/domains/setup/guide";
import { getWalkthrough } from "@/domains/setup/walkthroughs";

/**
 * SETUP-1: one To do naming the suggested next setup walkthrough, until
 * every walkthrough is done or the owner marks it "Not for me". Owner only
 * (gated at the call site in index.ts, like continuity).
 */
export async function listSetupGuideAttention(now = new Date()): Promise<ExceptionItem[]> {
  const state = await getSetupGuideState(now);
  if (!state.suggestedKey) return [];
  const next = getWalkthrough(state.suggestedKey);
  if (!next) return [];
  const remaining = state.totalWalkthroughs - state.finishedCount;
  return [
    {
      category: "SETUP_GUIDE",
      severity: "low",
      title: `Set up: ${next.title}`,
      detail: `${state.finishedCount} of ${state.totalWalkthroughs} walkthroughs finished — ${remaining} to go. This one unlocks: ${next.unlocks[0] ?? next.why}`,
      href: `/desk/setup-guide/${next.key}`,
      since: now,
    },
  ];
}