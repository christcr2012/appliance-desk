import { draftRequestId } from "./draft-request";
import { buildTermsSnapshot } from "./terms-snapshot";
import { requireRole } from "@/lib/session";
import { fixedTermEndDate } from "@/lib/business-date";
import {
  applySubscriptionEnds,
  recomputeForAgreementInTx,
} from "@/domains/billing/subscription-end";
import { createSignedAgreementArtifactInTx } from "@/domains/documents/artifacts";
import {
  assertTaxReadyForAgreement,
  combinedRentalTaxRateMilliPercentForAgreement,
} from "@/domains/tax/locations";
import { createPrepaidRentInvoiceInTx } from "@/domains/tax/prepaid-invoice";
import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  RentalAgreement,
  RentalAgreementStatus,
} from "@prisma/client";
import { getBusinessSettings } from "@/domains/settings";
import { getStripeClient } from "@/lib/stripe";
import { applianceStatusOnAgreementClose } from "@/domains/inventory/lifecycle";
import { cancelStagedSwapsForAgreementInTx, releaseSubstitutesForAgreementInTx } from "@/domains/jobs/swaps";
import {
  claimProviderOperation,
  completeProviderOperation,
  runProviderCall,
} from "@/domains/billing/provider-ops";
import { packagePartsProblem } from "@/domains/packages/pricing";
import {
  calculatePrepayDiscountCentsPerMonth,
  isFreeMonthEarned,
} from "@/domains/pricing/prepay-discount";

const ALLOWED_AGREEMENT_TRANSITIONS: Record<
  RentalAgreementStatus,
  RentalAgreementStatus[]
> = {
  DRAFT: ["AWAITING_SIGNATURE", "CANCELLED"],
  AWAITING_SIGNATURE: ["ACTIVE", "SCHEDULED", "CANCELLED", "DRAFT"],
  SCHEDULED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ENDED", "CANCELLED"],
  ENDED: [],
  CANCELLED: [],
};

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

/**
 * Agreement lifecycle aggregate lock. Every mutation whose validity depends
 * on RentalAgreement.status takes this row lock before it re-reads and acts
 * on that status. That gives add/remove/send/sign/cancel/end/extend one shared
 * concurrency contract instead of independent read-then-write checks.
 */
export async function lockRentalAgreementInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<RentalAgreement> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "RentalAgreement"
    WHERE "id" = ${agreementId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Couldn't find that rental agreement.");
  }
  return tx.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
}

export async function getAgreementsCount(filter?: {
  status?: RentalAgreementStatus;
}): Promise<number> {
  return prisma.rentalAgreement.count({
    where: filter?.status ? { status: filter.status } : undefined,
  });
}

export async function getAgreementsPage(
  filter: { status?: RentalAgreementStatus } | undefined,
  skip: number,
  pageSize: number,
) {
  await requireRole("OWNER", "ADMIN");
  return prisma.rentalAgreement.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: {
      customer: {
        include: { user: { select: { name: true, email: true } } },
      },
      serviceAddress: true,
      lines: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getAgreementById(id: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.rentalAgreement.findUnique({
    where: { id },
    include: {
      customer: {
        include: { user: { select: { name: true, email: true } } },
      },
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
  requestKey?: string;
  customerId: string;
  serviceAddressId: string;
  termMonths?: number | null;
  depositCents?: number;
  damageWaiverCents?: number;
  lateFeeGraceDays?: number;
  lateFeeCents?: number;
  lateFeePercent?: number;
  paidInFullInAdvance?: boolean;
};

type DraftSettingsSnapshot = {
  twelveMonthPrepayFreeMonthEnabled: boolean;
  draftReservationHoldDays: number;
};

export type CreateDraftAgreementInTxOptions = {
  id?: string;
  sourceEstimateId?: string | null;
  settings: DraftSettingsSnapshot;
};

function validateDraftTerms(input: NewAgreementInput) {
  const termMonths = input.termMonths ?? null;
  const paidInFullInAdvance = input.paidInFullInAdvance ?? false;
  if (paidInFullInAdvance && termMonths !== 12) {
    throw new Error(
      "Paying in advance for the free-month bonus only applies to a 12-month term.",
    );
  }
  return { termMonths, paidInFullInAdvance };
}

/**
 * Transaction-capable draft creator. Estimate conversion uses this so all
 * resulting agreements, their source link, optional deposit, the estimate's
 * CONVERTED state and audit evidence can commit or roll back as one unit.
 */
export async function createDraftAgreementInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: NewAgreementInput,
  options: CreateDraftAgreementInTxOptions,
) {
  const { termMonths, paidInFullInAdvance } = validateDraftTerms(input);
  const address = await tx.serviceAddress.findUnique({
    where: { id: input.serviceAddressId },
    select: {
      customerId: true,
      customer: { select: { archivedAt: true } },
    },
  });
  if (
    !address ||
    address.customerId !== input.customerId ||
    address.customer.archivedAt
  ) {
    throw new Error(
      "Choose a service address belonging to this active customer.",
    );
  }

  const freeMonthGranted = isFreeMonthEarned(
    termMonths,
    paidInFullInAdvance,
    options.settings.twelveMonthPrepayFreeMonthEnabled,
  );

  const agreement = await tx.rentalAgreement.create({
    data: {
      ...(options.id ? { id: options.id } : {}),
      ...(options.sourceEstimateId
        ? { sourceEstimateId: options.sourceEstimateId }
        : {}),
      customerId: input.customerId,
      serviceAddressId: input.serviceAddressId,
      termMonths,
      depositCents: input.depositCents ?? 0,
      damageWaiverCents: input.damageWaiverCents ?? 0,
      lateFeeGraceDays: input.lateFeeGraceDays ?? 5,
      lateFeeCents: input.lateFeeCents ?? 0,
      lateFeePercent: input.lateFeePercent ?? 0,
      paidInFullInAdvance,
      freeMonthGranted,
      reservationExpiresAt: addDays(
        new Date(),
        options.settings.draftReservationHoldDays,
      ),
    },
  });

  await tx.auditLog.create({
    data: {
      userId,
      action: "agreement.create",
      entityType: "RentalAgreement",
      entityId: agreement.id,
      newValue: {
        customerId: input.customerId,
        termMonths,
        paidInFullInAdvance,
        freeMonthGranted,
        sourceEstimateId: options.sourceEstimateId ?? null,
      },
    },
  });

  return agreement;
}

export async function createDraftAgreement(
  userId: string,
  input: NewAgreementInput,
) {
  const { termMonths, paidInFullInAdvance } = validateDraftTerms(input);
  const requestedId = input.requestKey
    ? draftRequestId(userId, input.requestKey)
    : undefined;
  const terms = {
    customerId: input.customerId,
    serviceAddressId: input.serviceAddressId,
    termMonths,
    depositCents: input.depositCents ?? 0,
    damageWaiverCents: input.damageWaiverCents ?? 0,
    lateFeeGraceDays: input.lateFeeGraceDays ?? 5,
    lateFeeCents: input.lateFeeCents ?? 0,
    lateFeePercent: input.lateFeePercent ?? 0,
    paidInFullInAdvance,
  };

  async function savedRequest() {
    if (!requestedId) return null;
    const saved = await prisma.rentalAgreement.findUnique({
      where: { id: requestedId },
    });
    if (!saved) return null;
    if (
      Object.entries(terms).some(
        ([key, value]) => saved[key as keyof typeof saved] !== value,
      )
    ) {
      throw new Error(
        "This save request already has different terms. Open the saved draft before continuing.",
      );
    }
    return saved;
  }

  const saved = await savedRequest();
  if (saved) return saved;

  const settings = await getBusinessSettings();
  try {
    return await prisma.$transaction((tx) =>
      createDraftAgreementInTx(tx, userId, input, {
        id: requestedId,
        settings,
      }),
    );
  } catch (error) {
    if (requestedId && (error as { code?: string }).code === "P2002") {
      const existing = await savedRequest();
      if (existing) return existing;
    }
    throw error;
  }
}

export type NewRentalLineInput = {
  label: string;
  listPriceCents: number;
  applianceIds: string[];
  /** Set when the line rents a package (W-16B): the chosen machines must be exactly one per part of the set. */
  packageId?: string | null;
};

export async function addRentalLine(
  userId: string,
  agreementId: string,
  input: NewRentalLineInput,
) {
  if (input.applianceIds.length === 0) {
    throw new Error("Choose at least one appliance for this line.");
  }
  const settings = await getBusinessSettings();

  return prisma.$transaction(async (tx) => {
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    if (agreement.status !== "DRAFT") {
      throw new Error("Can only add appliances to a draft agreement.");
    }

    if (input.packageId) {
      const pkg = await tx.rentalPackage.findUnique({
        where: { id: input.packageId },
        include: { components: { include: { applianceType: { select: { name: true } } } } },
      });
      if (!pkg || !pkg.isActive) throw new Error("That set is no longer offered. Choose another set or single machines.");
      const chosen = await tx.appliance.findMany({
        where: { id: { in: input.applianceIds } },
        select: { applianceTypeId: true, applianceType: { select: { name: true } } },
      });
      const problem = packagePartsProblem(
        pkg.name,
        pkg.components.map((c) => ({ applianceTypeId: c.applianceTypeId, name: c.applianceType.name, quantity: c.quantity })),
        chosen.map((a) => ({ applianceTypeId: a.applianceTypeId, name: a.applianceType.name })),
      );
      if (problem || chosen.length !== input.applianceIds.length) throw new Error(problem ?? "One of those appliances no longer exists.");
    }

    const prepayDiscountCentsPerMonth = calculatePrepayDiscountCentsPerMonth(
      agreement.termMonths,
      input.applianceIds.length,
      settings,
    );
    const monthlyPriceCents = Math.max(
      0,
      input.listPriceCents - prepayDiscountCentsPerMonth,
    );

    const line = await tx.rentalLine.create({
      data: {
        agreementId,
        label: input.label,
        listPriceCents: input.listPriceCents,
        prepayDiscountCentsPerMonth,
        monthlyPriceCents,
        packageId: input.packageId || null,
      },
    });

    for (const applianceId of input.applianceIds) {
      const reserved = await tx.appliance.updateMany({
        where: { id: applianceId, status: "AVAILABLE" },
        data: { status: "RESERVED" },
      });
      if (reserved.count !== 1) {
        const appliance = await tx.appliance.findUnique({
          where: { id: applianceId },
        });
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
          packageId: input.packageId || null,
          listPriceCents: input.listPriceCents,
          prepayDiscountCentsPerMonth,
          monthlyPriceCents,
        },
      },
    });
    return line;
  });
}

export async function removeRentalLine(userId: string, lineId: string) {
  const lineRef = await prisma.rentalLine.findUnique({
    where: { id: lineId },
    select: { agreementId: true },
  });
  if (!lineRef) {
    throw new Error("Couldn't find that rental line.");
  }

  return prisma.$transaction(async (tx) => {
    const agreement = await lockRentalAgreementInTx(tx, lineRef.agreementId);
    if (agreement.status !== "DRAFT") {
      throw new Error("Can only remove appliances from a draft agreement.");
    }

    const line = await tx.rentalLine.findUniqueOrThrow({
      where: { id: lineId },
      include: { assignments: true },
    });

    for (const assignment of line.assignments) {
      if (!assignment.unassignedAt) {
        await tx.applianceAssignment.update({
          where: { id: assignment.id },
          data: {
            unassignedAt: new Date(),
            unassignReason: "Line removed",
          },
        });
        const appliance = await tx.appliance.findUniqueOrThrow({
          where: { id: assignment.applianceId },
          select: { status: true },
        });
        const next = applianceStatusOnAgreementClose(appliance.status);
        if (next) {
          await tx.appliance.update({
            where: { id: assignment.applianceId },
            data: { status: next },
          });
        }
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

export async function sendForSignature(userId: string, agreementId: string) {
  return prisma.$transaction(async (tx) => {
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    if (agreement.status !== "DRAFT") {
      throw new Error("Only a draft agreement can be sent for signature.");
    }
    const lineCount = await tx.rentalLine.count({ where: { agreementId } });
    if (lineCount === 0) {
      throw new Error("Add at least one appliance to this agreement first.");
    }

    const taxDate = new Date();
    await assertTaxReadyForAgreement(tx, agreementId, taxDate);
    const taxRateMilliPercent =
      await combinedRentalTaxRateMilliPercentForAgreement(
        tx,
        agreementId,
        taxDate,
      );

    const signature = await tx.signatureRecord.create({
      data: { agreementId, provider: "typed_signature" },
    });
    // A fixed-term agreement is locked to the ending/renewal terms in force
    // right now (or this customer's own override): later changes to the
    // system-wide terms never reach it. Month-to-month follows the live terms.
    let termsSnapshot: Prisma.InputJsonValue | undefined;
    if (agreement.termMonths) {
      const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" } });
      termsSnapshot = JSON.parse(
        JSON.stringify(buildTermsSnapshot(settings ?? {}, agreement.termsOverride, new Date())),
      );
    }
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        status: "AWAITING_SIGNATURE",
        taxRateMilliPercent,
        ...(termsSnapshot ? { termsSnapshot } : {}),
      },
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

export async function getSignatureRecordForSigning(id: string) {
  const signature = await prisma.signatureRecord.findUnique({
    where: { id },
    include: {
      agreement: {
        include: {
          customer: {
            include: { user: { select: { name: true, email: true } } },
          },
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

import { newestMonthToMonthVersionInTx } from "./month-to-month";

export type SignAgreementInput = {
  signerName: string;
  signerEmail: string;
  ipAddress: string | null;
};

export async function signAgreement(
  signatureRecordId: string,
  input: SignAgreementInput,
) {
  const signatureRef = await prisma.signatureRecord.findUnique({
    where: { id: signatureRecordId },
    select: { agreementId: true },
  });
  if (!signatureRef) {
    throw new Error("This agreement isn't available to sign right now.");
  }

  const local = await prisma.$transaction(async (tx) => {
    const agreement = await lockRentalAgreementInTx(
      tx,
      signatureRef.agreementId,
    );
    if (agreement.status !== "AWAITING_SIGNATURE") {
      throw new Error("This agreement isn't available to sign right now.");
    }

    const signedAt = new Date();
    const signResult = await tx.signatureRecord.updateMany({
      where: {
        id: signatureRecordId,
        agreementId: agreement.id,
        signedAt: null,
      },
      data: {
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        ipAddress: input.ipAddress,
        signedAt,
      },
    });
    if (signResult.count !== 1) {
      throw new Error("This agreement was already signed.");
    }

    const scheduledRenewal = Boolean(agreement.renewedFromAgreementId && agreement.startDate);
    await tx.rentalAgreement.update({
      where: { id: agreement.id },
      // A renewal keeps the start date it was agreed with and is only
      // SCHEDULED: it becomes the active rental (and the rental it renews
      // ends) in one step at its start date; see renewal-start.ts.
      data: scheduledRenewal
        ? {
            status: "SCHEDULED",
            endDate: agreement.termMonths ? fixedTermEndDate(agreement.startDate!, agreement.termMonths) : null,
          }
        : {
            status: "ACTIVE",
            startDate: signedAt,
            // A new month-to-month rental starts on the newest published terms.
            ...(agreement.termMonths === null && agreement.monthToMonthTermsVersion === null
              ? { monthToMonthTermsVersion: await newestMonthToMonthVersionInTx(tx) }
              : {}),
          },
    });
    if (agreement.paidInFullInAdvance) {
      await createPrepaidRentInvoiceInTx(tx, agreement.id, signedAt);
    }

    // The signed artifact is part of signing's atomic evidence. If rendering
    // or storage fails, the signature/status changes above roll back too.
    await createSignedAgreementArtifactInTx(tx, agreement.id);
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "agreement.sign",
        entityType: "RentalAgreement",
        entityId: agreement.id,
        newValue: {
          signerName: input.signerName,
          signerEmail: input.signerEmail,
        },
      },
    });
    const subscriptionEndIds =
      scheduledRenewal && agreement.renewedFromAgreementId
        ? await recomputeForAgreementInTx(tx, agreement.renewedFromAgreementId)
        : [];
    return { agreementId: agreement.id, subscriptionEndIds };
  });
  await applySubscriptionEnds(local.subscriptionEndIds);
  return local.agreementId;
}

export type CloseAgreementResult = {
  updated: RentalAgreement;
  stripeSubscriptionId: string | null;
  providerClaim:
    | { done: true; providerObjectId: string }
    | { done: false; opId: string; idempotencyKey: string }
    | null;
  subscriptionEndIds: string[];
};

/**
 * The local half of ending or cancelling an agreement, inside the caller's transaction (it takes the agreement
 * lock itself, so a caller already holding it is fine). The Stripe half is `runCloseAgreementContinuation`,
 * which must run after the transaction commits.
 */
export async function closeAgreementInTx(
  tx: Prisma.TransactionClient,
  userId: string | null,
  agreementId: string,
  newStatus: "ENDED" | "CANCELLED",
  options: { endedOn?: Date } = {},
): Promise<CloseAgreementResult> {
  const agreement = await lockRentalAgreementInTx(tx, agreementId);
  const check = canTransitionAgreementStatus(agreement.status, newStatus);
  if (!check.ok) throw new Error(check.reason);
  if (agreement.status === "ACTIVE") {
    const waiting = await tx.rentalAgreement.findFirst({
      where: { renewedFromAgreementId: agreementId, status: "SCHEDULED" },
      select: { id: true },
    });
    if (waiting) {
      throw new Error(
        "This rental has a signed renewal waiting to start. Cancel the renewal first, then end or cancel this rental.",
      );
    }
  }

  let providerClaim:
    | { done: true; providerObjectId: string }
    | { done: false; opId: string; idempotencyKey: string }
    | null = null;
  if (agreement.stripeSubscriptionId) {
    providerClaim = await claimProviderOperation(tx, {
      kind: "SUBSCRIPTION_CANCEL",
      subjectType: "RentalAgreement",
      subjectId: agreementId,
      idempotencyKey: `subscription-cancel-${agreementId}`,
    });
  }

  const closedAt = new Date();
  await tx.rentalAgreement.update({
    where: { id: agreementId },
    data: {
      status: newStatus,
      closedAt,
      endDate: newStatus === "ENDED" ? (options.endedOn ?? closedAt) : agreement.endDate,
    },
  });

  // A swap still waiting for this agreement is cancelled and its reserved replacement goes back on the shelf.
  await cancelStagedSwapsForAgreementInTx(tx, userId, agreementId);
  // Units a delivery visit had set aside as substitutes for waiting items go back on the shelf too.
  await releaseSubstitutesForAgreementInTx(tx, userId, agreementId, `Agreement ${newStatus.toLowerCase()}`);

  const lines = await tx.rentalLine.findMany({
    where: { agreementId },
    include: { assignments: { where: { unassignedAt: null } } },
  });
  for (const line of lines) {
    for (const assignment of line.assignments) {
      await tx.applianceAssignment.update({
        where: { id: assignment.id },
        data: {
          unassignedAt: new Date(),
          unassignReason: `Agreement ${newStatus.toLowerCase()}`,
        },
      });
      const appliance = await tx.appliance.findUniqueOrThrow({
        where: { id: assignment.applianceId },
        select: { status: true },
      });
      const next = applianceStatusOnAgreementClose(appliance.status);
      if (next) {
        await tx.appliance.update({
          where: { id: assignment.applianceId },
          data: { status: next },
        });
      }
    }
  }

  // A cancelled automatic renewal's reminder no longer needs to go out: withdrawn in the same transaction.
  if (newStatus === "CANCELLED" && agreement.createdByAutoRenew && agreement.renewedFromAgreementId) {
    await tx.customerNotice.updateMany({
      where: {
        agreementId: agreement.renewedFromAgreementId,
        kind: "RENEWAL_REMINDER",
        // Only a notice not yet being sent: one already in flight is recorded as sent when it lands.
        status: "PENDING",
      },
      data: { status: "NOT_NEEDED" },
    });
  }

  await tx.auditLog.create({
    data: {
      userId,
      action:
        newStatus === "ENDED" ? "agreement.end" : "agreement.cancel",
      entityType: "RentalAgreement",
      entityId: agreementId,
      oldValue: { status: agreement.status },
      newValue: {
        status: newStatus,
        providerCancelPending:
          Boolean(agreement.stripeSubscriptionId) && providerClaim?.done === false,
      },
    },
  });

  const updated = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
  });

  // Persist the newest billing answer LAST, after every lifecycle mutation.
  // For a cancelled SCHEDULED renewal the helper resolves through its source
  // agreement and restores the old term end. For a closed ACTIVE holder it
  // records CLOSED; the separate cancellation operation below still ends Stripe.
  const touched = await recomputeForAgreementInTx(tx, agreementId);
  const sourceTouched =
    agreement.status === "SCHEDULED" && agreement.renewedFromAgreementId
      ? await recomputeForAgreementInTx(tx, agreement.renewedFromAgreementId)
      : [];
  const subscriptionEndIds = [...new Set([...touched, ...sourceTouched])];

  return {
    updated,
    stripeSubscriptionId: agreement.stripeSubscriptionId,
    providerClaim,
    subscriptionEndIds,
  };
}

async function closeAgreement(
  userId: string | null,
  agreementId: string,
  newStatus: "ENDED" | "CANCELLED",
  options: { endedOn?: Date } = {},
) {
  const local = await prisma.$transaction((tx) => closeAgreementInTx(tx, userId, agreementId, newStatus, options));
  return runCloseAgreementContinuation(local);
}

/** The provider half of closing an agreement. Runs after commit; the newest end intent is applied before cancellation. */
export async function runCloseAgreementContinuation(local: CloseAgreementResult): Promise<RentalAgreement> {
  await applySubscriptionEnds(local.subscriptionEndIds);

  if (
    !local.stripeSubscriptionId ||
    !local.providerClaim ||
    local.providerClaim.done
  ) {
    return local.updated;
  }

  const stripeSubscriptionId = local.stripeSubscriptionId;
  const providerClaim = local.providerClaim;
  const result = await runProviderCall(async () => {
    try {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(stripeSubscriptionId, undefined, {
        idempotencyKey: providerClaim.idempotencyKey,
      });
      return stripeSubscriptionId;
    } catch (error) {
      const providerError = error as { type?: string; code?: string };
      if (
        providerError.type === "StripeInvalidRequestError" &&
        providerError.code === "resource_missing"
      ) {
        return stripeSubscriptionId;
      }
      throw error;
    }
  });

  await prisma.$transaction(async (tx) => {
    if (result.ok) {
      await completeProviderOperation(tx, providerClaim.opId, {
        status: "SUCCEEDED",
        providerObjectId: result.value,
      });
      return;
    }
    await completeProviderOperation(tx, providerClaim.opId, {
      status: result.outcome,
      error: result.error,
    });
  });

  // Provider failure never rolls back or hides the local lifecycle decision.
  // The reconciliation pass owns PENDING/FAILED/UNKNOWN provider state.
  return local.updated;
}

export async function endAgreement(userId: string, agreementId: string) {
  return closeAgreement(userId, agreementId, "ENDED");
}

/**
 * End an agreement on the date it was agreed to end (an early ending that has come
 * due), recorded with no staff member as the actor. Same close path as ending by hand.
 */
export async function endAgreementOnAgreedDate(agreementId: string, endedOn: Date) {
  return closeAgreement(null, agreementId, "ENDED", { endedOn });
}

export async function cancelAgreement(userId: string | null, agreementId: string) {
  return closeAgreement(userId, agreementId, "CANCELLED");
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export { isReservationStale } from "./reservation-status";

export async function extendReservation(userId: string, agreementId: string) {
  const settings = await getBusinessSettings();
  const reservationExpiresAt = addDays(
    new Date(),
    settings.draftReservationHoldDays,
  );

  return prisma.$transaction(async (tx) => {
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    if (
      agreement.status !== "DRAFT" &&
      agreement.status !== "AWAITING_SIGNATURE"
    ) {
      throw new Error(
        "Only a draft or awaiting-signature agreement has a reservation hold to extend.",
      );
    }

    const updated = await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: { reservationExpiresAt },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.extend_reservation",
        entityType: "RentalAgreement",
        entityId: agreementId,
        oldValue: { reservationExpiresAt: agreement.reservationExpiresAt },
        newValue: { reservationExpiresAt },
      },
    });
    return updated;
  });
}
