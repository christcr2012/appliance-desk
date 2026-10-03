import type { Prisma, RentalAgreement, RentalLine } from "@prisma/client";
import { businessEndOfDay } from "@/lib/business-date";

/**
 * What a renewal copies from the agreement it continues. Shared by the renewal an
 * owner drafts by hand and the one the system creates for a customer who agreed to
 * auto-renew, so the two can never drift apart. A deposit is never charged again
 * (the existing one carries over), appliance assignments are not copied (the
 * appliances stay with the current agreement until the renewal takes over), and the
 * renewal starts the business day after the current term ends.
 */
export function renewalCreateData(
  old: Pick<
    RentalAgreement,
    | "customerId"
    | "serviceAddressId"
    | "damageWaiverCents"
    | "lateFeeGraceDays"
    | "lateFeeCents"
    | "lateFeePercent"
    | "taxRateMilliPercent"
    | "endDate"
    | "id"
  >,
  lines: ReadonlyArray<
    Pick<RentalLine, "label" | "monthlyPriceCents" | "listPriceCents" | "prepayDiscountCentsPerMonth">
  >,
  options: {
    termMonths: number | null;
    reservationExpiresAt?: Date | null;
    status?: "DRAFT" | "SCHEDULED";
    createdByAutoRenew?: boolean;
  },
): Prisma.RentalAgreementUncheckedCreateInput {
  if (!old.endDate) throw new Error("Only a fixed-term agreement with a recorded end date can be renewed.");
  return {
    customerId: old.customerId,
    serviceAddressId: old.serviceAddressId,
    termMonths: options.termMonths,
    depositCents: 0,
    damageWaiverCents: old.damageWaiverCents,
    lateFeeGraceDays: old.lateFeeGraceDays,
    lateFeeCents: old.lateFeeCents,
    lateFeePercent: old.lateFeePercent,
    taxRateMilliPercent: old.taxRateMilliPercent,
    paidInFullInAdvance: false,
    freeMonthGranted: false,
    renewedFromAgreementId: old.id,
    // The agreed start: signing the renewal early must not start it early.
    startDate: new Date(businessEndOfDay(old.endDate).getTime() + 1000),
    ...(options.status ? { status: options.status } : {}),
    ...(options.createdByAutoRenew ? { createdByAutoRenew: true } : {}),
    ...(options.reservationExpiresAt !== undefined ? { reservationExpiresAt: options.reservationExpiresAt } : {}),
    lines: {
      create: lines.map((line) => ({
        label: line.label,
        monthlyPriceCents: line.monthlyPriceCents,
        listPriceCents: line.listPriceCents,
        prepayDiscountCentsPerMonth: line.prepayDiscountCentsPerMonth,
      })),
    },
  };
}
