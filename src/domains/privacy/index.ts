import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { deliverMessage } from "@/domains/messaging/deliver";
import { deletePrivatePhotoWithRecovery, getPrivatePhotoStore } from "@/lib/photo-storage";

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
const PRIVACY_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 } as const;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

function isVercelBlobUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

async function requireOwner(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, archivedAt: true },
  });
  if (!user || user.archivedAt || user.role !== "OWNER") {
    throw new Error("Owner access is required.");
  }
}

export async function openPrivacyRequest(input: {
  kind: "EXPORT" | "DELETE";
  email: string;
  customerId?: string;
  ipKey: string;
}): Promise<{
  requestId: string;
  verification: "SESSION" | "EMAIL_SENT" | "OWNER_WILL_CALL";
}> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");

  if (!input.customerId) {
    if (await isRateLimited(`privacy:${input.ipKey}`, PRIVACY_RATE_LIMIT)) {
      throw new Error("Too many privacy requests. Try again later.");
    }
  }

  if (input.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, user: { select: { email: true } } },
    });
    if (!customer || normalizeEmail(customer.user.email) !== email) {
      throw new Error("That privacy request does not match the signed-in customer.");
    }
    const request = await prisma.privacyRequest.create({
      data: {
        kind: input.kind,
        status: "VERIFIED",
        customerId: customer.id,
        requesterEmail: email,
        verifiedAt: new Date(),
        notes: "Identity verified by signed-in customer session.",
      },
      select: { id: true },
    });
    return { requestId: request.id, verification: "SESSION" };
  }

  const customer = await prisma.customer.findFirst({
    where: { user: { email: { equals: email, mode: "insensitive" } } },
    select: { id: true },
  });
  const token = customer ? randomBytes(32).toString("hex") : null;
  const request = await prisma.privacyRequest.create({
    data: {
      kind: input.kind,
      customerId: customer?.id ?? null,
      requesterEmail: email,
      verificationTokenHash: token ? tokenHash(token) : null,
      verificationExpiresAt: token ? new Date(Date.now() + TOKEN_TTL_MS) : null,
      notes: customer ? "Public request awaiting email verification." : "Public request has no matching customer; verify by phone if appropriate.",
    },
    select: { id: true },
  });

  if (!customer || !token) {
    return { requestId: request.id, verification: "OWNER_WILL_CALL" };
  }

  const verifyUrl = `${publicOrigin()}/privacy/verify?request=${encodeURIComponent(request.id)}&token=${encodeURIComponent(token)}`;
  const delivery = await deliverMessage({
    idempotencyKey: `privacy-verification-${request.id}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "privacy-verification",
    customerFacing: true,
    recipient: { type: "Customer", id: customer.id, address: email },
    subject: { type: "PrivacyRequest", id: request.id },
    render: () => ({
      subject: "Verify your privacy request",
      text: `We received a request about your personal information. Use the link below within 48 hours to verify that request.\n\n${verifyUrl}\n\nIf you did not make this request, you can ignore this message.`,
      actionLabel: "Verify privacy request",
    }),
  });

  if (delivery.state === "ACCEPTED" || delivery.state === "DELIVERED") {
    return { requestId: request.id, verification: "EMAIL_SENT" };
  }

  if (delivery.state === "UNKNOWN" || delivery.state === "PENDING") {
    // The email may already contain the only copy of this token. Keep it valid so a customer who did receive the
    // message can still verify, but route the request to owner review instead of claiming the email was sent.
    await prisma.privacyRequest.update({
      where: { id: request.id },
      data: {
        notes: "Verification email outcome is uncertain; the link remains valid if it arrived. Owner should verify by phone if the customer cannot use it.",
      },
    });
    return { requestId: request.id, verification: "OWNER_WILL_CALL" };
  }

  await prisma.privacyRequest.update({
    where: { id: request.id },
    data: {
      verificationTokenHash: null,
      verificationExpiresAt: null,
      notes: "Verification email was not sent; owner must verify identity by phone.",
    },
  });
  return { requestId: request.id, verification: "OWNER_WILL_CALL" };
}

export async function verifyPrivacyRequest(requestId: string, token: string): Promise<void> {
  const request = await prisma.privacyRequest.findUnique({
    where: { id: requestId },
    select: {
      status: true,
      verificationTokenHash: true,
      verificationExpiresAt: true,
      customerId: true,
    },
  });
  if (
    !request ||
    request.status !== "RECEIVED" ||
    !request.customerId ||
    !request.verificationTokenHash ||
    !request.verificationExpiresAt ||
    request.verificationExpiresAt <= new Date()
  ) {
    throw new Error("This verification link is invalid or expired.");
  }

  const supplied = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(request.verificationTokenHash, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("This verification link is invalid or expired.");
  }

  const changed = await prisma.privacyRequest.updateMany({
    where: {
      id: requestId,
      status: "RECEIVED",
      verificationTokenHash: request.verificationTokenHash,
      verificationExpiresAt: { gt: new Date() },
    },
    data: {
      status: "VERIFIED",
      verifiedAt: new Date(),
      verificationTokenHash: null,
      verificationExpiresAt: null,
      notes: "Identity verified through the single-use email link.",
    },
  });
  if (changed.count !== 1) throw new Error("This verification link is invalid or expired.");
}

export async function verifyPrivacyRequestByOwner(userId: string, requestId: string): Promise<void> {
  await requireOwner(userId);
  const changed = await prisma.privacyRequest.updateMany({
    where: { id: requestId, status: "RECEIVED", customerId: { not: null } },
    data: {
      status: "VERIFIED",
      verifiedAt: new Date(),
      verificationTokenHash: null,
      verificationExpiresAt: null,
      notes: "Identity verified by the owner outside the app (for example, by phone).",
    },
  });
  if (changed.count !== 1) throw new Error("This request cannot be marked verified.");
}

export async function listPrivacyRequestsForOwner(userId: string) {
  await requireOwner(userId);
  return prisma.privacyRequest.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
}

export async function listPrivacyRequestsForCustomer(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!customer) return [];
  return prisma.privacyRequest.findMany({
    where: { customerId: customer.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, kind: true, status: true, createdAt: true, fulfilledAt: true, rejectedReason: true },
  });
}

export async function buildPrivacyExport(userId: string, requestId: string): Promise<Buffer> {
  await requireOwner(userId);
  const request = await prisma.privacyRequest.findUnique({
    where: { id: requestId },
    select: { kind: true, status: true, customerId: true, requesterEmail: true, createdAt: true },
  });
  if (!request || request.kind !== "EXPORT" || request.status !== "VERIFIED" || !request.customerId) {
    throw new Error("Only a verified export request can be fulfilled.");
  }
  const customerId = request.customerId;
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: {
      id: true,
      phone: true,
      isBusiness: true,
      isPropertyManager: true,
      companyName: true,
      smsOptInAt: true,
      createdAt: true,
      updatedAt: true,
      archivedAt: true,
      user: { select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true, archivedAt: true } },
    },
  });
  const agreements = await prisma.rentalAgreement.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
  const agreementIds = agreements.map((row) => row.id);
  const invoices = await prisma.invoice.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
  const invoiceIds = invoices.map((row) => row.id);
  const data = await Promise.all([
    prisma.serviceAddress.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.rentalLine.findMany({ where: { agreementId: { in: agreementIds } }, orderBy: { createdAt: "asc" } }),
    prisma.signatureRecord.findMany({ where: { agreementId: { in: agreementIds } }, orderBy: { createdAt: "asc" } }),
    prisma.maintenanceRequest.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.invoiceLineItem.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: { createdAt: "asc" } }),
    prisma.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: { createdAt: "asc" } }),
    prisma.refund.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: { createdAt: "asc" } }),
    prisma.receipt.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.customerCredit.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.consentRecord.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.customerNotice.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.customerContact.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.customerNote.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.job.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.estimate.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.documentArtifact.findMany({ where: { customerId }, orderBy: { generatedAt: "asc" }, select: { id: true, kind: true, subjectType: true, subjectId: true, version: true, payload: true, sha256: true, rendererVersion: true, generatedAt: true } }),
    prisma.privacyRequest.findMany({ where: { customerId }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true, createdAt: true, verifiedAt: true, fulfilledAt: true, rejectedReason: true } }),
  ]);
  const [serviceAddresses, rentalLines, signatures, maintenanceRequests, invoiceLineItems, payments, refunds, receipts, credits, consents, notices, contacts, notes, jobs, estimates, artifacts, privacyRequests] = data;

  const exportObject = {
    exportedAt: new Date().toISOString(),
    request: { kind: request.kind, requestedAt: request.createdAt, requesterEmail: request.requesterEmail },
    customer,
    serviceAddresses,
    rentalAgreements: agreements,
    rentalLines,
    signatures,
    maintenanceRequests,
    invoices,
    invoiceLineItems,
    payments,
    refunds,
    receipts,
    credits,
    consents,
    notices,
    contacts,
    notes,
    jobs,
    estimates,
    documentArtifacts: artifacts,
    privacyRequests,
  };
  return Buffer.from(JSON.stringify(exportObject, null, 2), "utf8");
}

const PSEUDONYMIZED = ["User", "Customer", "ServiceAddress", "CustomerContact", "Lead"];
const RETAINED = ["Invoice", "Payment", "Receipt", "Refund", "CustomerCredit", "SignatureRecord", "DocumentArtifact", "CustomerNotice", "AuditLog"];

type PrivacyDeletionClaim = {
  fulfilled: boolean;
  customerId: string | null;
  photoIds: string[];
  blobUrls: string[];
  blobStore: { token: string; storeId: string } | null;
};

async function claimPrivacyDeletion(
  userId: string,
  requestId: string,
): Promise<PrivacyDeletionClaim> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PrivacyRequest" WHERE "id" = ${requestId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("Privacy request not found.");

    const request = await tx.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.kind !== "DELETE" || !request.customerId) {
      throw new Error("This is not a customer deletion request.");
    }
    if (request.status === "FULFILLED") {
      return { fulfilled: true, customerId: null, photoIds: [], blobUrls: [], blobStore: null };
    }
    if (request.status !== "VERIFIED") {
      throw new Error("Verify the customer's identity before deleting personal data.");
    }
    if (request.fulfilledByUserId && request.fulfilledByUserId !== userId) {
      throw new Error("This deletion is already being fulfilled by another owner.");
    }

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: request.customerId },
      select: { id: true, userId: true },
    });
    const privateRequestPhotos = await tx.photo.findMany({
      where: {
        applianceId: null,
        jobId: null,
        maintenanceRequest: { customerId: customer.id },
      },
      select: { id: true, url: true },
    });
    const blobUrls = privateRequestPhotos.map((row) => row.url).filter(isVercelBlobUrl);
    const privateStore = blobUrls.length > 0 ? getPrivatePhotoStore() : null;
    if (blobUrls.length > 0 && !privateStore) {
      throw new Error("Private photo storage is unavailable; privacy deletion was not fulfilled.");
    }

    // Claim the destructive workflow before any external side effect. Revoking
    // sessions here prevents a customer from adding a new private photo while
    // the Blob delete is in flight. A failed Blob call leaves the request
    // VERIFIED and claimed, so the owner can safely retry without duplicating
    // the database pseudonymization.
    await tx.session.deleteMany({ where: { userId: customer.userId } });
    if (!request.fulfilledByUserId) {
      const claimed = await tx.privacyRequest.updateMany({
        where: { id: requestId, status: "VERIFIED", fulfilledByUserId: null },
        data: {
          fulfilledByUserId: userId,
          notes: "Deletion fulfillment claimed; private-photo deletion pending.",
        },
      });
      if (claimed.count !== 1) {
        throw new Error("This deletion is already being fulfilled.");
      }
    }

    return {
      fulfilled: false,
      customerId: customer.id,
      photoIds: privateRequestPhotos.map((row) => row.id),
      blobUrls,
      blobStore: privateStore,
    };
  });
}

export async function fulfillPrivacyDeletion(
  userId: string,
  requestId: string,
  confirmation: "DELETE",
): Promise<{ pseudonymized: string[]; retained: string[] }> {
  await requireOwner(userId);
  if (confirmation !== "DELETE") throw new Error("Type DELETE to confirm this privacy deletion.");

  const claim = await claimPrivacyDeletion(userId, requestId);
  if (claim.fulfilled) {
    return { pseudonymized: [...PSEUDONYMIZED], retained: [...RETAINED] };
  }

  // External provider work deliberately happens outside the database
  // transaction. DELETE is retry-safe by server-state effect: if a previous
  // attempt removed some/all objects and crashed before the local commit, a
  // retry converges on the same missing-object state.
  if (claim.blobUrls.length > 0) {
    if (!claim.blobStore) {
      throw new Error("Private photo storage is unavailable; privacy deletion was not fulfilled.");
    }
    for (const blobUrl of claim.blobUrls) {
      await deletePrivatePhotoWithRecovery(blobUrl, claim.blobStore);
    }
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PrivacyRequest" WHERE "id" = ${requestId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("Privacy request not found.");

    const request = await tx.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status === "FULFILLED") {
      return { pseudonymized: [...PSEUDONYMIZED], retained: [...RETAINED] };
    }
    if (
      request.kind !== "DELETE" ||
      !request.customerId ||
      request.customerId !== claim.customerId ||
      request.status !== "VERIFIED" ||
      request.fulfilledByUserId !== userId
    ) {
      throw new Error("This privacy deletion can no longer be fulfilled from this claim.");
    }

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: request.customerId },
      select: { id: true, userId: true, user: { select: { email: true } } },
    });
    const now = new Date();
    const deletedEmail = `deleted-${customer.userId}@invalid`;

    await tx.session.deleteMany({ where: { userId: customer.userId } });
    await tx.account.updateMany({
      where: { userId: customer.userId },
      data: { accessToken: null, refreshToken: null, idToken: null, password: null },
    });
    await tx.user.update({
      where: { id: customer.userId },
      data: {
        name: "Deleted customer",
        email: deletedEmail,
        emailVerified: false,
        image: null,
        passwordHash: null,
        archivedAt: now,
      },
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: { phone: null, companyName: null, smsOptInAt: null, archivedAt: now },
    });
    await tx.serviceAddress.updateMany({
      where: { customerId: customer.id },
      data: { line1: "Deleted address", line2: null, city: "Deleted", state: "CO", zip: "00000" },
    });
    await tx.customerContact.updateMany({
      where: { customerId: customer.id },
      data: { name: "Deleted customer", role: null, phone: null, email: null, notes: null },
    });
    await tx.lead.updateMany({
      where: {
        OR: [
          { convertedCustomerId: customer.id },
          { email: { equals: customer.user.email, mode: "insensitive" } },
        ],
      },
      data: {
        companyName: null,
        contactName: "Deleted customer",
        phone: "deleted",
        email: deletedEmail,
        bestTimeToContact: null,
        notes: null,
        addressLine1: null,
        city: null,
        zip: null,
        referredByCode: null,
      },
    });

    if (claim.photoIds.length > 0) {
      await tx.photo.deleteMany({ where: { id: { in: claim.photoIds } } });
    }

    await tx.privacyRequest.update({
      where: { id: requestId },
      data: {
        status: "FULFILLED",
        requesterEmail: deletedEmail,
        fulfilledAt: now,
        fulfilledByUserId: userId,
        verificationTokenHash: null,
        verificationExpiresAt: null,
        notes: `Personal fields pseudonymized. ${claim.photoIds.length} maintenance-request-only photo(s) deleted. Financial, signature, document, notice and audit evidence retained.`,
      },
    });

    return { pseudonymized: [...PSEUDONYMIZED], retained: [...RETAINED] };
  });
}

export async function markPrivacyExportFulfilled(userId: string, requestId: string): Promise<void> {
  await requireOwner(userId);
  const changed = await prisma.privacyRequest.updateMany({
    where: { id: requestId, kind: "EXPORT", status: "VERIFIED" },
    data: { status: "FULFILLED", fulfilledAt: new Date(), fulfilledByUserId: userId },
  });
  if (changed.count !== 1) throw new Error("This export request cannot be marked fulfilled.");
}

export async function rejectPrivacyRequest(userId: string, requestId: string, reason: string): Promise<void> {
  await requireOwner(userId);
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error("Give a short reason for rejecting this request.");
  const changed = await prisma.privacyRequest.updateMany({
    where: {
      id: requestId,
      status: { in: ["RECEIVED", "VERIFIED"] },
      fulfilledByUserId: null,
    },
    data: {
      status: "REJECTED",
      rejectedReason: trimmed,
      fulfilledAt: new Date(),
      fulfilledByUserId: userId,
      verificationTokenHash: null,
      verificationExpiresAt: null,
    },
  });
  if (changed.count !== 1) throw new Error("This privacy request cannot be rejected.");
}

export async function privacyRequestForCustomer(userId: string, requestId: string) {
  const customer = await prisma.customer.findUnique({ where: { userId }, select: { id: true } });
  if (!customer) return null;
  return prisma.privacyRequest.findFirst({
    where: { id: requestId, customerId: customer.id },
    select: { id: true, kind: true, status: true, createdAt: true, fulfilledAt: true, rejectedReason: true },
  });
}

export type PrivacyRequestTransaction = Prisma.TransactionClient;