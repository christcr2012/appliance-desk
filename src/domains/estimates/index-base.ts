import { prisma } from "@/lib/prisma";
import type { EstimateStatus, Prisma } from "@prisma/client";
import { deliverMessage } from "@/domains/messaging/deliver";
import { getBusinessSettings } from "@/domains/settings";
import { createDraftAgreementInTx } from "@/domains/agreements";\nimport { locateServiceAddress } from "@/domains/tax/locations";
import {
  createLeadManually,
  convertLeadToCustomerInTx,
  sendCustomerActivationEmail,
  type ManualLeadInput,
} from "@/domains/leads";

import { isEstimatePastValidity } from "./validity";

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
};

export async function createEstimateDraft(
  userId: string,
  input: NewEstimateInput,
) {
  const estimate = await prisma.estimate.create({
    data: {
      customerId: input.customerId,
      title: input.title,
      clientMessage: input.clientMessage || null,
      internalNotes: input.internalNotes || null,
      depositCents: input.depositCents ?? 0,
      validUntil: input.validUntil ?? null,
      createdByUserId: userId,
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

  const line = await prisma.estimateLineItem.create({
    data: {
      estimateId,
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
      newValue: { description: input.description, quantity: input.quantity },
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
export async function sendEstimate(userId: string, estimateId: string): Promise<{ emailed: boolean; outcome?: string }> {
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
      data: { status: "SENT", sentAt },
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
    return { estimate, recipientEmail, recipientName, sentAt };
  });
  const { estimate, recipientEmail, recipientName, sentAt } = claimed;

  const settings = await getBusinessSettings();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://robinsonappliancerentals.com";
  const monthly = totalMonthlyCents(estimate.lineItems);
  const oneTime = totalOneTimeCents(estimate.lineItems);
  const parts = [
    `Hi${recipientName ? ` ${recipientName}` : ""},`,
    `${settings.publicBusinessName} has prepared estimate #${estimate.estimateNumber}${estimate.title ? ` (${estimate.title})` : ""} for you.`,
  ];
  if (monthly > 0) {
    parts.push(`Estimated recurring total: $${(monthly / 100).toFixed(2)}/month.`);
  }
  if (oneTime > 0) {
    parts.push(`Estimated one-time charges: $${(oneTime / 100).toFixed(2)}.`);
  }
  if (estimate.clientMessage) parts.push(estimate.clientMessage);
  parts.push("Review the full details and let us know if it works for you:");
  parts.push(`${appUrl}/estimate/${estimate.id}`);

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
      subject: `Estimate #${estimate.estimateNumber} from ${settings.publicBusinessName}`,
      text: parts.join("\n\n"),
      actionLabel: "View & respond to estimate",
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

  for (const estimate of dueEstimates) {
    if (!estimate.sentAt) continue;
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
        render: () => ({
          subject: `Following up on estimate #${estimate.estimateNumber}`,
          text: [
            `Hi${recipientName ? ` ${recipientName}` : ""},`,
            `Just checking in — ${settings.publicBusinessName} sent you estimate #${estimate.estimateNumber}${estimate.title ? ` (${estimate.title})` : ""} a few days ago and wanted to make sure it didn't get lost.`,
            "Still interested? You can review and respond right here — no login needed:",
            `${appUrl}/estimate/${estimate.id}`,
            "If your plans have changed or you have questions, just reply to this email.",
          ].join("\n\n"),
          actionLabel: "View & respond to estimate",
        }),
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
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (existing.length === 0) {
        throw new Error(
          "This estimate is marked converted but has no linked agreements. Review it before retrying.",
        );
      }
      return existing.map((agreement) => agreement.id);
    }

    if (estimate.status !== "APPROVED") {
      throw new Error("Only an approved estimate can be converted.");
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
