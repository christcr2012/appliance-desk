import { prisma } from "@/lib/prisma";
import type { EstimateStatus } from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { getBusinessSettings } from "@/domains/settings";
import { createDraftAgreement } from "@/domains/agreements";

// ---------------------------------------------------------------------------
// Estimates (2026-09-29 — see docs/DECISIONS.md's "Estimates for
// property managers / bulk & multi-unit deals" entry for the full
// writeup and docs/BUSINESS-RULES.md for the plain-English rule this
// implements). Chris's own framing: a client ordering appliances for a
// whole apartment complex isn't standard free-delivery/standard-fee
// self-checkout, nor an ordinary one-off inquiry — it needs a real,
// custom-priced estimate, but only for the deals that actually need
// one. So this is deliberately:
//
// - Staff-created only (OWNER/ADMIN, from an existing Customer) —
//   never auto-generated from a Lead's answers. A "property manager"
//   flag never silently changes anyone's price on its own.
// - A pricing PROPOSAL, not a commitment — creating or sending an
//   Estimate never reserves real inventory. Converting an approved one
//   (convertEstimateToAgreements, below) only creates DRAFT
//   RentalAgreement "shells" with the agreed high-level terms; Chris
//   still adds real RentalLine(s) with actual physical appliances the
//   normal way (src/domains/agreements's addRentalLine), same
//   appliance-reservation safeguards as every other agreement.
// - The public approval link reuses the exact pattern the e-signature
//   flow already established (SignatureRecord/the /sign/[id] page):
//   the record's own unguessable cuid `id` IS the link, gated by
//   possession of it, not a login.
// ---------------------------------------------------------------------------

const EDITABLE_STATUSES: EstimateStatus[] = ["DRAFT", "CHANGES_REQUESTED"];
// A status the public link should still render something useful for —
// everything except DRAFT (never sent, so the link shouldn't be
// reachable yet).
const PUBLICLY_VIEWABLE_STATUSES: EstimateStatus[] = [
  "SENT",
  "VIEWED",
  "APPROVED",
  "CHANGES_REQUESTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
];

export type NewEstimateInput = {
  customerId: string;
  title: string;
  clientMessage?: string;
  internalNotes?: string;
  depositCents?: number;
  validUntil?: Date | null;
};

export async function createEstimateDraft(userId: string, input: NewEstimateInput) {
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

export type NewEstimateLineItemInput = {
  serviceAddressId?: string | null;
  description: string;
  quantity: number;
  monthlyPriceCents?: number;
  oneTimeFeeCents?: number;
};

/** Adds a line item to an estimate still being worked on (DRAFT, or
 * CHANGES_REQUESTED — a customer asked for changes and Chris is
 * revising it before re-sending). Any other status means it's already
 * out for a decision or settled, and editing it there would silently
 * change what a customer already saw/approved. */
export async function addEstimateLineItem(
  userId: string,
  estimateId: string,
  input: NewEstimateLineItemInput,
) {
  const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  if (!EDITABLE_STATUSES.includes(estimate.status)) {
    throw new Error("This estimate has already been sent — you can't edit its line items now.");
  }
  if (input.quantity < 1) {
    throw new Error("Quantity must be at least 1.");
  }
  if ((input.monthlyPriceCents ?? 0) === 0 && (input.oneTimeFeeCents ?? 0) === 0) {
    throw new Error("Enter a monthly amount, a one-time fee, or both — not zero for everything.");
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

export async function removeEstimateLineItem(userId: string, lineItemId: string) {
  const line = await prisma.estimateLineItem.findUniqueOrThrow({
    where: { id: lineItemId },
    include: { estimate: true },
  });
  if (!EDITABLE_STATUSES.includes(line.estimate.status)) {
    throw new Error("This estimate has already been sent — you can't edit its line items now.");
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

/** Every estimate across every customer, newest first — feeds
 * /desk/estimates. Unpaginated for now, same call as this app's other
 * smaller lists (see docs/ROADMAP.md's pagination note) — fine at
 * today's size, worth revisiting once this list reaches the low
 * thousands. */
export async function getAllEstimates() {
  return prisma.estimate.findMany({
    include: {
      customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
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
      lineItems: { include: { serviceAddress: true }, orderBy: [{ createdAt: "asc" }] },
      createdAgreements: { select: { id: true, serviceAddressId: true, status: true } },
    },
  });
}

export function totalMonthlyCents(lineItems: { monthlyPriceCents: number; quantity: number }[]): number {
  return lineItems.reduce((sum, l) => sum + l.monthlyPriceCents * l.quantity, 0);
}
export function totalOneTimeCents(lineItems: { oneTimeFeeCents: number; quantity: number }[]): number {
  return lineItems.reduce((sum, l) => sum + l.oneTimeFeeCents * l.quantity, 0);
}

/** Marks an estimate SENT and emails the customer a link to view and
 * approve it (reusing the same branded-email wrapper every other
 * transactional email in this app already uses — see src/lib/email.ts).
 * Requires at least one line item; an empty estimate has nothing for
 * the customer to actually approve. */
export async function sendEstimate(userId: string, estimateId: string) {
  const estimate = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: {
      lineItems: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
    },
  });
  if (!EDITABLE_STATUSES.includes(estimate.status)) {
    throw new Error("This estimate has already been sent.");
  }
  if (estimate.lineItems.length === 0) {
    throw new Error("Add at least one line item before sending this estimate.");
  }

  await prisma.$transaction([
    prisma.estimate.update({
      where: { id: estimateId },
      data: { status: "SENT", sentAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        userId,
        action: "estimate.send",
        entityType: "Estimate",
        entityId: estimateId,
      },
    }),
  ]);

  const settings = await getBusinessSettings();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://robinsonappliancerentals.com";
  const monthly = totalMonthlyCents(estimate.lineItems);
  const oneTime = totalOneTimeCents(estimate.lineItems);
  const customerName = estimate.customer.user.name ?? estimate.customer.user.email;

  const parts = [
    `Hi${customerName ? ` ${customerName}` : ""},`,
    `${settings.publicBusinessName} has prepared estimate #${estimate.estimateNumber}${estimate.title ? ` (${estimate.title})` : ""} for you.`,
  ];
  if (monthly > 0) parts.push(`Estimated recurring total: $${(monthly / 100).toFixed(2)}/month.`);
  if (oneTime > 0) parts.push(`Estimated one-time charges: $${(oneTime / 100).toFixed(2)}.`);
  if (estimate.clientMessage) parts.push(estimate.clientMessage);
  parts.push("Review the full details and let us know if it works for you:");
  parts.push(`${appUrl}/estimate/${estimate.id}`);

  await sendEmail({
    to: estimate.customer.user.email,
    subject: `Estimate #${estimate.estimateNumber} from ${settings.publicBusinessName}`,
    text: parts.join("\n\n"),
    actionLabel: "View & respond to estimate",
  });
}

/** Loads what the public /estimate/[id] page needs. Viewable any time
 * after it's been sent — including after a final decision — so the
 * link always shows the estimate's current, real status rather than
 * going dead the moment something happens. Marks it VIEWED (once) the
 * first time it's actually opened after being sent, same spirit as
 * SignatureRecord's own read-tracking. */
export async function getEstimateForApproval(id: string) {
  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: {
      customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
      lineItems: { include: { serviceAddress: true }, orderBy: [{ createdAt: "asc" }] },
    },
  });
  if (!estimate || !PUBLICLY_VIEWABLE_STATUSES.includes(estimate.status)) return null;

  if (estimate.status === "SENT") {
    await prisma.estimate.update({
      where: { id },
      data: { status: "VIEWED", viewedAt: new Date() },
    });
    return { ...estimate, status: "VIEWED" as EstimateStatus, viewedAt: new Date() };
  }

  return estimate;
}

export type ApproveEstimateInput = {
  approverName: string;
  approverEmail: string;
  ipAddress: string | null;
};

/** The customer's own approval action — no login required, gated
 * entirely by having the unguessable estimate link (see the file
 * comment at the top). Only SENT/VIEWED can be approved: not DRAFT (not
 * sent yet), and not already APPROVED/DECLINED/CONVERTED (no re-deciding
 * through a stale tab). */
export async function approveEstimate(id: string, input: ApproveEstimateInput) {
  const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id } });
  if (estimate.status !== "SENT" && estimate.status !== "VIEWED") {
    throw new Error("This estimate isn't available to approve right now.");
  }

  await prisma.estimate.update({
    where: { id },
    data: {
      status: "APPROVED",
      respondedAt: new Date(),
      approverName: input.approverName,
      approverEmail: input.approverEmail,
      approverIpAddress: input.ipAddress,
    },
  });
}

/** The customer asking for changes instead of approving — same access
 * rule as approveEstimate. Leaves the estimate visible to Chris with
 * their message so he can revise the line items and re-send. */
export async function requestEstimateChanges(id: string, message: string) {
  const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id } });
  if (estimate.status !== "SENT" && estimate.status !== "VIEWED") {
    throw new Error("This estimate isn't available to respond to right now.");
  }
  if (!message.trim()) {
    throw new Error("Let us know what you'd like changed.");
  }

  await prisma.estimate.update({
    where: { id },
    data: {
      status: "CHANGES_REQUESTED",
      respondedAt: new Date(),
      changesRequestedMessage: message.trim(),
    },
  });
}

export type ConvertEstimateInput =
  | { mode: "single"; serviceAddressId: string }
  | { mode: "per-property" };

/** Pure — no database access, directly unit-testable (see
 * tests/estimates.test.ts) — same reasoning as
 * canTransitionAgreementStatus in src/domains/agreements. Works out
 * which property address(es) the resulting agreement(s) should be
 * attached to; convertEstimateToAgreements below just loops over the
 * result and calls createDraftAgreement once per address. */
export function resolveConversionAddresses(
  lineItems: { description: string; serviceAddressId: string | null }[],
  input: ConvertEstimateInput,
): string[] {
  if (input.mode === "single") {
    return [input.serviceAddressId];
  }
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
 * Converts an APPROVED estimate into one or more DRAFT RentalAgreement
 * shells, using createDraftAgreement (the same function the ordinary
 * "new agreement" desk flow uses) so a converted estimate produces
 * agreements identical in shape to any other. Deliberately does NOT
 * add RentalLine/appliance assignments here — see the file comment at
 * the top for why: that step always needs Chris to pick real physical
 * appliances (src/domains/agreements's addRentalLine already enforces
 * this atomically), which an estimate's line items — pricing intent,
 * not inventory reservations — were never meant to bypass.
 *
 * "single": every line item's pricing rolls into one agreement,
 * attached to the one serviceAddressId given (the estimate's line
 * items may reference several properties or none — this mode ignores
 * that and puts it all on one address, e.g. the complex's own address
 * on file). "per-property": groups line items by their own
 * serviceAddressId into one agreement per distinct property — every
 * line item must have one set, or this throws rather than silently
 * dropping a line item's terms.
 */
export async function convertEstimateToAgreements(
  userId: string,
  estimateId: string,
  input: ConvertEstimateInput,
) {
  const estimate = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: { lineItems: true },
  });
  if (estimate.status !== "APPROVED") {
    throw new Error("Only an approved estimate can be converted.");
  }
  if (estimate.lineItems.length === 0) {
    throw new Error("This estimate has no line items to convert.");
  }

  const serviceAddressIds = resolveConversionAddresses(estimate.lineItems, input);

  const createdAgreementIds: string[] = [];

  // The line items themselves aren't copied onto the new agreement here
  // (see the function comment above) — they stay visible as reference
  // on the estimate's own page (getEstimateDetail links back to every
  // agreement it produced) for Chris to work from while adding real
  // RentalLine(s) the normal way.
  for (const serviceAddressId of serviceAddressIds) {
    const agreement = await createDraftAgreement(userId, {
      customerId: estimate.customerId,
      serviceAddressId,
      depositCents: estimate.depositCents,
    });
    await prisma.rentalAgreement.update({
      where: { id: agreement.id },
      data: { sourceEstimateId: estimate.id },
    });
    createdAgreementIds.push(agreement.id);
  }

  await prisma.estimate.update({
    where: { id: estimateId },
    data: { status: "CONVERTED", convertedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "estimate.convert",
      entityType: "Estimate",
      entityId: estimateId,
      newValue: { mode: input.mode, agreementIds: createdAgreementIds },
    },
  });

  return createdAgreementIds;
}
