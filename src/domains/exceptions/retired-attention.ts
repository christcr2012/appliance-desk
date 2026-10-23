import type { ExceptionItem } from "./rules";
import { countRetiredAwaitingDecision } from "@/domains/inventory/retired-plans";

/** One Today item (never one per appliance, never blocking): retired appliances still waiting on a decision. */
export async function listRetiredPlanAttention(now: Date): Promise<ExceptionItem[]> {
  const waiting = await countRetiredAwaitingDecision(now);
  if (waiting <= 0) return [];
  return [{
    category: "RETIRED_APPLIANCE_PLAN", severity: "medium",
    title: `Retired appliances waiting on a decision (${waiting})`,
    detail: "You retired these a while ago and haven't said what happens to them (sell, strip for parts, scrap or throw away) or haven't marked it done. Nothing is blocked; this is just a reminder.",
    href: "/desk/inventory/retired", since: now,
  }];
}
