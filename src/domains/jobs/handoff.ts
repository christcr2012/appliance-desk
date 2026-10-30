import type { JobOutcome, JobType } from "@prisma/client";

/**
 * AR-5 section 7: what the desk says right after a visit is finished. The completion action
 * builds the JobHandoff from completeJob's own result (its durable billing hand-offs, the
 * return-close outcome and the agreement's unrefunded deposit); this pure function turns it
 * into the toast. Staff toasts never mention money: the billing line collapses to "Delivered."
 * and the deposit step disappears entirely.
 */
export type JobHandoff = {
  type: JobType;
  outcome: JobOutcome;
  replayed: boolean;
  startedBilling: boolean;
  rentalClosed: boolean;
  depositId: string | null;
  agreementId: string | null;
  maintenanceRequestId: string | null;
};

export type HandoffToast = {
  message: string;
  action?: { label: string; href: string };
};

export function handoffToast(
  handoff: JobHandoff,
  role: "OWNER" | "ADMIN" | "STAFF",
): HandoffToast {
  const ownerOrAdmin = role === "OWNER" || role === "ADMIN";
  const openRental: HandoffToast["action"] = handoff.agreementId
    ? { label: "Open rental", href: `/desk/agreements/${handoff.agreementId}` }
    : undefined;

  if (handoff.replayed) return { message: "Already saved." };

  if (handoff.outcome === "PARTIAL") {
    return {
      message: "Saved. Some items weren't done — a follow-up task was added.",
      action: { label: "Open tasks", href: "/desk/tasks" },
    };
  }

  switch (handoff.type) {
    case "DELIVERY":
    case "INSTALLATION":
      if (handoff.startedBilling && ownerOrAdmin) {
        return { message: "Delivered. Monthly billing starts automatically.", action: openRental };
      }
      return { message: "Delivered.", action: openRental };
    case "REMOVAL":
      if (handoff.rentalClosed) {
        if (handoff.depositId && ownerOrAdmin) {
          return {
            message: "Picked up. The rental is closed — settle the deposit next.",
            action: { label: "Settle deposit", href: `/desk/billing/deposits/${handoff.depositId}` },
          };
        }
        return { message: "Picked up. The rental is closed." };
      }
      return {
        message: "Picked up. Other appliances are still at the customer's.",
        action: openRental,
      };
    case "MAINTENANCE_VISIT":
      return {
        message: "Repair visit finished.",
        action: handoff.maintenanceRequestId
          ? { label: "Open repair request", href: `/desk/maintenance/${handoff.maintenanceRequestId}` }
          : undefined,
      };
    case "SWAP":
      return { message: "Swap finished.", action: openRental };
  }
}
