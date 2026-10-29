import { prisma } from "@/lib/prisma";
import { updateLeadStatus } from "./index";
import { reassignLead } from "./assignment";
import { parseFollowUpKey, setLeadFollowUp } from "./follow-up";

export type BulkLeadKind = "assign" | "follow-up" | "lost";

export type BulkLeadPayload = {
  /** assign: the person to give the leads to (null = unassigned). */
  toUserId?: string | null;
  /** follow-up: the date key to set (null clears the date). */
  dateKey?: string | null;
  /** lost: one reason for every lead. */
  reason?: string;
};

export type BulkLeadResult = {
  done: number;
  failed: { id: string; message: string }[];
};

export const BULK_LEAD_MAX = 200;

/**
 * AR-4b (LEADS.md section 2): the queue's bulk bar. Each lead runs through
 * the existing single-lead domain function in its OWN transaction, so one
 * lead's refusal never rolls back the others; the caller reports
 * "Updated {done} leads" plus the per-lead failures. The follow-up kind
 * reads each lead's current version just before its save — the domain's
 * compare-and-set still guards the write itself, so a lead changed in
 * between lands in `failed` instead of being overwritten.
 */
export async function bulkUpdateLeads(
  actorId: string,
  kind: BulkLeadKind,
  ids: string[],
  payload: BulkLeadPayload,
): Promise<BulkLeadResult> {
  const unique = [...new Set(ids)];
  if (unique.length > BULK_LEAD_MAX) {
    throw new Error(`Choose at most ${BULK_LEAD_MAX} leads at a time.`);
  }
  if (kind === "lost" && !payload.reason?.trim()) {
    throw new Error("Give a reason before marking these leads lost.");
  }
  if (kind === "follow-up" && payload.dateKey) {
    parseFollowUpKey(payload.dateKey, new Date()); // a bad/past date fails the whole call up front
  }

  const failed: { id: string; message: string }[] = [];
  let done = 0;
  for (const id of unique) {
    try {
      if (kind === "assign") {
        await reassignLead(actorId, id, payload.toUserId ?? null);
      } else if (kind === "lost") {
        await updateLeadStatus(actorId, id, "LOST", payload.reason);
      } else {
        const lead = await prisma.lead.findUniqueOrThrow({
          where: { id },
          select: { version: true },
        });
        await setLeadFollowUp(actorId, id, lead.version, payload.dateKey ?? null);
      }
      done += 1;
    } catch (error) {
      failed.push({
        id,
        message: error instanceof Error ? error.message : "Couldn't update this lead.",
      });
    }
  }
  return { done, failed };
}
