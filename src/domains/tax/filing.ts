import { Prisma } from "@prisma/client";
import { head } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import { loadFilingPacketInTx, type FilingPacket } from "./filing-packet";
import { sendOwnerAlert } from "@/domains/messaging/owner-alerts";
import { reserveRdfCreditsInTx } from "./rdf-filing";

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
  photoUrl?: string | null,
): Promise<string | null> {
  if (photoId && photoUrl) throw new Error("Choose one confirmation photo source.");
  if (photoUrl) {
    const store = getPrivatePhotoStore();
    const path = store ? privatePhotoPathFromUrl(photoUrl, store.storeId) : null;
    if (!path?.startsWith(`tax-filings/${periodId}/`)) {
      throw new Error("Choose a private confirmation upload belonging to this exact return.");
    }
    const evidence = await tx.photo.create({
      data: { url: photoUrl, altText: "Private tax filing confirmation" },
      select: { id: true },
    });
    return evidence.id;
  }
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

/** Verify actual private object existence BEFORE opening the database lock/transaction.
 * The transaction still verifies the exact trusted store and period prefix. */
async function verifyUploadedFilingPhoto(periodId: string, url: string | null | undefined): Promise<void> {
  if (!url) return;
  const store = getPrivatePhotoStore();
  const path = store ? privatePhotoPathFromUrl(url, store.storeId) : null;
  if (!path?.startsWith(`tax-filings/${periodId}/`)) {
    throw new Error("Choose a private confirmation upload for this return.");
  }
  try {
    const blob = await head(url, { token: store!.token });
    if (!blob || blob.url !== url || blob.pathname !== path || blob.size <= 0) {
      throw new Error("Confirmation upload was not found.");
    }
  } catch {
    throw new Error("The private confirmation upload could not be verified. Upload it again before filing.");
  }
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
    confirmationPhotoUrl?: string | null;
  },
): Promise<void> {
  const data = normalizeEvidence(input);
  await verifyUploadedFilingPhoto(input.periodId, input.confirmationPhotoUrl);
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
    const photo = await assertFilingPhoto(tx, input.periodId, input.confirmationPhotoId, input.confirmationPhotoUrl);
    if (packet.rdf) {
      await reserveRdfCreditsInTx(tx, input.periodId, packet.rdf.creditRecordIds);
      for (const recordId of packet.rdf.sourceRecordIds) {
        const count = await tx.retailDeliveryFeeRecord.updateMany({
          where: {
            id: recordId,
            status: "READY",
            OR: [{ filingPeriodId: null }, { filingPeriodId: input.periodId }],
          },
          data: { filingPeriodId: input.periodId },
        });
        if (count.count !== 1) throw new Error("Retail delivery fee source changed during filing.");
      }
    }
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
    // A filed return is not itself proof of tax payment. Only a fully
    // remitted return can settle its mapped appliance acquisition liability.
    if (data.amountPaidCents === expected) {
      const filedAssets = await tx.purchaseUseTax.findMany({
        where: { filingPeriodId: input.periodId, sourceType: "APPLIANCE", status: "FILED" },
        select: { sourceId: true },
      });
      for (const assetId of new Set(filedAssets.map(row => row.sourceId))) {
        const allRows = await tx.purchaseUseTax.findMany({
          where: { sourceType: "APPLIANCE", sourceId: assetId },
          select: { status: true, useTaxDueCents: true, filingPeriodId: true },
        });
        if (allRows.length && allRows.every(row => row.status === "NOT_DUE" ||
              (row.status === "FILED" && row.filingPeriodId === input.periodId)) &&
            allRows.some(row => row.useTaxDueCents > 0)) {
          await tx.appliance.updateMany({
            where: { id: assetId, acquisitionTaxStatus: "USE_TAX_DUE" },
            data: { acquisitionTaxStatus: "USE_TAX_PAID" },
          });
        }
      }
    }
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

export type FilingDifference = {
  key: string;
  previouslyReportedCents: number;
  correctedCents: number;
  differenceCents: number;
};
export type FilingAmendmentPacket = {
  previouslyReported: FilingPacket;
  corrected: FilingPacket;
  differences: FilingDifference[];
  additionalTaxCents: number;
};

/** Tax changes, not viewing date/wording or configurable SUTS instructions,
 * determine whether a filed return actually needs a correction. */
function amountsByKey(packet: FilingPacket): Map<string, number> {
  const values = new Map<string, number>();
  function add(key: string, cents: number) {
    values.set(key, (values.get(key) ?? 0) + cents);
  }
  // A corrected RDF return can create a positive amendment. A removal is
  // handled through a credit on a subsequent open RDF return instead.
  if (packet.rdf) for (const id of packet.rdf.sourceRecordIds) {
    add("RDF:SALE:" + id, packet.rdf.sourceAmountCents[id] ?? 0);
  }
  for (const row of packet.rows) {
    const key = "SALES:" + row.jurisdictionId + ":" + row.rateMilliPercent;
    add(key + ":GROSS", row.grossSalesCents);
    add(key + ":TAXABLE", row.netTaxableCents);
    add(key + ":TAX", row.taxCents);
    for (const deduction of row.deductions) {
      add(key + ":DEDUCTION:" + deduction.key, deduction.cents);
    }
  }
  for (const row of packet.useTax) {
    add("USE:" + row.jurisdictionId + ":PURCHASE", row.purchaseCents);
    add("USE:" + row.jurisdictionId + ":TAX", row.useTaxCents);
  }
  return values;
}
export function buildFilingAmendmentPacket(previous: FilingPacket, corrected: FilingPacket): FilingAmendmentPacket {
  const before = amountsByKey(previous);
  const after = amountsByKey(corrected);
  const differences = [...new Set([...before.keys(), ...after.keys()])].sort()
    .flatMap(key => {
      const previouslyReportedCents = before.get(key) ?? 0;
      const correctedCents = after.get(key) ?? 0;
      return correctedCents === previouslyReportedCents ? [] : [{
        key, previouslyReportedCents, correctedCents,
        differenceCents: correctedCents - previouslyReportedCents,
      }];
    });
  return {
    previouslyReported: previous,
    corrected,
    differences,
    // RDF amendments add ONLY previously unreported sales; previously
    // over-reported fees are credited separately on a later open return.
    additionalTaxCents: previous.rdf
      ? (corrected.rdf?.sourceRecordIds ?? [])
          .filter(id => !previous.rdf!.sourceRecordIds.includes(id))
          .reduce((total, id) => total + (corrected.rdf!.sourceAmountCents[id] ?? 0), 0)
      : corrected.totals.taxCents - previous.totals.taxCents,
  };
}
function parseStoredPacket(value: Prisma.JsonValue): FilingPacket {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const packet = row && "corrected" in row ? row.corrected : row;
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new Error("The original filing packet is missing; correct the record manually before amending.");
  }
  const obj = packet as Record<string, unknown>;
  const totals = obj.totals as Record<string, unknown> | undefined;
  if (!Array.isArray(obj.rows) || !Array.isArray(obj.useTax) ||
      !totals || !Number.isSafeInteger(totals.taxCents)) {
    throw new Error("The stored filing packet cannot be verified; it must not be replaced.");
  }
  return packet as unknown as FilingPacket;
}
function parseAmendment(value: Prisma.JsonValue): FilingAmendmentPacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved amendment is invalid.");
  }
  const row = value as Record<string, unknown>;
  if (!row.corrected || !row.previouslyReported || !Array.isArray(row.differences) ||
      !Number.isSafeInteger(row.additionalTaxCents)) {
    throw new Error("The amendment has incomplete evidence.");
  }
  return row as FilingAmendmentPacket;
}

async function lockAmendment(tx: Prisma.TransactionClient, id: string) {
  // Lock the parent first, just as the scanner does, to avoid deadlocks.
  const lookup = await tx.taxFilingAmendment.findUnique({ where: { id }, select: { periodId: true } });
  if (!lookup) throw new Error("Tax filing amendment not found.");
  await lockPeriod(tx, lookup.periodId);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "TaxFilingAmendment" WHERE "id" = ${id} FOR UPDATE
  `;
  if (locked.length !== 1) throw new Error("Tax filing amendment not found.");
  return tx.taxFilingAmendment.findUniqueOrThrow({ where: { id } });
}

/**
 * Rebuild filed returns from fresh ledger evidence. Period row locks serialize
 * competing cron runs; a single OPEN amendment is refreshed in place.
 * The originally filed worksheet is never edited.
 */
const AMENDMENT_SCAN_BLOCKED = "tax.amendment_scan_blocked";
const AMENDMENT_SCAN_RECOVERED = "tax.amendment_scan_recovered";

/** Audit events are the durable per-period signal for a failed comparison.
 * An unchanged blocked state is not written again on every daily scan. */
async function recordAmendmentScanState(periodId: string, blocked: boolean): Promise<void> {
  const latest = await prisma.auditLog.findFirst({
    where: {
      entityType: "TaxFilingPeriod", entityId: periodId,
      action: { in: [AMENDMENT_SCAN_BLOCKED, AMENDMENT_SCAN_RECOVERED] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const action = blocked ? AMENDMENT_SCAN_BLOCKED : AMENDMENT_SCAN_RECOVERED;
  if ((latest?.action ?? null) === action) return;
  if (!blocked && !latest) return;
  await prisma.auditLog.create({
    data: {
      action, entityType: "TaxFilingPeriod", entityId: periodId,
      newValue: { state: blocked ? "BLOCKED" : "RECOVERED" },
    },
  });
}

export async function detectTaxFilingAmendments(now = new Date()): Promise<number> {
  const periods = await prisma.taxFilingPeriod.findMany({
    where: { status: "FILED", worksheet: { not: Prisma.DbNull } },
    select: { id: true },
    orderBy: [{ filedOn: "asc" }, { id: "asc" }],
  });
  let changed = 0;
  let blockedCount = 0;
  for (const period of periods) {
    let result: { id: string; first: boolean; detectedAt: Date } | null;
    try {
      result = await prisma.$transaction(async tx => {
      const locked = await lockPeriod(tx, period.id);
      if (locked.status !== "FILED" || !locked.worksheet) return null;
      const latestFiled = await tx.taxFilingAmendment.findFirst({
        where: { periodId: period.id, status: "FILED" },
        orderBy: [{ sequence: "desc" }, { id: "desc" }],
      });
      const previous = parseStoredPacket(latestFiled?.packet ?? locked.worksheet);
      const refreshed = await loadFilingPacketInTx(tx, period.id, now, { allowFiled: true });
      if (refreshed.status !== "READY") {
        throw new Error("Amendment review blocked for period " + period.id + ": " + refreshed.problems.join(" "));
      }
      const amendment = buildFilingAmendmentPacket(previous, refreshed.packet);
      const open = await tx.taxFilingAmendment.findFirst({
        where: { periodId: period.id, status: "OPEN" },
        orderBy: [{ sequence: "desc" }, { id: "desc" }],
      });
      // HANDLED_OUTSIDE is an explicit Owner decision, not a filed tax
      // amendment. Do not generate the identical alert again every day; if
      // recorded evidence changes, compare against the latest filed packet.
      if (!open) {
        const handled = await tx.taxFilingAmendment.findFirst({
          where: { periodId: period.id, status: "HANDLED_OUTSIDE" },
          orderBy: [{ sequence: "desc" }, { id: "desc" }],
        });
        if (handled) {
          const handledPacket = parseAmendment(handled.packet).corrected;
          if (buildFilingAmendmentPacket(handledPacket, refreshed.packet).differences.length === 0) {
            return null;
          }
        }
      }
      // Correcting an over-reported RDF fee is a credit on a subsequent
      // return, not an amendment to the original filed period.
      if (!amendment.differences.length ||
          (previous.rdf && amendment.additionalTaxCents <= 0)) {
        if (open) {
          await tx.taxFilingAmendment.delete({ where: { id: open.id } });
          await tx.auditLog.create({
            data: {
              action: "tax.amendment_cleared_no_difference",
              entityType: "TaxFilingPeriod", entityId: period.id,
              newValue: { amendmentId: open.id },
            },
          });
        }
        return null;
      }
      const packet = JSON.parse(JSON.stringify(amendment)) as Prisma.InputJsonValue;
      if (open) {
        await tx.taxFilingAmendment.update({
          where: { id: open.id },
          data: { packet, additionalTaxCents: amendment.additionalTaxCents },
        });
        return { id: open.id, first: false, detectedAt: open.detectedAt };
      }
      const last = await tx.taxFilingAmendment.findFirst({
        where: { periodId: period.id }, orderBy: { sequence: "desc" }, select: { sequence: true },
      });
      const created = await tx.taxFilingAmendment.create({
        data: {
          periodId: period.id, sequence: (last?.sequence ?? 0) + 1,
          packet, additionalTaxCents: amendment.additionalTaxCents,
          detectedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "tax.amendment_detected",
          entityType: "TaxFilingAmendment", entityId: created.id,
          newValue: { periodId: period.id, additionalTaxCents: amendment.additionalTaxCents,
            differences: amendment.differences.length },
        },
      });
      return { id: created.id, first: true, detectedAt: now };
      }, { timeout: 20000 });
      await recordAmendmentScanState(period.id, false);
    } catch (error) {
      // A single historical/undecided return cannot suppress newer
      // corrections. Record a durable, finance-only Today exception.
      console.error("[tax] Amendment scan failed for period " + period.id, error);
      await recordAmendmentScanState(period.id, true);
      blockedCount += 1;
      continue;
    }
    if (!result) continue;
    changed += 1;
    // First detection; weekly follow-up after that while OPEN. Per-owner
    // MessageDelivery keys make retries harmless after a provider failure.
    const weeks = Math.floor((now.getTime() - result.detectedAt.getTime()) / (7 * 86400000));
    if (result.first || (weeks >= 1 &&
        businessDateKey(now) !== businessDateKey(result.detectedAt) &&
        (now.getTime() - result.detectedAt.getTime()) % (7 * 86400000) < 86400000)) {
      await sendOwnerAlert({
        key: "tax-amendment:" + result.id + (result.first ? "" : ":week:" + weeks),
        subject: "A filed tax return needs amendment review",
        text: "New filing evidence differs from the recorded return. Review the correction before reporting it.",
        href: "/desk/today",
      });
    }
  }
  if (blockedCount) {
    throw new Error("Amendment scan could not verify " + blockedCount +
      " filed return(s); remaining periods were scanned. Check Today.");
  }
  return changed;
}
export async function markAmendmentFiled(
  actorUserId: string,
  input: {
    amendmentId: string;
    filedOn: Date;
    paidOn: Date;
    confirmationNumber: string;
    amountPaidCents: number;
    amountDifferentReason?: string;
  },
): Promise<void> {
  const data = normalizeEvidence(input);
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const amendment = await lockAmendment(tx, input.amendmentId);
    if (amendment.status !== "OPEN") throw new Error("This amendment has already been decided.");
    if (amendment.additionalTaxCents <= 0) {
      throw new Error("Credit or zero-tax corrections must use the handled-outside/CPA resolution workflow.");
    }

    const previous = parseAmendment(amendment.packet);
    const current = await loadFilingPacketInTx(tx, amendment.periodId,
      latest(data.filedOn, data.paidOn), { allowFiled: true });
    if (current.status !== "READY") throw new Error("The corrected filing packet is blocked.");
    const currentDifference = buildFilingAmendmentPacket(previous.previouslyReported, current.packet);
    const sameDifferences = currentDifference.differences.length === previous.differences.length &&
      currentDifference.differences.every((diff, index) => {
        const saved = previous.differences[index];
        return saved?.key === diff.key &&
          saved.previouslyReportedCents === diff.previouslyReportedCents &&
          saved.correctedCents === diff.correctedCents &&
          saved.differenceCents === diff.differenceCents;
      });
    // PostgreSQL JSONB is free to reorder object keys; compare actual
    // amounts instead of stringifying object property order.
    if (!sameDifferences) {
      throw new Error("Filing evidence changed since this amendment was prepared. Re-run amendment review.");
    }
    // Amount-only comparisons are insufficient for RDF: a different sale
    // with the same 31-cent amount must never replace the reviewed source.
    if (current.packet.rdf) {
      const reviewed = previous.corrected.rdf;
      const actual = current.packet.rdf;
      if (!reviewed ||
          JSON.stringify([...reviewed.sourceRecordIds].sort()) !==
            JSON.stringify([...actual.sourceRecordIds].sort()) ||
          JSON.stringify(reviewed.sourceAmountCents) !== JSON.stringify(actual.sourceAmountCents)) {
        throw new Error("Retail delivery fee source sales changed; re-review the amendment.");
      }
    }
    const expected = Math.max(0, amendment.additionalTaxCents);
    if (expected !== data.amountPaidCents && !data.reason) {
      throw new Error("Explain any difference between the additional tax and the amount paid.");
    }
    if (current.packet.rdf) {
      const original = new Set(previous.previouslyReported.rdf?.sourceRecordIds ?? []);
      for (const recordId of current.packet.rdf.sourceRecordIds.filter(id => !original.has(id))) {
        const assigned = await tx.retailDeliveryFeeRecord.updateMany({
          where: {
            id: recordId, status: "READY",
            OR: [{ filingPeriodId: null }, { filingPeriodId: amendment.periodId }],
          },
          data: { filingPeriodId: amendment.periodId },
        });
        if (assigned.count !== 1) throw new Error("RDF amendment source changed while filing.");
      }
    }
    await tx.taxFilingAmendment.update({
      where: { id: amendment.id },
      data: {
        status: "FILED", filedOn: data.filedOn, paidOn: data.paidOn,
        confirmationNumber: data.confirmationNumber, amountPaidCents: data.amountPaidCents,
        filedByUserId: actorUserId, notes: data.reason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "tax.amendment_filed",
        entityType: "TaxFilingAmendment", entityId: amendment.id,
        oldValue: { status: amendment.status },
        newValue: {
          status: "FILED", filedOn: data.filedOn.toISOString(),
          paidOn: data.paidOn.toISOString(), confirmationNumber: data.confirmationNumber,
          additionalTaxCents: amendment.additionalTaxCents,
          amountPaidCents: data.amountPaidCents, reason: data.reason,
        },
      },
    });
  }, { timeout: 20000 });
}
export async function markAmendmentHandledOutside(
  actorUserId: string,
  input: { amendmentId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new Error("Explain how this credit or zero-tax correction was handled.");
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const amendment = await lockAmendment(tx, input.amendmentId);
    if (amendment.status !== "OPEN") throw new Error("This amendment has already been decided.");
    if (amendment.additionalTaxCents > 0) {
      throw new Error("Additional tax owed cannot be marked handled outside filing.");
    }
    await tx.taxFilingAmendment.update({
      where: { id: amendment.id },
      data: { status: "HANDLED_OUTSIDE", notes: reason, filedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "tax.amendment_handled_outside",
        entityType: "TaxFilingAmendment", entityId: amendment.id,
        oldValue: { status: amendment.status },
        newValue: { status: "HANDLED_OUTSIDE",
          additionalTaxCents: amendment.additionalTaxCents, reason },
      },
    });
  });
}
