import type { ExceptionItem } from "./rules";
import { countWaitingApprovals } from "@/domains/approvals";

/** One owner-only Today item: admins' requests waiting for a yes or no. Never per request. */
export async function listApprovalAttention(now: Date): Promise<ExceptionItem[]> {
  const waiting = await countWaitingApprovals(now);
  if (waiting <= 0) return [];
  return [{
    category: "APPROVAL_REQUEST", severity: "medium",
    title: `Requests waiting for your approval (${waiting})`,
    detail: "An admin started something at or above your approval limit. Nothing has happened yet; approve it to do it, or decline.",
    href: "/desk/approvals", since: now,
  }];
}
