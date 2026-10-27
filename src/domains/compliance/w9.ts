import { createHash, randomBytes, randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { encryptField, hasFieldCryptoKey } from "@/lib/field-crypto";
import { getPrivatePhotoStore } from "@/lib/photo-storage";

/**
 * CMP-3 — W-9 collection for 1099 suppliers.
 *
 * The supplier gets a one-time link (only the token's hash is stored; the
 * link works once and expires after 14 days) to a public page where they
 * either upload their signed W-9 PDF or type the form, which produces a
 * filled W-9 PDF. Either way the tax ID is kept only encrypted (the same
 * field crypto as the owner's EIN), screens show the last 4, and nothing
 * about the TIN is ever written to an audit row or a log — audits record
 * that a W-9 arrived, never its contents.
 */

export const W9_REQUEST_TTL_DAYS = 14;
export const MAX_W9_FILE_BYTES = 4 * 1024 * 1024;

export function hashW9Token(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tinDigits(tin: string): string {
  return tin.replace(/[^0-9]/g, "");
}

export function assertValidTin(tin: string): string {
  const digits = tinDigits(tin);
  if (digits.length !== 9) throw new Error("A tax ID is 9 digits.");
  return digits;
}

/** OWNER/ADMIN: mint a fresh one-time W-9 link for a supplier (any older unused link stops working). */
export async function createW9Request(
  actorId: string,
  supplierId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + W9_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    // Lock the supplier row first: two requests issued at the same moment
    // must serialize, or both could delete-then-create and leave two live
    // links (PR #655 review).
    await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "id" = ${supplierId} FOR UPDATE`;
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new Error("That supplier no longer exists.");
    await tx.w9Request.deleteMany({ where: { supplierId, usedAt: null } });
    await tx.w9Request.create({
      data: { supplierId, tokenHash: hashW9Token(token), expiresAt, createdByUserId: actorId },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "supplier.w9_requested", entityType: "Supplier", entityId: supplierId, newValue: {} },
    });
  });
  return { token, expiresAt };
}

export type W9LinkState =
  | { ok: true; requestId: string; supplierId: string; supplierName: string }
  | { ok: false; reason: "unknown" | "used" | "expired" };

/** What the public page may know about a link — never anything about the TIN. */
export async function w9LinkState(token: string, now: Date = new Date()): Promise<W9LinkState> {
  if (!token || token.length > 200) return { ok: false, reason: "unknown" };
  const request = await prisma.w9Request.findUnique({
    where: { tokenHash: hashW9Token(token) },
    include: { supplier: { select: { name: true } } },
  });
  if (!request) return { ok: false, reason: "unknown" };
  if (request.usedAt) return { ok: false, reason: "used" };
  if (request.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, requestId: request.id, supplierId: request.supplierId, supplierName: request.supplier.name };
}

/** The shared write behind every way a W-9 arrives. Locks the request and the supplier; audits no TIN. */
export interface W9MailingAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

async function completeW9(args: {
  requestId: string;
  legalName: string;
  tinType?: "SSN" | "EIN";
  tinDigits?: string;
  w9FileUrl?: string;
  address?: W9MailingAddress;
  now: Date;
}): Promise<{ supplierId: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "W9Request" WHERE "id" = ${args.requestId} FOR UPDATE`;
    const request = await tx.w9Request.findUnique({ where: { id: args.requestId } });
    if (!request || request.usedAt) throw new Error("This W-9 link has already been used.");
    if (request.expiresAt.getTime() <= args.now.getTime()) throw new Error("This W-9 link has expired. Ask us for a new one.");
    await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "id" = ${request.supplierId} FOR UPDATE`;
    const legalName = args.legalName.trim();
    if (!legalName) throw new Error("The legal name from the W-9 is required.");
    const data: Record<string, unknown> = {
      legalName,
      w9ReceivedOn: args.now,
      taxIdOnFile: true,
    };
    if (args.tinDigits && args.tinType) {
      if (!hasFieldCryptoKey()) {
        throw new Error("Ask your developer to set the encryption key before a tax ID can be saved.");
      }
      data.tinEncrypted = encryptField(args.tinDigits);
      data.tinLast4 = args.tinDigits.slice(-4);
      data.tinType = args.tinType;
    }
    if (args.w9FileUrl) data.w9FileUrl = args.w9FileUrl;
    if (args.address) {
      data.mailingAddress = args.address.street.trim();
      data.mailingCity = args.address.city.trim();
      data.mailingState = args.address.state.trim().toUpperCase();
      data.mailingZip = args.address.zip.trim();
    }
    await tx.supplier.update({ where: { id: request.supplierId }, data });
    await tx.w9Request.update({ where: { id: request.id }, data: { usedAt: args.now } });
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "supplier.w9_received",
        entityType: "Supplier",
        entityId: request.supplierId,
        newValue: { changedFields: ["w9ReceivedOn", ...(args.tinDigits ? ["tin"] : []), ...(args.w9FileUrl ? ["w9FileUrl"] : []), ...(args.address ? ["mailingAddress"] : [])] },
      },
    });
    return { supplierId: request.supplierId };
  });
}

/** The typed path from the public page: the answers themselves are the W-9 record. */
export async function submitTypedW9(
  token: string,
  input: { legalName: string; tinType: "SSN" | "EIN"; tin: string; w9FileUrl?: string; address: W9MailingAddress },
  now: Date = new Date(),
): Promise<{ supplierId: string }> {
  const state = await w9LinkState(token, now);
  if (!state.ok) throw new Error("This W-9 link is no longer active. Ask us for a new one.");
  const digits = assertValidTin(input.tin);
  if (!input.address.street.trim() || !input.address.city.trim() || !input.address.state.trim() || !input.address.zip.trim()) {
    throw new Error("The mailing address from the W-9 is required — your 1099 copy is mailed there.");
  }
  return completeW9({
    requestId: state.requestId,
    legalName: input.legalName,
    tinType: input.tinType,
    tinDigits: digits,
    w9FileUrl: input.w9FileUrl,
    address: input.address,
    now,
  });
}

/** Content check for an uploaded W-9: a real PDF, at most 4 MB (the decisions-attachment rule). */
export function checkW9Pdf(bytes: Uint8Array): void {
  if (bytes.length === 0) throw new Error("That file is empty.");
  if (bytes.length > MAX_W9_FILE_BYTES) throw new Error("Choose a file of 4 MB or less.");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("That file is not a PDF. Upload the signed W-9 as a PDF, or use the typed form instead.");
  }
}

/** Store an uploaded W-9 PDF in the private store under compliance/w9/ and return its path. */
export async function storeW9Pdf(supplierId: string, bytes: Uint8Array): Promise<string> {
  checkW9Pdf(bytes);
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Private file storage is not set up yet. Use the typed form instead.");
  const pathname = `compliance/w9/${supplierId}-${randomUUID()}.pdf`;
  const stored = await put(pathname, Buffer.from(bytes), {
    token: store.token,
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: false,
    abortSignal: AbortSignal.timeout(15_000),
  });
  return stored.url;
}

/** The upload path from the public page: the signed PDF is the W-9 record. */
export async function submitUploadedW9(
  token: string,
  input: { legalName: string; fileUrl: string },
  now: Date = new Date(),
): Promise<{ supplierId: string }> {
  const state = await w9LinkState(token, now);
  if (!state.ok) throw new Error("This W-9 link is no longer active. Ask us for a new one.");
  let pathname = "";
  try {
    pathname = new URL(input.fileUrl).pathname;
  } catch {
    pathname = "";
  }
  if (!pathname.includes("/compliance/w9/")) throw new Error("That upload did not finish. Try again.");
  return completeW9({
    requestId: state.requestId,
    legalName: input.legalName,
    w9FileUrl: input.fileUrl,
    now,
  });
}

/** OWNER: type a paper W-9's details in on the supplier record (same write, no link involved). */
export async function recordSupplierTin(
  actorId: string,
  supplierId: string,
  input: { legalName: string; tinType: "SSN" | "EIN"; tin: string; backupWithholding?: boolean; address?: W9MailingAddress },
): Promise<void> {
  const digits = assertValidTin(input.tin);
  if (!hasFieldCryptoKey()) {
    throw new Error("Ask your developer to set the encryption key before a tax ID can be saved.");
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "id" = ${supplierId} FOR UPDATE`;
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new Error("That supplier no longer exists.");
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        legalName: input.legalName.trim(),
        tinType: input.tinType,
        tinEncrypted: encryptField(digits),
        tinLast4: digits.slice(-4),
        taxIdOnFile: true,
        w9ReceivedOn: new Date(),
        ...(input.address
          ? {
              mailingAddress: input.address.street.trim(),
              mailingCity: input.address.city.trim(),
              mailingState: input.address.state.trim().toUpperCase(),
              mailingZip: input.address.zip.trim(),
            }
          : {}),
        ...(input.backupWithholding !== undefined ? { backupWithholding: input.backupWithholding } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "supplier.tin_recorded",
        entityType: "Supplier",
        entityId: supplierId,
        newValue: { changedFields: ["tin", "legalName", "w9ReceivedOn", ...(input.address ? ["mailingAddress"] : [])] },
      },
    });
  });
}

/** OWNER: turn backup withholding on or off for a supplier (24% of payments until a W-9 arrives). */
export async function setBackupWithholding(actorId: string, supplierId: string, on: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "id" = ${supplierId} FOR UPDATE`;
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new Error("That supplier no longer exists.");
    await tx.supplier.update({ where: { id: supplierId }, data: { backupWithholding: on } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "supplier.backup_withholding",
        entityType: "Supplier",
        entityId: supplierId,
        newValue: { backupWithholding: on },
      },
    });
  });
}
