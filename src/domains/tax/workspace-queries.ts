import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

type PageInput = { cursor?: string; limit: number };
function pageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Page size must be between 1 and 100.");
  return limit;
}
type Key = { createdAt: string; id: string };
function fromCursor(cursor: string | undefined): Key | null {
  if (!cursor) return null;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new Error("Invalid tax workspace cursor.");
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Key;
    if (!value || typeof value.id !== "string" || !value.id || value.id.length > 128 ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Bad cursor");
    return value;
  } catch { throw new Error("Invalid tax workspace cursor."); }
}
function cursorWhere(cursor: Key | null) {
  if (!cursor) return {};
  const at = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { gt: at } },
      { createdAt: at, id: { gt: cursor.id } },
    ],
  };
}
function nextCursor(rows: Array<{ id: string; createdAt: Date }>, limit: number): string | null {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1]!;
  return Buffer.from(JSON.stringify({
    createdAt: last.createdAt.toISOString(), id: last.id,
  })).toString("base64url");
}

export type TaxAreaDTO = {
  id: string; serviceAddressId: string; customerId: string;
  line1: string; city: string; state: string; zip: string;
  status: "NEEDS_REVIEW" | "VERIFIED" | "FAILED";
  source: string; lookedUpAt: Date;
  reviewNote: string | null; jurisdictions: string[];
};
export async function getTaxAreasPage(
  actorId: string, input: PageInput & { status?: "REVIEW" | "VERIFIED" },
): Promise<{ rows: TaxAreaDTO[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit), cursor = fromCursor(input.cursor);
  if (input.status && !["REVIEW", "VERIFIED"].includes(input.status))
    throw new Error("Invalid area filter.");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const where: Prisma.AddressTaxLocationWhereInput = {
      isCurrent: true,
      serviceAddressId: { not: null },
      status: input.status === "REVIEW" ? { in: ["NEEDS_REVIEW", "FAILED"] } :
        input.status === "VERIFIED" ? "VERIFIED" : { in: ["NEEDS_REVIEW", "FAILED", "VERIFIED"] },
      ...cursorWhere(cursor),
    };
    const rows = await tx.addressTaxLocation.findMany({
      where, select: {
        id: true, createdAt: true, serviceAddressId: true, status: true,
        source: true, lookedUpAt: true, reviewNote: true,
        serviceAddress: { select: {
          customerId: true, line1: true, city: true, state: true, zip: true,
        } },
        jurisdictions: { select: { jurisdiction: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return {
      rows: rows.slice(0, limit).flatMap(row =>
        row.serviceAddress && row.serviceAddressId && ["NEEDS_REVIEW", "FAILED", "VERIFIED"].includes(row.status)
        ? [{
          id: row.id, serviceAddressId: row.serviceAddressId,
          customerId: row.serviceAddress.customerId,
          line1: row.serviceAddress.line1, city: row.serviceAddress.city,
          state: row.serviceAddress.state, zip: row.serviceAddress.zip,
          status: row.status as TaxAreaDTO["status"],
          source: row.source, lookedUpAt: row.lookedUpAt, reviewNote: row.reviewNote,
          jurisdictions: row.jurisdictions.map(j => j.jurisdiction.name),
        }] : []),
      nextCursor: nextCursor(rows, limit),
    };
  });
}

export type TaxExemptionDTO = {
  id: string; customerId: string; customerName: string; reason: string;
  validFrom: Date; expiresOn: Date | null; revokedAt: Date | null;
  hasPrivateCertificate: boolean;
};
export async function getTaxExemptionsPage(
  actorId: string, input: PageInput,
): Promise<{ rows: TaxExemptionDTO[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit), cursor = fromCursor(input.cursor);
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const rows = await tx.customerTaxExemption.findMany({
      where: { ...cursorWhere(cursor) },
      select: {
        id: true, createdAt: true, customerId: true,
        reason: true, validFrom: true, expiresOn: true, revokedAt: true,
        certificatePhotoId: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return {
      rows: rows.slice(0, limit).map(row => ({
        id: row.id, customerId: row.customerId,
        customerName: row.customer.user.name ?? row.customer.user.email,
        reason: row.reason, validFrom: row.validFrom, expiresOn: row.expiresOn,
        revokedAt: row.revokedAt,
        hasPrivateCertificate: Boolean(row.certificatePhotoId),
      })),
      nextCursor: nextCursor(rows, limit),
    };
  });
}

