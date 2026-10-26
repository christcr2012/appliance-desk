import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getRuleTimingSettings } from "@/domains/rules/reads";
import { whenToAct } from "@/domains/rules/timing";
import { businessDateKey } from "@/lib/business-date";
import { OBLIGATIONS, type ComplianceContext } from "./registry";
import { getComplianceProfile, profileContext } from "./profile";
import type { ComplianceFiling, Prisma } from "@prisma/client";

/**
 * CMP-1: compliance filings — one row per obligation period, moved through
 * prepare → approve → submit under the row lock. The approval binds the
 * prepared numbers by hash: if the numbers change after preparation, the
 * approval is refused and the owner reviews again. Approving and submitting
 * can each happen once only, and a filing's submission key (its id + the
 * prepared hash) makes a retry or double tap return the same filing instead
 * of filing twice. Prepared data never holds a full tax id (guarded below).
 */

export const FILING_STATES = [
  "NOT_APPLICABLE",
  "UPCOMING",
  "READY_FOR_REVIEW",
  "APPROVED",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "DONE_ELSEWHERE",
] as const;
export type FilingState = (typeof FILING_STATES)[number];

/** Canonical JSON (sorted keys) so the same numbers always hash the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function hashPreparedData(data: unknown): string {
  return createHash("sha256").update(canonical(data)).digest("hex");
}

/** The key a submission carries, so a retry can ask about the same filing. */
export function submissionKeyFor(filing: { id: string; preparedHash: string | null }): string {
  return createHash("sha256").update(`${filing.id}:${filing.preparedHash ?? ""}`).digest("hex");
}

const FULL_TIN = /\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\b\d{9}\b/;

/** Prepared numbers are shown for review and may be exported — never a full tax id. */
export function assertNoFullTaxId(data: unknown): void {
  if (FULL_TIN.test(canonical(data))) {
    throw new Error(
      "Those prepared numbers include a full tax ID. Prepared numbers never hold one — use the last 4 digits instead.",
    );
  }
}

async function booksFactsForYear(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<{ hasDepreciableAssets: boolean; hasAssetSales: boolean }> {
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const [assets, sales] = await Promise.all([
    tx.bookAsset.count({ where: { placedInServiceOn: { lte: yearEnd } } }),
    tx.retiredSaleDisposition.count({ where: { saleDate: { gte: yearStart, lte: yearEnd } } }),
  ]);
  return { hasDepreciableAssets: assets > 0, hasAssetSales: sales > 0 };
}

/**
 * Creates and refreshes filing rows from the registry for last year, this
 * year and next year (Colorado years), so an obligation appears well before
 * its window. Idempotent; rows already in motion are never rewritten —
 * only a still-UPCOMING row gets a refreshed actOn when the facts or the
 * timing setting change.
 */
export async function syncComplianceFilings(now = new Date()): Promise<{ created: number; refreshed: number }> {
  const { percent, marginBusinessDays: margin } = await getRuleTimingSettings();
  const thisYear = Number(businessDateKey(now).slice(0, 4));
  let created = 0;
  let refreshed = 0;

  await prisma.$transaction(async (tx) => {
    const profile = await getComplianceProfile();
    for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
      const ctx: ComplianceContext = profileContext(profile, await booksFactsForYear(tx, year));
      for (const obligation of OBLIGATIONS) {
        if (!obligation.applies(ctx).applies) continue;
        for (const period of obligation.periods(year, ctx)) {
          const { actOn } = whenToAct({
            opens: period.opens,
            closes: period.dueOn,
            effect: period.effect,
            fixedOn: period.effect === "FIXED" ? period.dueOn : undefined,
            now,
            percent,
            marginBusinessDays: margin,
          });
          const existing = await tx.complianceFiling.findUnique({
            where: {
              obligationKey_periodKey: { obligationKey: obligation.key, periodKey: period.periodKey },
            },
          });
          if (!existing) {
            await tx.complianceFiling.create({
              data: {
                obligationKey: obligation.key,
                periodKey: period.periodKey,
                state: "UPCOMING",
                dueOn: period.dueOn,
                actOn,
              },
            });
            created++;
          } else if (
            existing.state === "UPCOMING" &&
            (existing.actOn.getTime() !== actOn.getTime() || existing.dueOn.getTime() !== period.dueOn.getTime())
          ) {
            await tx.complianceFiling.update({
              where: { id: existing.id },
              data: { actOn, dueOn: period.dueOn },
            });
            refreshed++;
          }
        }
      }
    }
  });
  return { created, refreshed };
}

async function lockFilingInTx(
  tx: Prisma.TransactionClient,
  filingId: string,
): Promise<ComplianceFiling> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ComplianceFiling" WHERE "id" = ${filingId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("That filing no longer exists.");
  return tx.complianceFiling.findUniqueOrThrow({ where: { id: filingId } });
}

/** Records the prepared numbers for a filing and marks it ready for the owner's review. */
export async function prepareFiling(
  actorId: string,
  filingId: string,
  preparedData: Record<string, unknown>,
): Promise<void> {
  assertNoFullTaxId(preparedData);
  const preparedHash = hashPreparedData(preparedData);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const filing = await lockFilingInTx(tx, filingId);
    if (!["UPCOMING", "READY_FOR_REVIEW", "REJECTED"].includes(filing.state)) {
      throw new Error("This filing can't be prepared again in its current state.");
    }
    await tx.complianceFiling.update({
      where: { id: filingId },
      data: {
        preparedData: preparedData as Prisma.InputJsonValue,
        preparedHash,
        state: "READY_FOR_REVIEW",
        approvedByUserId: null,
        approvedAt: null,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.prepare",
        entityType: "ComplianceFiling",
        entityId: filingId,
        newValue: { preparedHash },
      },
    });
  });
}

/**
 * The owner's approval, bound to the hash of the numbers they reviewed.
 * Passing a different hash than the stored one — or numbers changed since
 * preparation — refuses with "Numbers changed — review again".
 */
export async function approveFiling(
  actorId: string,
  filingId: string,
  expectedHash: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const filing = await lockFilingInTx(tx, filingId);
    if (filing.state !== "READY_FOR_REVIEW") {
      throw new Error("Only a filing waiting for review can be approved.");
    }
    const currentHash = filing.preparedData ? hashPreparedData(filing.preparedData) : null;
    if (!filing.preparedHash || filing.preparedHash !== expectedHash || currentHash !== filing.preparedHash) {
      throw new Error("Numbers changed — review again before approving.");
    }
    await tx.complianceFiling.update({
      where: { id: filingId },
      data: { state: "APPROVED", approvedByUserId: actorId, approvedAt: new Date(), version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.approve",
        entityType: "ComplianceFiling",
        entityId: filingId,
        newValue: { preparedHash: filing.preparedHash },
      },
    });
  });
}

/**
 * APPROVED → SUBMITTED, once only. Calling it again on an already-submitted
 * filing returns without changing anything (a double tap or a retry can
 * never file twice).
 */
export async function submitFiling(
  actorId: string,
  filingId: string,
  confirmation?: string,
): Promise<{ alreadySubmitted: boolean }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const filing = await lockFilingInTx(tx, filingId);
    if (filing.state === "SUBMITTED" || filing.state === "ACCEPTED") {
      return { alreadySubmitted: true };
    }
    if (filing.state !== "APPROVED") {
      throw new Error("Approve this filing before submitting it.");
    }
    await tx.complianceFiling.update({
      where: { id: filingId },
      data: {
        state: "SUBMITTED",
        submittedAt: new Date(),
        confirmation: confirmation?.slice(0, 200) || filing.confirmation,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.submit",
        entityType: "ComplianceFiling",
        entityId: filingId,
        newValue: { submissionKey: submissionKeyFor(filing) },
      },
    });
    return { alreadySubmitted: false };
  });
}

/** Records the agency's answer for a submitted filing. */
export async function resolveFiling(
  actorId: string,
  filingId: string,
  outcome: "ACCEPTED" | "REJECTED",
  note?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const filing = await lockFilingInTx(tx, filingId);
    if (filing.state !== "SUBMITTED") {
      throw new Error("Only a submitted filing can be marked accepted or rejected.");
    }
    await tx.complianceFiling.update({
      where: { id: filingId },
      data: { state: outcome, note: note?.slice(0, 1000) || filing.note, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: outcome === "ACCEPTED" ? "compliance.accepted" : "compliance.rejected",
        entityType: "ComplianceFiling",
        entityId: filingId,
      },
    });
  });
}

/** The owner handled this one outside the app (or the CPA filed it). */
export async function markFilingDoneElsewhere(
  actorId: string,
  filingId: string,
  note?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const filing = await lockFilingInTx(tx, filingId);
    if (!["UPCOMING", "READY_FOR_REVIEW", "APPROVED"].includes(filing.state)) {
      throw new Error("This filing is already finished.");
    }
    await tx.complianceFiling.update({
      where: { id: filingId },
      data: { state: "DONE_ELSEWHERE", note: note?.slice(0, 1000) || filing.note, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.done_elsewhere",
        entityType: "ComplianceFiling",
        entityId: filingId,
      },
    });
  });
}

/** A preparer determined this period does not apply after all (e.g. under a threshold). */
export async function markFilingNotApplicable(
  actorId: string,
  filingId: string,
  note: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const filing = await lockFilingInTx(tx, filingId);
    if (!["UPCOMING", "READY_FOR_REVIEW"].includes(filing.state)) {
      throw new Error("This filing has moved past the point where it can be marked not needed.");
    }
    await tx.complianceFiling.update({
      where: { id: filingId },
      data: { state: "NOT_APPLICABLE", note: note.slice(0, 1000), version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.not_applicable",
        entityType: "ComplianceFiling",
        entityId: filingId,
        newValue: { note: note.slice(0, 200) },
      },
    });
  });
}

export async function listComplianceFilings(): Promise<ComplianceFiling[]> {
  return prisma.complianceFiling.findMany({ orderBy: [{ actOn: "asc" }, { id: "asc" }] });
}

/** The registry context for a year, from the stored facts and the books. */
export async function complianceContextForYear(year: number): Promise<ComplianceContext> {
  const profile = await getComplianceProfile();
  return prisma.$transaction(async (tx) =>
    profileContext(profile, await booksFactsForYear(tx, year)),
  );
}

export async function getComplianceFiling(id: string): Promise<ComplianceFiling | null> {
  return prisma.complianceFiling.findUnique({ where: { id } });
}
