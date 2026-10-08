import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import { loadFilingPacketInTx, type FilingPacket } from "./filing-packet";

function validDate(date: Date, label: string): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Enter a valid " + label + ".");
  }
}
function normalizeEvidence(input: {
  filedOn: Date;
  paidOn: Date;
  confirmationNumber: string;
  amountPaidCents: number;
  amountDifferentReason?: string;
}): { filedOn: Date; paidOn: Date; confirmationNumber: string; amountPaidCents: number; reason: string | null } {
  validDate(input.filedOn, "filing date");
  validDate(input.paidOn, "payment date");
  const confirmationNumber = input.confirmationNumber.trim();
  if (!confirmationNumber || confirmationNumber.length > 300) {
    throw new Error("Enter the official filing confirmation number.");
  }
  if (!Number.isSafeInteger(input.amountPaidCents) || input.amountPaidCents < 0) {
    throw new Error("Enter a nonnegative paid amount in whole cents.");
  }
  const reason = input.amountDifferentReason?.trim() || null;
  if (reason && (reason.length > 1000 || /[\r\n]/.test(reason))) {
    throw new Error("Describe the difference in one short line.");
  }
  return { filedOn: input.filedOn, paidOn: input.paidOn,
    confirmationNumber, amountPaidCents: input.amountPaidCents, reason };
}
function latest(first: Date, second: Date): Date {
  return first > second ? first : second;
}
function expectedRemittance(packet: FilingPacket, filedOn: Date, paidOn: Date): number {
  const onTime = businessDateKey(filedOn) <= packet.legalDueOn &&
    businessDateKey(paidOn) <= packet.legalDueOn;
  return onTime ? packet.totals.remitIfOnTimeCents : packet.totals.remitIfLateCents;
}
async function lockPeriod(tx: Prisma.TransactionClient, periodId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "TaxFilingPeriod" WHERE "id" = ${periodId} FOR UPDATE
  `;
  if (locked.length !== 1) throw new Error("Filing period not found.");
  return tx.taxFilingPeriod.findUniqueOrThrow({ where: { id: periodId } });
}
async function assertFilingPhoto(
  tx: Prisma.TransactionClient,
  periodId: string,
  photoId: string | null | undefined,
): Promise<string | null> {
  if (photoId === null || photoId === undefined || photoId === "") return null;
  const record = await tx.photo.findUnique({ where: { id: photoId }, select: { url: true } });
  const store = getPrivatePhotoStore();
  const path = record && store ? privatePhotoPathFromUrl(record.url, store.storeId) : null;
  if (!path?.startsWith(`tax-filings/${periodId}/`)) {
    throw new Error("Choose a confirmation image from this return's private filing uploads.");
  }
  return photoId;
}
export async function saveFilingEntryProgress(
  actorUserId: string,
  input: { periodId: string; entryProgress: Record<string, boolean> },
): Promise<void> {
  if (!input.entryProgress || Array.isArray(input.entryProgress) ||
      Object.keys(input.entryProgress).length > 200 ||
      Object.entries(input.entryProgress).some(([key, value]) =>
        key.length > 100 || !/^[A-Za-z0-9:_-]+$/.test(key) || typeof value !== "boolean")) {
    throw new Error("Invalid filing checklist.");
  }
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const existing = await lockPeriod(tx, input.periodId);
    if (existing.status !== "OPEN") throw new Error("This return is already filed and cannot be edited.");
    await tx.taxFilingPeriod.update({
      where: { id: input.periodId },
      data: { entryProgress: input.entryProgress },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "tax.filing_progress_saved",
        entityType: "TaxFilingPeriod", entityId: input.periodId,
        oldValue: { entryProgress: existing.entryProgress as Prisma.InputJsonValue },
        newValue: { entryProgress: input.entryProgress },
      },
    });
  });
}

/** Freeze exactly one audited return, atomically with its payment evidence. */
export async function markPeriodFiled(
  actorUserId: string,
  input: {
    periodId: string;
    filedOn: Date;
    paidOn: Date;
    confirmationNumber: string;
    amountPaidCents: number;
    amountDifferentReason?: string;
    confirmationPhotoId?: string | null;
  },
): Promise<void> {
  const data = normalizeEvidence(input);
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const existing = await lockPeriod(tx, input.periodId);
    if (existing.status !== "OPEN") throw new Error("This return was already filed.");
    if (businessDateKey(data.filedOn) <= businessDateKey(existing.periodEnd)) {
      throw new Error("Cannot file a return before its filing period has ended.");
    }
    const current = await loadFilingPacketInTx(tx, input.periodId, latest(data.filedOn, data.paidOn));
    if (current.status !== "READY") {
      throw new Error("This return is not ready: " + current.problems.join(" "));
    }
    const packet = current.packet;
    const expected = expectedRemittance(packet, data.filedOn, data.paidOn);
    if (data.amountPaidCents !== expected && !data.reason) {
      throw new Error("Explain why the amount paid differs from the calculated return.");
    }
    const photo = await assertFilingPhoto(tx, input.periodId, input.confirmationPhotoId);
    const serviceFeeRetainedCents = expected === packet.totals.remitIfOnTimeCents &&
      businessDateKey(data.filedOn) <= packet.legalDueOn &&
      businessDateKey(data.paidOn) <= packet.legalDueOn
        ? packet.totals.serviceFeeCents : 0;
    const frozen = JSON.parse(JSON.stringify(packet)) as Prisma.InputJsonValue;
    await tx.taxFilingPeriod.update({
      where: { id: input.periodId },
      data: {
        status: "FILED", worksheet: frozen,
        zeroReturn: packet.zeroReturn,
        filedOn: data.filedOn, paidOn: data.paidOn,
        confirmationNumber: data.confirmationNumber,
        confirmationPhotoId: photo,
        amountPaidCents: data.amountPaidCents,
        serviceFeeRetainedCents,
        filedByUserId: actorUserId,
        notes: data.reason,
      },
    });
    await tx.purchaseUseTax.updateMany({
      where: { filingPeriodId: input.periodId, status: "DUE" },
      data: { status: "FILED" },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "tax.return_filed",
        entityType: "TaxFilingPeriod", entityId: input.periodId,
        oldValue: { status: existing.status },
        newValue: {
          status: "FILED", filedOn: data.filedOn.toISOString(),
          paidOn: data.paidOn.toISOString(),
          confirmationNumber: data.confirmationNumber,
          amountPaidCents: data.amountPaidCents, expectedCents: expected,
          reason: data.reason, hasPrivatePhoto: !!photo,
          totalRecordedTaxCents: packet.totals.taxCents,
        },
      },
    });
  }, { timeout: 15000 });
}
