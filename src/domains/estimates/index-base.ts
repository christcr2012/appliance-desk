import { prisma } from "@/lib/prisma";
import { Prisma, type EstimateStatus } from "@prisma/client";
import { deliverMessage } from "@/domains/messaging/deliver";
import { getBusinessSettings } from "@/domains/settings";
import { followUpEmailCopy, quoteEmailCopy } from "@/domains/language/transactional-copy";
import { createDraftAgreementInTx } from "@/domains/agreements";
import { locateServiceAddress } from "@/domains/tax/locations";
import {
  createLeadManually,
  convertLeadToCustomerInTx,
  sendCustomerActivationEmail,
  type ManualLeadInput,
} from "@/domains/leads";

import { estimateExpiresAt, isEstimatePastValidity } from "./validity";
import { getPreparedEstimateQuoteInTx } from "./preapproval-quote";
import { validatePreparedConversion, validateConvertedEstimateReplay } from "./prepared-conversion";
import { assertActiveTeamActor } from "@/lib/team-actor";

const EDITABLE_STATUSES: EstimateStatus[] = ["DRAFT", "CHANGES_REQUESTED"];
const PUBLICLY_VIEWABLE_STATUSES: EstimateStatus[] = [
  "SENT",
  "VIEWED",
  "APPROVED",
  "CHANGES_REQUESTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
];
const AWAITING_RESPONSE_STATUSES: EstimateStatus[] = ["SENT", "VIEWED"];
const FOLLOW_UP_AFTER_DAYS = 3;

async function lockEstimateInTx(
  tx: Prisma.TransactionClient,
  estimateId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Estimate"
    WHERE "id" = ${estimateId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Couldn't find that estimate.");
  }
  return tx.estimate.findUniqueOrThrow({ where: { id: estimateId } });
}

const EXPIRED_ESTIMATE_MESSAGE =
  "This estimate has expired. Please contact us if you'd still like to move forward.";

/**
 * R09: called under the Estimate row lock. An estimate still awaiting an answer
 * whose "valid until" day has ended is marked EXPIRED in the same transaction, so
 * the caller can commit that fact and then refuse the response with no other
 * side effect (no approval, no lead conversion, no email).
 */
async function expireIfPastValidityInTx(
  tx: Prisma.TransactionClient,
  estimate: { id: string; status: EstimateStatus; validUntil: Date | null },
): Promise<boolean> {
  if (!AWAITING_RESPONSE_STATUSES.includes(estimate.status)) return false;
  if (!isEstimatePastValidity(estimate.validUntil)) return false;
  await tx.estimate.update({
    where: { id: estimate.id },
    data: { status: "EXPIRED" },
  });
  return true;
}

export type NewEstimateInput = {
  customerId: string;
  title: string;
  clientMessage?: string;
  internalNotes?: string;
  depositCents?: number;
  validUntil?: Date | null;
  phoneOrder?: boolean;
};

export async function createEstimateDraft(
  userId: string,
  input: NewEstimateInput,
) {
  const recipient = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { preferredLanguage: true },
  });
  if (!recipient) throw new Error("Customer account no longer exists.");
  const estimate = await prisma.estimate.create({
    data: {
      customerId: input.customerId,
      preferredLanguage: recipient.preferredLanguage,
      title: input.title,
      clientMessage: input.clientMessage || null,
      internalNotes: input.internalNotes || null,
      depositCents: input.depositCents ?? 0,
      validUntil: input.validUntil ?? null,
      createdByUserId: userId,
      ...(input.phoneOrder ? {phoneEnteredByUserId:userId,phoneEnteredAt:new Date()} : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "estimate.create",
      entityType: "Estimate",
      entityId: estimate.id,
      newValue: { customerId: input.customerId, title: input.title },
    },
  });
  return estimate;
}

export type NewEstimateForLeadInput = Omit<NewEstimateInput, "customerId">;

export async function createEstimateDraftForNewLead(
  userId: string,
  leadInput: ManualLeadInput,
  estimateInput: NewEstimateForLeadInput,
) {
  const lead = await createLeadManually(userId, leadInput);
  const estimate = await prisma.estimate.create({
    data: {
      leadId: lead.id,
      title: estimateInput.title,
      clientMessage: estimateInput.clientMessage || null,
      internalNotes: estimateInput.internalNotes || null,
      depositCents: estimateInput.depositCents ?? 0,
      validUntil: estimateInput.validUntil ?? null,
      createdByUserId: userId,
      ...(estimateInput.phoneOrder ? {phoneEnteredByUserId:userId,phoneEnteredAt:new Date()} : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "estimate.create",
      entityType: "Estimate",
      entityId: estimate.id,
      newValue: { leadId: lead.id, title: estimateInput.title },
    },
  });
  return estimate;
}

export type NewEstimateLineItemInput = {
  serviceAddressId?: string | null;
  description: string;
  quantity: number;
  monthlyPriceCents?: number;
  oneTimeFeeCents?: number;
  /** Set when the line quotes a package (W-16B); the price stays whatever the owner quotes. */
  packageId?: string | null;
};

export async function addEstimateLineItem(
  userId: string,
  estimateId: string,
  input: NewEstimateLineItemInput,
) {
  const estimate = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
  });
  if (!EDITABLE_STATUSES.includes(estimate.status)) {
    throw new Error(
      "This estimate has already been sent — you can't edit its line items now.",
    );
  }
  if (input.quantity < 1) throw new Error("Quantity must be at least 1.");
  if (
    (input.monthlyPriceCents ?? 0) === 0 &&
    (input.oneTimeFeeCents ?? 0) === 0
  ) {
    throw new Error(
      "Enter a monthly amount, a one-time fee, or both — not zero for everything.",
    );
  }

  if (input.packageId) {
    const pkg = await prisma.rentalPackage.findUnique({ where: { id: input.packageId }, select: { isActive: true } });
    if (!pkg?.isActive) throw new Error("That set is no longer offered. Choose another set or describe the line yourself.");
  }

  const line = await prisma.estimateLineItem.create({
    data: {
      estimateId,
      packageId: input.packageId || null,
      serviceAddressId: input.serviceAddressId || null,
      description: input.description,
      quantity: input.quantity,
      monthlyPriceCents: input.monthlyPriceCents ?? 0,
      oneTimeFeeCents: input.oneTimeFeeCents ?? 0,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId,
      action: "estimate.line.add",
      entityType: "Estimate",
      entityId: estimateId,
      newValue: { description: input.description, quantity: input.quantity, packageId: input.packageId || null },
    },
  });
  return line;
}

export async function removeEstimateLineItem(
  userId: string,
  lineItemId: string,
) {
  const line = await prisma.estimateLineItem.findUniqueOrThrow({
    where: { id: lineItemId },
    include: { estimate: true },
  });
  if (!EDITABLE_STATUSES.includes(line.estimate.status)) {
    throw new Error(
      "This estimate has already been sent — you can't edit its line items now.",
    );
  }
  await prisma.estimateLineItem.delete({ where: { id: lineItemId } });
  await prisma.auditLog.create({
    data: {
      userId,
      action: "estimate.line.remove",
      entityType: "Estimate",
      entityId: line.estimateId,
      oldValue: { description: line.description },
    },
  });
}

export async function getEstimatesForCustomer(customerId: string) {
  return prisma.estimate.findMany({
    where: { customerId },
    include: { lineItems: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getAllEstimates() {
  return prisma.estimate.findMany({
    include: {
      customer: {
        select: {
          companyName: true,
          user: { select: { name: true, email: true } },
        },
      },
      lead: {
        select: { contactName: true, companyName: true, status: true },
      },
      lineItems: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getEstimateDetail(estimateId: string) {
  return prisma.estimate.findUnique({
    where: { id: estimateId },
    include: {
      customer: {
        select: {
          id: true,
          companyName: true,
          user: { select: { name: true, email: true } },
          serviceAddresses: true,
        },
      },
      lead: {
        select: {
          id: true,
          contactName: true,
          companyName: true,
          phone: true,
          status: true,
        },
      },
      lineItems: {
        include: { serviceAddress: true },
        orderBy: [{ createdAt: "asc" }],
      },
      createdAgreements: {
        select: { id: true, serviceAddressId: true, status: true },
      },
    },
  });
}

export function totalMonthlyCents(
  lineItems: { monthlyPriceCents: number; quantity: number }[],
): number {
  return lineItems.reduce(
    (sum, line) => sum + line.monthlyPriceCents * line.quantity,
    0,
  );
}

export function totalOneTimeCents(
  lineItems: { oneTimeFeeCents: number; quantity: number }[],
): number {
  return lineItems.reduce(
    (sum, line) => sum + line.oneTimeFeeCents * line.quantity,
    0,
  );
}

/**
 * Marks the estimate sent and emails the link. `emailed` is false when live customer email is off, so the owner can share the link by hand.
 *
 * R10: the status change IS the claim. One transaction locks the estimate, checks
 * it is still sendable, and stores the new `sentAt` before any email work. A second
 * overlapping click waits on the lock, then finds the estimate already SENT and is
 * refused, so only the winner emails. The email's idempotency key comes from the
 * estimate id plus that stored `sentAt`, so a retry of the same send can never mail
 * twice; a deliberate re-send of a revised estimate gets a new `sentAt` and so a new
 * identity. No email is sent inside the transaction.
 */
export async function sendEstimate(userId: string, estimateId: string,
  options: { requireReviewed?: boolean } = {}): Promise<{ emailed: boolean; outcome?: string }> {
  const claimed = await prisma.$transaction(async (tx) => {
    const locked = await lockEstimateInTx(tx, estimateId);
    if (!EDITABLE_STATUSES.includes(locked.status)) {
      throw new Error("This estimate has already been sent.");
    }
    const estimate = await tx.estimate.findUniqueOrThrow({
      where: { id: estimateId },
      include: {
        lineItems: true,
        customer: {
          select: { user: { select: { name: true, email: true } } },
        },
        lead: { select: { contactName: true, email: true } },
      },
    });
    if (estimate.lineItems.length === 0) {
      throw new Error("Add at least one line item before sending this estimate.");
    }
    const prepared = await getPreparedEstimateQuoteInTx(tx, estimateId);
    // A lead may still receive a clearly nonbinding preliminary scope.
    // Only a complete verified frozen order may carry binding quote identity.
    const fullyReviewed = prepared.status === "READY" &&
      !!prepared.quoteFingerprint && !!prepared.orderFingerprint;

    if (options.requireReviewed && !fullyReviewed)
      throw new Error("A phone order requires a frozen, fully reviewed one-site quote before sending.");
    const recipientEmail = estimate.customer?.user.email ?? estimate.lead?.email;
    const recipientName = estimate.customer
      ? (estimate.customer.user.name ?? estimate.customer.user.email)
      : estimate.lead?.contactName;
    if (!recipientEmail) {
      throw new Error(
        "This lead has no email address on file — add one before sending this estimate.",
      );
    }

    // A re-send must never reuse an earlier send's identity, even within the same millisecond.
    const previous = estimate.sentAt?.getTime() ?? 0;
    const sentAt = new Date(Math.max(Date.now(), previous + 1));
    await tx.estimate.update({
      where: { id: estimateId },
      data: { status: "SENT", sentAt,
        reviewedQuoteFingerprint: fullyReviewed ? prepared.quoteFingerprint : null,
        reviewedOrderFingerprint: fullyReviewed ? prepared.orderFingerprint : null,
        reviewedQuoteAt: fullyReviewed ? new Date() : null },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "estimate.send",
        entityType: "Estimate",
        entityId: estimateId,
        newValue: { sentAt: sentAt.toISOString() },
      },
    });
    return { estimate, recipientEmail, recipientName, sentAt, fullyReviewed };
  });
  const { estimate, recipientEmail, recipientName, sentAt, fullyReviewed } = claimed;

  const settings = await getBusinessSettings();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://robinsonappliancerentals.com";
  const monthly = totalMonthlyCents(estimate.lineItems);
  const oneTime = totalOneTimeCents(estimate.lineItems);
  const {quoteLanguage}=await import("@/domains/language/quote-note");
  const { activeMessageCatalog } = await import("@/domains/language/runtime");
  const {language,note:clientMessage}=await quoteLanguage(
    estimate.preferredLanguage === "es" ? "es" : "en",estimate.clientMessage ?? null);
  const catalog = await activeMessageCatalog(language);
  const localizedEmail = quoteEmailCopy(language, {
    businessName: settings.publicBusinessName,
    estimateNumber: estimate.estimateNumber,
    recipientName: recipientName ?? null,
    monthlyCents: monthly,
    oneTimeCents: oneTime,
    fullyReviewed,
    clientMessage,
    url: `${appUrl}/estimate/${estimate.id}`,
  }, catalog);

  const delivery = await deliverMessage({
    idempotencyKey: `estimate-send-${estimate.id}-${sentAt.getTime()}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "estimate-send",
    customerFacing: true,
    recipient: {
      type: estimate.customer ? "Customer" : "Lead",
      address: recipientEmail,
    },
    subject: { type: "Estimate", id: estimate.id },
    render: () => ({
      subject: localizedEmail.subject,
      text: localizedEmail.text,
      actionLabel: localizedEmail.actionLabel,
    }),
  });
  const emailed = delivery.state === "ACCEPTED" || delivery.state === "DELIVERED";
  const outcome = emailed
    ? "SENT"
    : delivery.state === "NOT_SENT"
      ? "NOT_ATTEMPTED"
      : delivery.state === "FAILED"
        ? "REJECTED"
        : delivery.state;
  if (!emailed && outcome !== "NOT_ATTEMPTED") {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "estimate.send_email_unconfirmed",
        entityType: "Estimate",
        entityId: estimate.id,
        newValue: { outcome, deliveryId: delivery.deliveryId, sentAt: sentAt.toISOString() },
      },
    });
  }
  return { emailed, outcome };
}

export async function sendEstimateFollowUpReminders(): Promise<{
  sent: number;
  failed: number;
}> {
  const cutoff = new Date(
    Date.now() - FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );
  const dueEstimates = await prisma.estimate.findMany({
    where: {
      status: { in: AWAITING_RESPONSE_STATUSES },
      sentAt: { not: null, lte: cutoff },
    },
    include: {
      customer: {
        select: { user: { select: { name: true, email: true } } },
      },
      lead: { select: { contactName: true, email: true } },
    },
  });

  let sent = 0;
  let failed = 0;
  const settings = await getBusinessSettings();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://robinsonappliancerentals.com";

  const nowMs = Date.now();
  for (const estimate of dueEstimates) {
    if (!estimate.sentAt) continue;
    // No "still interested?" email for a quote that can no longer be answered.
    if (estimate.validUntil && estimateExpiresAt(estimate.validUntil).getTime() <= nowMs) continue;
    if (
      estimate.followUpSentForSentAt?.getTime() === estimate.sentAt.getTime()
    ) {
      continue;
    }
    const recipientEmail = estimate.customer?.user.email ?? estimate.lead?.email;
    const recipientName = estimate.customer
      ? (estimate.customer.user.name ?? estimate.customer.user.email)
      : estimate.lead?.contactName;
    if (!recipientEmail) continue;

    // Claim first: the "follow-up sent for this send" mark is written before the email goes out, by a
    // single conditional update, so two overlapping runs (or a crash between sending and recording) can
    // never email the same estimate twice. Only a definite "not sent" gives the claim back.
    const previousMark = estimate.followUpSentForSentAt;
    const claimed = await prisma.estimate.updateMany({
      where: {
        id: estimate.id,
        sentAt: estimate.sentAt,
        status: { in: AWAITING_RESPONSE_STATUSES },
        OR: [{ followUpSentForSentAt: null }, { followUpSentForSentAt: { not: estimate.sentAt } }],
      },
      data: { followUpSentForSentAt: estimate.sentAt },
    });
    if (claimed.count === 0) continue;
    const release = () =>
      prisma.estimate.updateMany({
        where: { id: estimate.id, followUpSentForSentAt: estimate.sentAt },
        data: { followUpSentForSentAt: previousMark },
      });

    try {
      const { displayCustomerLanguage } = await import("@/domains/language/review");
      const { activeMessageCatalog } = await import("@/domains/language/runtime");
      const followupLanguage = await displayCustomerLanguage(
        estimate.preferredLanguage === "es" ? "es" : "en",
      );
      const catalog = await activeMessageCatalog(followupLanguage);
      const copy = followUpEmailCopy(followupLanguage, {
        name: recipientName ?? null,
        businessName: settings.publicBusinessName,
        number: estimate.estimateNumber,
        url: `${appUrl}/estimate/${estimate.id}`,
      }, catalog);
      const delivery = await deliverMessage({
        idempotencyKey: `estimate-follow-up-${estimate.id}-${estimate.sentAt.getTime()}`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "estimate-follow-up",
        customerFacing: true,
        recipient: {
          type: estimate.customer ? "Customer" : "Lead",
          address: recipientEmail,
        },
        subject: { type: "Estimate", id: estimate.id },
        render: () => copy,
      });
      if (delivery.state === "FAILED" || delivery.state === "NOT_SENT") {
        await release();
        if (delivery.state === "FAILED") failed += 1;
        continue;
      }
      if (delivery.state === "ACCEPTED" || delivery.state === "DELIVERED") sent += 1;
      else if (delivery.state === "UNKNOWN") failed += 1;
    } catch (error) {
      await release().catch(() => undefined);
      console.error(
        "[estimates] Failed to send follow-up reminder",
        estimate.id,
        error,
      );
      failed += 1;
    }
  }
  return { sent, failed };
}

async function loadPublicEstimate(id: string) {
  return prisma.estimate.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          companyName: true,
          user: { select: { name: true, email: true } },
        },
      },
      lead: { select: { contactName: true, companyName: true } },
      lineItems: {
        include: { serviceAddress: true },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}

/**
 * Viewing is a one-way SENT -> VIEWED compare-and-set. If approval or a
 * change request wins the race first, this call re-reads and returns that
 * newer state instead of overwriting the terminal response with VIEWED.
 */
export async function getEstimateForApproval(id: string) {
  const estimate = await loadPublicEstimate(id);
  if (!estimate || !PUBLICLY_VIEWABLE_STATUSES.includes(estimate.status)) {
    return null;
  }

  if (
    AWAITING_RESPONSE_STATUSES.includes(estimate.status) &&
    isEstimatePastValidity(estimate.validUntil)
  ) {
    await prisma.estimate.updateMany({
      where: { id, status: { in: AWAITING_RESPONSE_STATUSES } },
      data: { status: "EXPIRED" },
    });
    return { ...estimate, status: "EXPIRED" as EstimateStatus };
  }

  if (estimate.status === "SENT") {
    const viewedAt = new Date();
    const claimed = await prisma.estimate.updateMany({
      where: { id, status: "SENT" },
      data: { status: "VIEWED", viewedAt },
    });
    if (claimed.count === 1) {
      return { ...estimate, status: "VIEWED" as EstimateStatus, viewedAt };
    }
    const current = await loadPublicEstimate(id);
    return current && PUBLICLY_VIEWABLE_STATUSES.includes(current.status)
      ? current
      : null;
  }
  return estimate;
}

export type ApproveEstimateInput = {
  deliverySelection?: import("@/domains/orders/delivery").DeliverySelection;
  expectedQuoteFingerprint: string;
  approverName: string;
  approverEmail: string;
  ipAddress: string | null;
};

/**
 * Approval, any lead -> customer conversion, and the estimate's terminal
 * response are one transaction under an Estimate row lock. Approval and
 * request-changes can no longer both succeed from overlapping stale tabs.
 */
export async function approveEstimate(
  id: string,
  input: ApproveEstimateInput,
) {
  const result = await prisma.$transaction(async (tx) => {
    const estimate = await lockEstimateInTx(tx, id);
    if (!AWAITING_RESPONSE_STATUSES.includes(estimate.status)) {
      throw new Error("This estimate isn't available to approve right now.");
    }
    if (await expireIfPastValidityInTx(tx, estimate)) return { expired: true as const };
    const approvedOffer = await getPreparedEstimateQuoteInTx(tx, id);
    if (approvedOffer.status !== "READY" || !approvedOffer.quoteFingerprint ||
        typeof input.expectedQuoteFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.expectedQuoteFingerprint) ||
        input.expectedQuoteFingerprint !== approvedOffer.quoteFingerprint ||
        !estimate.reviewedQuoteFingerprint || !estimate.reviewedOrderFingerprint ||
        approvedOffer.quoteFingerprint !== estimate.reviewedQuoteFingerprint ||
        approvedOffer.orderFingerprint !== estimate.reviewedOrderFingerprint) {
      throw new Error("This estimate's verified all-in order has changed or was never reviewed. Request an updated estimate before approval.");
    }

    // The offered option is validated under the same row lock as the final quote:
    // stale/replaced options cannot be accepted and no scheduling occurs here.
    const { readOfferedSlots, recordEstimateDeliverySelectionInTx } =
      await import("@/domains/orders/delivery");
    // ZONE-1: when every address on the estimate is "I'll pick it up", no delivery window is needed or accepted.
    const { isPickupOnly, currentLocations } = await import("@/domains/delivery/snapshot");
    const hasZones = estimate.deliveryZoneSnapshot !== null && estimate.deliveryZoneSnapshot !== undefined;
    const lineAddresses = hasZones ? (await tx.estimateLineItem.findMany({
      where: { estimateId: id }, select: { serviceAddressId: true },
    })).map((line) => line.serviceAddressId) : [];
    const pickupOnly = hasZones && isPickupOnly(estimate.deliveryZoneSnapshot, lineAddresses);
    // A customer who picks it up ($0) can never owe a delivery charge frozen into the quote they approve.
    if (hasZones) {
      const { frozenDeliveryCentsInTx } = await import("@/domains/delivery/estimate-zone");
      for (const location of currentLocations(estimate.deliveryZoneSnapshot, lineAddresses)) {
        if (location.choice !== "CUSTOMER_PICKUP") continue;
        if ((await frozenDeliveryCentsInTx(tx, estimate, location.serviceAddressId)) !== 0)
          throw new Error("This quote still includes delivery for an address you'll pick up. We'll send you an updated quote.");
      }
    }
    if (pickupOnly) {
      if (input.deliverySelection)
        throw new Error("You chose to pick it up, so no delivery window is needed.");
    } else if (readOfferedSlots(estimate.deliveryOffer).length) {
      if (!input.deliverySelection)
        throw new Error("Choose an offered delivery window and provide delivery details.");
      // W-24 cannot accept a delivery route charge that was never frozen
      // into the exact signed all-in V2 order. No fee from ZIP/air miles.
      const preparedAgreements=await tx.rentalAgreement.findMany({
        where:{sourceEstimateId:id},select:{id:true},
      });
      if(preparedAgreements.length!==1||!estimate.deliveryRouteProof)
        throw new Error("Owner route/fee review required for this delivery order.");
      const { assertRouteMatchesFrozenFeeInTx } =
        await import("@/domains/orders/route-evidence");
      await assertRouteMatchesFrozenFeeInTx(tx,preparedAgreements[0].id,
        estimate.deliveryRouteProof);
      await recordEstimateDeliverySelectionInTx(tx, estimate, input.deliverySelection);
    } else if (input.deliverySelection) {
      throw new Error("No current owner-offered delivery choice is available.");
    }
    let customerId = estimate.customerId;
    let activationEmail: string | null = null;
    let serviceAddressId: string | null = null;

    if (!customerId && estimate.leadId) {
      const lead = await tx.lead.findUniqueOrThrow({
        where: { id: estimate.leadId },
      });
      if (lead.status === "CONVERTED" && lead.convertedCustomerId) {
        customerId = lead.convertedCustomerId;
      } else {
        const converted = await convertLeadToCustomerInTx(
          tx,
          null,
          lead.id,
          { emailOverride: lead.email ? undefined : input.approverEmail },
        );
        customerId = converted.customer.id;
        serviceAddressId = converted.serviceAddressId;
        if (converted.isNewAccount) activationEmail = converted.email;
      }
    }

    // Carry a lead's customer-selected quote language into the newly created
    // customer at verified approval. The bearer link cannot mutate customers
    // directly; this write occurs only in the guarded approval transaction.
    if (customerId) {
      await tx.customer.update({
        where: { id: customerId },
        data: { preferredLanguage: estimate.preferredLanguage },
      });
    }

    await tx.estimate.update({
      where: { id },
      data: {
        status: "APPROVED",
        respondedAt: new Date(),
        approverName: input.approverName,
        approverEmail: input.approverEmail,
        approverIpAddress: input.ipAddress,
        customerId,
      },
    });

    return {
      expired: false as const,
      customerId,
      activationEmail,
      serviceAddressId,
    };
  });

  if (result.expired) throw new Error(EXPIRED_ESTIMATE_MESSAGE);
  if (result.serviceAddressId) {
    await locateServiceAddress(result.serviceAddressId).catch((error) => {
      console.error(
        "[tax] Service-address lookup failed after estimate approval:",
        error instanceof Error ? error.message : "unknown error",
      );
    });
  }
  if (result.activationEmail) {
    await sendCustomerActivationEmail(result.activationEmail);
  }
}

export async function requestEstimateChanges(id: string, message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Let us know what you'd like changed.");
  }

  const expired = await prisma.$transaction(async (tx) => {
    const estimate = await lockEstimateInTx(tx, id);
    if (!AWAITING_RESPONSE_STATUSES.includes(estimate.status)) {
      throw new Error("This estimate isn't available to respond to right now.");
    }
    if (await expireIfPastValidityInTx(tx, estimate)) return true;
    await tx.estimate.update({
      where: { id },
      data: {
        status: "CHANGES_REQUESTED",
        respondedAt: new Date(),
        changesRequestedMessage: trimmed,
      },
    });
    return false;
  });
  if (expired) throw new Error(EXPIRED_ESTIMATE_MESSAGE);
}

export type ConvertEstimateInput =
  | { mode: "single"; serviceAddressId: string }
  | { mode: "per-property" };

export function resolveConversionAddresses(
  lineItems: { description: string; serviceAddressId: string | null }[],
  input: ConvertEstimateInput,
): string[] {
  if (input.mode === "single") return [input.serviceAddressId];
  const addressIds = new Set<string>();
  for (const line of lineItems) {
    if (!line.serviceAddressId) {
      throw new Error(
        `"${line.description}" isn't tied to a property — assign one, or convert this estimate as a single agreement instead.`,
      );
    }
    addressIds.add(line.serviceAddressId);
  }
  return [...addressIds];
}

/**
 * APPROVED -> CONVERTED is now one locked database transaction. All draft
 * agreements, source-estimate links, an applicable prepaid Deposit, the
 * estimate transition and audit either commit together or roll back together.
 * A retry after a committed conversion returns the already-created agreement
 * IDs; concurrent conversions serialize on the Estimate row and cannot create
 * duplicate shells.
 */
export async function convertEstimateToAgreements(
  userId: string,
  estimateId: string,
  input: ConvertEstimateInput,
) {
  const settings = await getBusinessSettings();

  return prisma.$transaction(async (tx) => {
    const estimate = await lockEstimateInTx(tx, estimateId);

    if (estimate.status === "CONVERTED") {
      const existing = await tx.rentalAgreement.findMany({
        where: { sourceEstimateId: estimateId },
        select: { id: true, customerId: true, sourceEstimateId: true, serviceAddressId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return validateConvertedEstimateReplay(existing, {
        estimateId, customerId: estimate.customerId,
      });
    }

    if (estimate.status !== "APPROVED") {
      throw new Error("Only an approved estimate can be converted.");
    }
    // Prepared preapproval shells will be verified and adopted by the
    // converted agreement transaction; creating duplicates is forbidden.
    const prepared = await tx.rentalAgreement.findMany({
      where: { sourceEstimateId: estimateId },
      select: {
        id: true, customerId: true, sourceEstimateId: true,
        serviceAddressId: true, status: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (prepared.length) {
      await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
      const preparedIds = prepared.map(row => row.id).sort();
      await tx.$queryRaw`SELECT "id" FROM "RentalAgreement"
        WHERE "id" IN (${Prisma.join(preparedIds)}) ORDER BY "id" FOR UPDATE`;
      // A preapproval conversion adopts DRAFT shells. It does not collect,
      // book, sign, issue an invoice or create a first-invoice credit.
      const [signatures, obligations, invoices, deliveries, deposits, credits] = await Promise.all([
        tx.signatureRecord.count({ where: { agreementId: { in: preparedIds } } }),
        tx.agreementSigningPayment.count({ where: { agreementId: { in: preparedIds } } }),
        tx.invoice.count({ where: { agreementId: { in: preparedIds } } }),
        tx.job.count({ where: { agreementId: { in: preparedIds } } }),
        tx.deposit.count({ where: { agreementId: { in: preparedIds } } }),
        tx.signingDownPaymentCredit.count({ where: { agreementId: { in: preparedIds } } }),
      ]);
      if (signatures || obligations || invoices || deliveries || deposits || credits) {
        throw new Error("Prepared conversion cannot silently adopt signed, paid, invoiced or scheduled agreement activity.");
      }
      if (!estimate.customerId) {
        throw new Error("The approved estimate must belong to the prepared agreement customer.");
      }
      const reviewedQuote = await getPreparedEstimateQuoteInTx(tx, estimateId);
      const originalLines = await tx.estimateLineItem.findMany({
        where: { estimateId }, select: {
          description: true, serviceAddressId: true,
        },
      });
      const exactAddresses = resolveConversionAddresses(originalLines, input);
      const evidence = validatePreparedConversion({
        estimateId, customerId: estimate.customerId,
        reviewedQuoteFingerprint: estimate.reviewedQuoteFingerprint,
        reviewedOrderFingerprint: estimate.reviewedOrderFingerprint,
        requestedMode: input.mode,
        requestedAddressId: input.mode === "single" ? input.serviceAddressId : null,
        quoteAddresses: exactAddresses, prepared,
        estimateDepositCents: estimate.depositCents,
        estimateDepositPaidAt: estimate.depositPaidAt, quote: reviewedQuote,
      });
      await tx.estimate.update({
        where: { id: estimateId }, data: { status: "CONVERTED", convertedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId, action: "estimate.convert_prepared",
          entityType: "Estimate", entityId: estimateId,
          newValue: { agreementIds: evidence.agreementIds,
            orderFingerprint: evidence.orderFingerprint,
            quoteFingerprint: evidence.quoteFingerprint,
            dueAtSigningCents: evidence.amountDueAtSigningCents,
            paid: false, signed: false, invoiced: false },
        },
      });
      return evidence.agreementIds;
    }
    if (!estimate.customerId) {
      throw new Error("This estimate isn't linked to a customer yet.");
    }

    const lineItems = await tx.estimateLineItem.findMany({
      where: { estimateId },
      orderBy: [{ createdAt: "asc" }],
    });
    if (lineItems.length === 0) {
      throw new Error("This estimate has no line items to convert.");
    }

    const serviceAddressIds = resolveConversionAddresses(lineItems, input);
    const applyPrepaidDepositHere =
      estimate.depositPaidAt !== null && serviceAddressIds.length === 1;
    const createdAgreementIds: string[] = [];

    for (const serviceAddressId of serviceAddressIds) {
      const agreement = await createDraftAgreementInTx(
        tx,
        userId,
        {
          customerId: estimate.customerId,
          serviceAddressId,
          depositCents: estimate.depositCents,
        },
        { sourceEstimateId: estimate.id, settings },
      );

      if (applyPrepaidDepositHere) {
        await tx.deposit.create({
          data: {
            agreementId: agreement.id,
            amountCents: estimate.depositCents,
            refundable: true,
          },
        });
      }
      createdAgreementIds.push(agreement.id);
    }

    await tx.estimate.update({
      where: { id: estimateId },
      data: { status: "CONVERTED", convertedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "estimate.convert",
        entityType: "Estimate",
        entityId: estimateId,
        newValue: { mode: input.mode, agreementIds: createdAgreementIds },
      },
    });

    return createdAgreementIds;
  });
}
