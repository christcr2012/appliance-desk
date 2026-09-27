import { prisma } from "@/lib/prisma";
import type { RentalAgreementStatus } from "@prisma/client";
import { getBusinessSettings } from "@/domains/settings";
import {
  calculatePrepayDiscountCentsPerMonth,
  isFreeMonthEarned,
} from "@/domains/pricing/prepay-discount";

// ---------------------------------------------------------------------------
// Rental agreements — Phase 4. See docs/BUSINESS-RULES.md ("How the
// business operates at launch") for the real-world flow this mirrors:
// Chris drafts an agreement, assigns specific physical appliances to it,
// sends it for signature, and once signed it goes ACTIVE and those
// appliances move from RESERVED to RENTED.
//
// E-signature is a lightweight, in-house "typed name + checkbox" capture
// (SignatureRecord.provider = "typed_signature"), not a paid e-signature
// service (SignWell, DocuSign, etc.) — that's a real future upgrade if
// Chris wants a fuller signing/audit experience, but it's a cost decision
// for him to make (see docs/ROADMAP.md), not one to make unasked. This
// still produces a real, timestamped, IP-logged record of agreement.
// ---------------------------------------------------------------------------

const ALLOWED_AGREEMENT_TRANSITIONS: Record<
  RentalAgreementStatus,
  RentalAgreementStatus[]
> = {
  DRAFT: ["AWAITING_SIGNATURE", "CANCELLED"],
  AWAITING_SIGNATURE: ["ACTIVE", "CANCELLED", "DRAFT"],
  ACTIVE: ["ENDED", "CANCELLED"],
  ENDED: [],
  CANCELLED: [],
};

/** Pure — no database access, directly unit-testable (see
 * tests/agreements.test.ts). */
export function canTransitionAgreementStatus(
  from: RentalAgreementStatus,
  to: RentalAgreementStatus,
): { ok: true } | { ok: false; reason: string } {
  if (from === to) {
    return { ok: false, reason: "That's already its current status." };
  }
  if (ALLOWED_AGREEMENT_TRANSITIONS[from].includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Can't move an agreement directly from ${from} to ${to}.`,
  };
}

export async function getAgreements(filter?: { status?: RentalAgreementStatus }) {
  return prisma.rentalAgreement.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      serviceAddress: true,
      lines: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getAgreementById(id: string) {
  return prisma.rentalAgreement.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      serviceAddress: true,
      lines: {
        include: {
          assignments: {
            where: { unassignedAt: null },
            include: { appliance: { include: { applianceType: true } } },
          },
        },
      },
      signature: true,
      jobs: { orderBy: [{ scheduledAt: "asc" }] },
    },
  });
}

export type NewAgreementInput = {
  customerId: string;
  serviceAddressId: string;
  termMonths?: number | null;
  depositCents?: number;
  damageWaiverCents?: number;
  lateFeeGraceDays?: number;
  lateFeeCents?: number;
  lateFeePercent?: number;
  taxRatePermille?: number;
  /** Chris's own attestation that the customer paid the full term in one
   * lump sum up front — only meaningful for a 12-month term (see
   * src/domains/pricing/prepay-discount.ts's comment on why this can't be
   * detected automatically yet). */
  paidInFullInAdvance?: boolean;
};

/** Creates a DRAFT agreement shell — rental lines (and the specific
 * appliances they cover) are added afterward with addRentalLine. Also
 * decides the "first month free" bonus right here (docs/BUSINESS-RULES.md,
 * docs/DECISIONS.md): whether it's earned depends on the term, whether
 * Chris says the customer paid in advance, and the current owner-editable
 * toggle — and that decision is frozen into freeMonthGranted immediately,
 * so a later change to the toggle can never retroactively add or remove
 * the bonus from an agreement that's already been created. */
export async function createDraftAgreement(userId: string, input: NewAgreementInput) {
  const termMonths = input.termMonths ?? null;
  const paidInFullInAdvance = input.paidInFullInAdvance ?? false;

  if (paidInFullInAdvance && termMonths !== 12) {
    throw new Error(
      "Paying in advance for the free-month bonus only applies to a 12-month term.",
    );
  }

  const settings = await getBusinessSettings();
  const freeMonthGranted = isFreeMonthEarned(
    termMonths,
    paidInFullInAdvance,
    settings.twelveMonthPrepayFreeMonthEnabled,
  );

  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: input.customerId,
      serviceAddressId: input.serviceAddressId,
      termMonths,
      depositCents: input.depositCents ?? 0,
      damageWaiverCents: input.damageWaiverCents ?? 0,
      lateFeeGraceDays: input.lateFeeGraceDays ?? 5,
      lateFeeCents: input.lateFeeCents ?? 0,
      lateFeePercent: input.lateFeePercent ?? 0,
      taxRatePermille: input.taxRatePermille ?? 0,
      paidInFullInAdvance,
      freeMonthGranted,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "agreement.create",
      entityType: "RentalAgreement",
      entityId: agreement.id,
      newValue: { customerId: input.customerId, termMonths, paidInFullInAdvance, freeMonthGranted },
    },
  });

  return agreement;
}

export type NewRentalLineInput = {
  label: string;
  /** What this line normally costs, before any prepaid-term discount —
   * what Chris types in on the "new line" form. The actual amount charged
   * (monthlyPriceCents) is computed server-side from this, never trusted
   * from the client. */
  listPriceCents: number;
  applianceIds: string[];
};

/** Adds a line item to a DRAFT agreement and reserves the specific
 * physical appliance(s) it covers (AVAILABLE -> RESERVED) — a set (e.g.
 * washer + dryer) is two appliances on one line. Only allowed while the
 * agreement is still DRAFT, since once it's sent for signature the
 * customer is agreeing to a specific, frozen set of terms.
 *
 * Also computes and snapshots the prepaid-term discount right here (see
 * docs/BUSINESS-RULES.md's Pricing section and
 * src/domains/pricing/prepay-discount.ts) — based on the agreement's own
 * termMonths (already fixed by createDraftAgreement) and whether this
 * particular line is a "set" (2+ appliances). Since a line can only be
 * added/removed while the agreement is DRAFT, this discount is frozen the
 * same way monthlyPriceCents itself already was before this feature
 * existed — no separate "snapshot at signing" step needed. */
export async function addRentalLine(
  userId: string,
  agreementId: string,
  input: NewRentalLineInput,
) {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
  });
  if (agreement.status !== "DRAFT") {
    throw new Error("Can only add appliances to a draft agreement.");
  }
  if (input.applianceIds.length === 0) {
    throw new Error("Choose at least one appliance for this line.");
  }

  const settings = await getBusinessSettings();
  const prepayDiscountCentsPerMonth = calculatePrepayDiscountCentsPerMonth(
    agreement.termMonths,
    input.applianceIds.length,
    settings,
  );
  const monthlyPriceCents = Math.max(0, input.listPriceCents - prepayDiscountCentsPerMonth);

  return prisma.$transaction(async (tx) => {
    const line = await tx.rentalLine.create({
      data: {
        agreementId,
        label: input.label,
        listPriceCents: input.listPriceCents,
        prepayDiscountCentsPerMonth,
        monthlyPriceCents,
      },
    });

    for (const applianceId of input.applianceIds) {
      // Atomic check-and-reserve (Verified Finding #3 fix): the WHERE
      // clause requires the appliance to still be AVAILABLE at the moment
      // of this update, and `count` tells us whether a row actually
      // matched. A plain "read status, then decide" check (what used to
      // happen here, before the transaction even opened) lets two
      // concurrent calls both see AVAILABLE and both "win" — only a
      // conditional update enforced by the database itself can guarantee
      // just one of them actually does. If we lose the race, abort the
      // whole transaction (the line and any appliances already reserved
      // in this same loop all roll back) rather than double-book a
      // physical appliance onto two agreements.
      const reserved = await tx.appliance.updateMany({
        where: { id: applianceId, status: "AVAILABLE" },
        data: { status: "RESERVED" },
      });
      if (reserved.count !== 1) {
        const appliance = await tx.appliance.findUnique({ where: { id: applianceId } });
        throw new Error(
          appliance
            ? `${appliance.assetNumber} isn't AVAILABLE right now, so it can't be assigned.`
            : "That appliance no longer exists.",
        );
      }

      await tx.applianceAssignment.create({
        data: { rentalLineId: line.id, applianceId },
      });
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.line.add",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: {
          label: input.label,
          applianceIds: input.applianceIds,
          listPriceCents: input.listPriceCents,
          prepayDiscountCentsPerMonth,
          monthlyPriceCents,
        },
      },
    });

    return line;
  });
}

/** Removes a line from a still-DRAFT agreement and frees its appliances
 * back to AVAILABLE. */
export async function removeRentalLine(userId: string, lineId: string) {
  const line = await prisma.rentalLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { agreement: true, assignments: true },
  });
  if (line.agreement.status !== "DRAFT") {
    throw new Error("Can only remove appliances from a draft agreement.");
  }

  return prisma.$transaction(async (tx) => {
    for (const assignment of line.assignments) {
      if (!assignment.unassignedAt) {
        await tx.applianceAssignment.update({
          where: { id: assignment.id },
          data: { unassignedAt: new Date(), unassignReason: "Line removed" },
        });
        await tx.appliance.update({
          where: { id: assignment.applianceId },
          data: { status: "AVAILABLE" },
        });
      }
    }
    await tx.rentalLine.delete({ where: { id: lineId } });

    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.line.remove",
        entityType: "RentalAgreement",
        entityId: line.agreementId,
        oldValue: { label: line.label },
      },
    });
  });
}

/** Moves a DRAFT agreement to AWAITING_SIGNATURE and creates the
 * SignatureRecord that doubles as the public signing link's token
 * (its cuid id is unguessable, and getSignatureRecordForSigning refuses
 * to serve it once it's already signed or the agreement isn't awaiting
 * signature — see the note at the top of this file re: e-signature). */
export async function sendForSignature(userId: string, agreementId: string) {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: { lines: true },
  });
  if (agreement.status !== "DRAFT") {
    throw new Error("Only a draft agreement can be sent for signature.");
  }
  if (agreement.lines.length === 0) {
    throw new Error("Add at least one appliance to this agreement first.");
  }

  return prisma.$transaction(async (tx) => {
    const signature = await tx.signatureRecord.create({
      data: {
        agreementId,
        provider: "typed_signature",
      },
    });
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: { status: "AWAITING_SIGNATURE" },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.send_for_signature",
        entityType: "RentalAgreement",
        entityId: agreementId,
      },
    });
    return signature;
  });
}

/** Loads what the public /sign/[id] page needs — only while the
 * signature is genuinely still pending, so a link can't be reused after
 * signing or if Chris pulled the agreement back to DRAFT. */
export async function getSignatureRecordForSigning(id: string) {
  const signature = await prisma.signatureRecord.findUnique({
    where: { id },
    include: {
      agreement: {
        include: {
          customer: { include: { user: { select: { name: true, email: true } } } },
          serviceAddress: true,
          lines: true,
        },
      },
    },
  });
  if (!signature || signature.signedAt) return null;
  if (signature.agreement.status !== "AWAITING_SIGNATURE") return null;
  return signature;
}

export type SignAgreementInput = {
  signerName: string;
  signerEmail: string;
  ipAddress: string | null;
};

/** The customer's actual signing action — no login required (the
 * customer portal doesn't exist yet, Phase 5), gated entirely by having
 * the unguessable signature-record link. Moves the agreement ACTIVE and
 * every appliance it covers from RESERVED to RENTED. */
export async function signAgreement(signatureRecordId: string, input: SignAgreementInput) {
  const signature = await getSignatureRecordForSigning(signatureRecordId);
  if (!signature) {
    throw new Error("This agreement isn't available to sign right now.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.signatureRecord.update({
      where: { id: signatureRecordId },
      data: {
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        ipAddress: input.ipAddress,
        signedAt: new Date(),
      },
    });

    await tx.rentalAgreement.update({
      where: { id: signature.agreementId },
      data: { status: "ACTIVE", startDate: new Date() },
    });

    const lines = await tx.rentalLine.findMany({
      where: { agreementId: signature.agreementId },
      include: { assignments: { where: { unassignedAt: null } } },
    });
    for (const line of lines) {
      for (const assignment of line.assignments) {
        await tx.appliance.update({
          where: { id: assignment.applianceId },
          data: { status: "RENTED" },
        });
      }
    }

    // System-triggered by the customer, not a logged-in desk user — see
    // docs/DATABASE.md, AuditLog.userId is nullable for exactly this.
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "agreement.sign",
        entityType: "RentalAgreement",
        entityId: signature.agreementId,
        newValue: { signerName: input.signerName, signerEmail: input.signerEmail },
      },
    });

    return signature.agreementId;
  });
}

/** Ends or cancels an agreement, freeing every appliance it still has
 * assigned back to AVAILABLE. Shared by endAgreement/cancelAgreement
 * since the appliance-freeing logic is identical either way. */
async function closeAgreement(
  userId: string,
  agreementId: string,
  newStatus: "ENDED" | "CANCELLED",
) {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
  });
  const check = canTransitionAgreementStatus(agreement.status, newStatus);
  if (!check.ok) {
    throw new Error(check.reason);
  }

  return prisma.$transaction(async (tx) => {
    const lines = await tx.rentalLine.findMany({
      where: { agreementId },
      include: { assignments: { where: { unassignedAt: null } } },
    });
    for (const line of lines) {
      for (const assignment of line.assignments) {
        await tx.applianceAssignment.update({
          where: { id: assignment.id },
          data: { unassignedAt: new Date(), unassignReason: `Agreement ${newStatus.toLowerCase()}` },
        });
        await tx.appliance.update({
          where: { id: assignment.applianceId },
          data: { status: "AVAILABLE" },
        });
      }
    }

    const updated = await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        status: newStatus,
        endDate: newStatus === "ENDED" ? new Date() : agreement.endDate,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: newStatus === "ENDED" ? "agreement.end" : "agreement.cancel",
        entityType: "RentalAgreement",
        entityId: agreementId,
        oldValue: { status: agreement.status },
        newValue: { status: newStatus },
      },
    });

    return updated;
  });
}

export async function endAgreement(userId: string, agreementId: string) {
  return closeAgreement(userId, agreementId, "ENDED");
}

export async function cancelAgreement(userId: string, agreementId: string) {
  return closeAgreement(userId, agreementId, "CANCELLED");
}
