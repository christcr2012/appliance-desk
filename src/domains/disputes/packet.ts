// OPS-5: collects the facts for a dispute's evidence packet from our own records (read only) and loads the delivery
// photos from the private photo store. The drawing itself is in packet-render.ts.
import { get } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import type { PacketData, PhotoLoader } from "./packet-render";

export const BUSINESS_NAME = "Robinson Appliance Rentals";
const MESSAGE_LOOKBACK_DAYS = 120;
const MAX_MESSAGES = 40;
const MAX_PHOTOS = 24;

/** The agreement's own words about refunds and cancelling, flattened from the evidence saved when it was signed. */
export function refundTermsFrom(evidence: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, label: string) => {
    if (out.length >= 8) return;
    if (typeof value === "string" && value.trim()) out.push(label ? `${label}: ${value.trim()}` : value.trim());
    else if (typeof value === "number" || typeof value === "boolean") out.push(`${label}: ${String(value)}`);
    else if (Array.isArray(value)) value.forEach((item) => walk(item, label));
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) walk(inner, key.replace(/([A-Z])/g, " $1").toLowerCase().trim());
    }
  };
  walk(evidence, "");
  return out;
}

export async function gatherPacketData(disputeId: string, now = new Date()): Promise<PacketData> {
  const dispute = await prisma.paymentDispute.findUniqueOrThrow({ where: { id: disputeId } });
  const customer = dispute.customerId
    ? await prisma.customer.findUnique({ where: { id: dispute.customerId }, select: { user: { select: { name: true, email: true } } } })
    : null;
  const invoice = dispute.invoiceId
    ? await prisma.invoice.findUnique({
        where: { id: dispute.invoiceId },
        include: {
          lineItems: { orderBy: { id: "asc" }, select: { description: true, amountCents: true, quantity: true } },
          payments: { orderBy: { createdAt: "asc" }, select: { createdAt: true, amountCents: true, method: true, status: true } },
          refunds: { orderBy: { createdAt: "asc" }, select: { createdAt: true, amountCents: true, reason: true } },
        },
      })
    : null;
  const agreementId = invoice?.agreementId ?? null;
  const agreement = agreementId
    ? await prisma.rentalAgreement.findUnique({
        where: { id: agreementId },
        select: {
          id: true, startDate: true, termMonths: true, depositCents: true,
          lines: { orderBy: { id: "asc" }, select: { label: true, monthlyPriceCents: true } },
        },
      })
    : null;
  const signature = agreementId
    ? await prisma.signatureRecord.findUnique({
        where: { agreementId },
        select: { provider: true, signedAt: true, signerName: true, signerEmail: true, ipAddress: true },
      })
    : null;
  const signingPayment = agreementId
    ? await prisma.agreementSigningPayment.findFirst({
        where: { agreementId },
        orderBy: { signedAt: "desc" },
        select: { signedAt: true, setupFeeCents: true, downPaymentCents: true, totalCents: true, cancellationPolicyEvidence: true },
      })
    : null;
  const jobs = agreementId
    ? await prisma.job.findMany({
        where: { agreementId, status: "COMPLETED", type: { in: ["DELIVERY", "INSTALLATION", "SWAP"] } },
        orderBy: { completedAt: "asc" },
        select: {
          id: true, type: true, completedAt: true, outcome: true, outcomeNotes: true,
          photos: { orderBy: { createdAt: "asc" }, take: MAX_PHOTOS, select: { id: true, createdAt: true, altText: true } },
        },
      })
    : [];
  const since = new Date(dispute.openedAt.getTime() - MESSAGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const messages = dispute.customerId
    ? await prisma.messageDelivery.findMany({
        where: {
          requestedAt: { gte: since },
          OR: [
            ...(dispute.invoiceId ? [{ subjectType: "Invoice", subjectId: dispute.invoiceId }] : []),
            { recipientType: "CUSTOMER", recipientId: dispute.customerId },
          ],
        },
        orderBy: { requestedAt: "asc" },
        take: MAX_MESSAGES,
        select: { requestedAt: true, channel: true, purpose: true, state: true, renderedSubject: true },
      })
    : [];

  return {
    dispute: {
      id: dispute.id, stripeDisputeId: dispute.stripeDisputeId, amountCents: dispute.amountCents,
      reason: dispute.reason, openedAt: dispute.openedAt, dueBy: dispute.dueBy,
    },
    customer: { name: customer?.user.name ?? customer?.user.email ?? "Unknown customer", email: customer?.user.email ?? null },
    agreement: agreement
      ? {
          id: agreement.id, startDate: agreement.startDate, termMonths: agreement.termMonths, depositCents: agreement.depositCents,
          lines: agreement.lines,
          signature,
          signingPayment: signingPayment
            ? { signedAt: signingPayment.signedAt, setupFeeCents: signingPayment.setupFeeCents, downPaymentCents: signingPayment.downPaymentCents, totalCents: signingPayment.totalCents }
            : null,
          refundTerms: refundTermsFrom(signingPayment?.cancellationPolicyEvidence),
        }
      : null,
    deliveries: jobs.map((job) => ({
      id: job.id, type: job.type, completedAt: job.completedAt, outcome: job.outcome, notes: job.outcomeNotes,
      photos: job.photos.map((photo) => ({ id: photo.id, takenAt: photo.createdAt, label: photo.altText ?? `${job.type.toLowerCase()} photo` })),
    })),
    invoice: invoice
      ? {
          number: invoice.invoiceNumber, issuedAt: invoice.issuedAt, dueDate: invoice.dueDate,
          periodStart: invoice.billingPeriodStart, periodEnd: invoice.billingPeriodEnd,
          subtotalCents: invoice.subtotalCents, taxCents: invoice.taxCents, lateFeeCents: invoice.lateFeeCents,
          amountDueCents: invoice.amountDueCents, amountPaidCents: invoice.amountPaidCents,
          lines: invoice.lineItems,
          payments: invoice.payments.map((p) => ({ at: p.createdAt, amountCents: p.amountCents, method: p.method, status: p.status })),
          refunds: invoice.refunds.map((r) => ({ at: r.createdAt, amountCents: r.amountCents, reason: r.reason })),
        }
      : null,
    messages: messages.map((m) => ({ at: m.requestedAt, channel: m.channel, purpose: m.purpose, state: m.state, subject: m.renderedSubject })),
    businessName: BUSINESS_NAME,
    generatedAt: now,
  };
}

/** Reads one delivery photo from the private store, with the same address checks the photo route uses. */
export const loadPrivatePhoto: PhotoLoader = async (photoId) => {
  const store = getPrivatePhotoStore();
  if (!store) return null;
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, select: { url: true } });
  if (!photo) return null;
  if (!privatePhotoPathFromUrl(photo.url, store.storeId)) return null;
  const result = await get(photo.url, { token: store.token, access: "private", useCache: true, abortSignal: AbortSignal.timeout(15_000) });
  if (!result || result.statusCode !== 200) return null;
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 15_000_000) return null;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};
