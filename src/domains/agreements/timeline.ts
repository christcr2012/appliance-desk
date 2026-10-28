// AR-4a (RENTALS spec section 3, Activity tab): the rental's own timeline
// from its audit rows. OWNER/ADMIN only — audit rows can name money and
// settings facts staff do not see. Newest 30.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/** Short words for every agreement.* audit action the code writes today.
 * Unknown keys fall back to "Rental updated". A test greps the codebase for
 * agreement.* action literals and fails if one is missing here (the two
 * settings keys ending_notice_days/unsigned_follow_up_days never appear on
 * a rental's own rows, so they are excluded on purpose). */
export const RENTAL_EVENT_WORDS: Record<string, string> = {
  "agreement.create": "Rental started as a draft",
  "agreement.line.add": "Appliance added",
  "agreement.line.remove": "Appliance removed",
  "agreement.item_cancelled": "Item cancelled",
  "agreement.signing_charges_prepared": "Signing charges prepared",
  "agreement.signing_setup_fee_override": "Setup fee changed",
  "agreement.send_for_signature": "Sent for signature",
  "agreement.sign": "Signed by the customer",
  "agreement.extend_reservation": "Hold extended",
  "agreement.pre_delivery_cancellation_approved": "Cancellation approved",
  "agreement.pre_delivery_refund_reconciled": "Cancellation refund matched",
  "agreement.pickup_visit_created": "Pickup visit added",
  "agreement.ending_pickup_chosen": "Pickup chosen at the end of the term",
  "agreement.renewal_drafted": "Renewal drafted",
  "agreement.renewal_started": "Renewal started",
  "agreement.auto_renewal_scheduled": "Automatic renewal scheduled",
  "agreement.auto_renew_enabled": "Auto-renew turned on",
  "agreement.auto_renew_disabled": "Auto-renew turned off",
  "agreement.termination_requested": "Customer asked to end",
  "agreement.month_to_month_end_requested": "End of month-to-month requested",
  "agreement.termination_fee_invoiced": "Early-ending fee billed",
  "agreement.early_return_resolved": "Early return settled",
  "agreement.early_return_fee_voided": "Early-return fee removed",
  "agreement.delivery_choices": "Delivery choices saved",
  "agreement.end": "Rental ended",
  "agreement.cancel": "Rental cancelled",
  "agreement.end_reason_set": "End reason noted",
};

export type RentalTimelineItem = {
  id: string;
  title: string;
  at: Date;
  actor: string;
};

export async function getRentalTimeline(
  agreementId: string,
): Promise<RentalTimelineItem[]> {
  await requireRole("OWNER", "ADMIN");
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "RentalAgreement", entityId: agreementId },
    select: {
      id: true,
      action: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
  });
  return rows.map((row) => ({
    id: row.id,
    title: RENTAL_EVENT_WORDS[row.action] ?? "Rental updated",
    at: row.createdAt,
    actor: row.user?.name ?? row.user?.email ?? "automatic",
  }));
}
