import { prisma } from "@/lib/prisma";
import type { RentalAgreementStatus } from "@prisma/client";

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
};

/** Creates a DRAFT agreement shell — rental lines (and the specific
 * appliances they cover) are added afterward with addRentalLine. */
export async function createDraftAgreement(userId: string, input: NewAgreementInput) {
  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: input.customerId,
      serviceAddressId: input.serviceAddressId,
      termMonths: input.termMonths ?? null,
      depositCents: input.depositCents ?? 0,
      damageWaiverCents: input.damageWaiverCents ?? 0,
      lateFeeGraceDays: input.lateFeeGraceDays ?? 5,
      lateFeeCents: input.lateFeeCents ?? 0,
      lateFeePercent: input.lateFeePercent ?? 0,
      taxRatePermille: input.taxRatePermille ?? 0,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "agreement.create",
      entityType: "RentalAgreement",
      entityId: agreement.id,
      newValue: { customerId: input.customerId },
    },
  });

  return agreement;
}

export type NewRentalLineInput = {
  label: string;
  monthlyPriceCents: number;
  applianceIds: string[];
};

/** Adds a line item to a DRAFT agreement and reserves the specific
 * physical appliance(s) it covers (AVAILABLE -> RESERVED) — a set (e.g.
 * washer + dryer) is two appliances on one line. Only allowed while the
 * agreement is still DRAFT, since once it's sent for signature the
 * customer is agreeing to a specific, frozen set of terms. */
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

  const appliances = await prisma.appliance.findMany({
    where: { id: { in: input.applianceIds } },
  });
  const notAvailable = appliances.filter((a) => a.status !== "AVAILABLE");
  if (notAvailable.length > 0) {
    throw new Error(
      `${notAvailable[0].assetNumber} isn't AVAILABLE right now, so it can't be assigned.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const line = await tx.rentalLine.create({
      data: {
        agreementId,
        label: input.label,
        monthlyPriceCents: input.monthlyPriceCents,
      },
    });

    for (const applianceId of input.applianceIds) {
      await tx.applianceAssignment.create({
        data: { rentalLineId: line.id, applianceId },
      });
      await tx.appliance.update({
        where: { id: applianceId },
        data: { status: "RESERVED" },
      });
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.line.add",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: { label: input.label, applianceIds: input.applianceIds },
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
