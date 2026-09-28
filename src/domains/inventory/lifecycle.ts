import type { ApplianceStatus, JobType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Appliance lifecycle rules (2026-09-28) — pure, zero-database-import, so
// both server code and client components can use the exact same rules
// (never a hand-copied mirror that can drift). See docs/BUSINESS-RULES.md's
// "Rental lifecycle" section for the real-world flow these encode:
//
//   AVAILABLE → RESERVED (assigned to a draft agreement)
//            → RENTED (delivery/installation job completed — NOT at signing)
//            → AWAITING_PICKUP (agreement ended, machine still at the customer's)
//            → AWAITING_INSPECTION (removal job completed, machine back in the shop)
//            → AVAILABLE (inspection passed) or MAINTENANCE (inspection failed)
//
// Why this exists: a code review (docs/reviews/2026-09-27-astra-code-review.md)
// correctly pointed out that signing used to mark machines RENTED before
// they were ever delivered, and ending an agreement used to make machines
// AVAILABLE — rentable to someone else — while they were still physically
// sitting at the previous customer's property.
// ---------------------------------------------------------------------------

export const ALL_APPLIANCE_STATUSES: ApplianceStatus[] = [
  "AVAILABLE",
  "RESERVED",
  "RENTED",
  "AWAITING_PICKUP",
  "AWAITING_INSPECTION",
  "MAINTENANCE",
  "RETIRED",
];

export const APPLIANCE_STATUS_LABELS: Record<ApplianceStatus, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  RENTED: "Rented",
  AWAITING_PICKUP: "Awaiting pickup",
  AWAITING_INSPECTION: "Awaiting inspection",
  MAINTENANCE: "In repair",
  RETIRED: "Retired",
};

/**
 * Which manual status changes are allowed — enforced on the server by
 * updateApplianceStatus, and read by the appliance page to decide which
 * buttons to show. RETIRED is terminal (a disposed unit doesn't come back;
 * add a new unit instead). A returned machine can't jump straight back to
 * AVAILABLE without going through inspection — that's the whole point of
 * the lifecycle above.
 */
export const ALLOWED_APPLIANCE_TRANSITIONS: Record<ApplianceStatus, ApplianceStatus[]> = {
  AVAILABLE: ["RESERVED", "RENTED", "MAINTENANCE", "RETIRED"],
  RESERVED: ["AVAILABLE", "RENTED", "MAINTENANCE", "RETIRED"],
  RENTED: ["AWAITING_PICKUP", "AWAITING_INSPECTION", "MAINTENANCE", "RETIRED"],
  AWAITING_PICKUP: ["AWAITING_INSPECTION", "RETIRED"],
  AWAITING_INSPECTION: ["AVAILABLE", "MAINTENANCE", "RETIRED"],
  // A repair can finish either in the shop (back to AVAILABLE, or through
  // inspection first) or on-site at a renting customer's home (back to
  // RENTED).
  MAINTENANCE: ["AVAILABLE", "AWAITING_INSPECTION", "RENTED", "RETIRED"],
  RETIRED: [],
};

export function canTransitionApplianceStatus(
  from: ApplianceStatus,
  to: ApplianceStatus,
): { ok: true } | { ok: false; reason: string } {
  if (from === to) {
    return { ok: false, reason: "That's already its current status." };
  }
  if (ALLOWED_APPLIANCE_TRANSITIONS[from].includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Can't move an appliance directly from "${APPLIANCE_STATUS_LABELS[from]}" to "${APPLIANCE_STATUS_LABELS[to]}".`,
  };
}

/**
 * What happens to one of an agreement's appliances when that agreement is
 * ended or cancelled. A machine that was actually delivered (RENTED) is
 * still at the customer's property, so it waits for pickup; one that was
 * only ever reserved (never delivered) is free immediately. Anything else
 * (already in repair, etc.) is left alone. Returns null for "no change".
 */
export function applianceStatusOnAgreementClose(
  current: ApplianceStatus,
): ApplianceStatus | null {
  if (current === "RENTED") return "AWAITING_PICKUP";
  if (current === "RESERVED") return "AVAILABLE";
  return null;
}

/**
 * What happens to a job's appliances automatically when the job is marked
 * COMPLETED. Returns null for "no automatic change" — maintenance visits
 * and swaps are left to Chris to decide (the job page still offers a
 * suggested next status for those).
 */
export function applianceStatusOnJobCompleted(
  jobType: JobType,
  current: ApplianceStatus,
): ApplianceStatus | null {
  if (jobType === "DELIVERY" || jobType === "INSTALLATION") {
    return current === "RESERVED" ? "RENTED" : null;
  }
  if (jobType === "REMOVAL") {
    return current === "AWAITING_PICKUP" || current === "RENTED"
      ? "AWAITING_INSPECTION"
      : null;
  }
  return null;
}

/** An inspection either clears a returned machine to be rented again, or
 * sends it for repair. */
export function applianceStatusAfterInspection(passed: boolean): ApplianceStatus {
  return passed ? "AVAILABLE" : "MAINTENANCE";
}

/** The default return-inspection checklist, used until Chris edits his
 * own list in /desk/settings. */
export const DEFAULT_INSPECTION_CHECKLIST: string[] = [
  "Cleaned inside and out",
  "Runs a full cycle without errors",
  "No leaks",
  "Hoses, cords, and vents intact",
  "Door, seals, and controls work",
];
