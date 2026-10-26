import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { rdfQualifiedEndsOn, retailDeliveryFeeStatus } from "./retail-delivery-fee";
import { recordedRetailSales } from "./rdf-sales-evidence";

type Tx = Prisma.TransactionClient;

const day = (key: string) => businessDateFromKey(key)!;

/** The switch governing a sale date: the latest one starting on or before it. */
export async function rdfSwitchForDate(tx: Tx, on: Date) {
  return tx.retailDeliveryFeeSwitch.findFirst({
    where: { startsOn: { lte: day(businessDateKey(on)) } },
    orderBy: [{ startsOn: "desc" }, { kind: "desc" }],
    select: { id: true, kind: true, startsOn: true, approvedAt: true },
  });
}

/**
 * True when a customer line for a sale on this date must wait: the governing
 * switch is a START the owner has not approved yet. The fee is still owed and
 * still reported; it is just not billed to a customer until approval.
 */
export async function rdfBillingHeldBySwitch(tx: Tx, on: Date): Promise<boolean> {
  const governing = await rdfSwitchForDate(tx, on);
  return !!governing && governing.kind === "START" && !governing.approvedAt;
}

async function prepareSwitch(
  tx: Tx, kind: "START" | "STOP", startsOn: Date, basisRetailCents: number | null,
): Promise<void> {
  await tx.retailDeliveryFeeSwitch.upsert({
    where: { kind_startsOn: { kind, startsOn } },
    create: { kind, startsOn, basisRetailCents },
    // An existing row (approved or not) is never rewritten by preparation.
    update: {},
  });
}

/**
 * Nightly (TFA-2 §6.3): prepare the delivery-fee switches the app can already
 * date. The new-business start comes from the recorded crossing; the January 1
 * switches come from the prior year's final total, prepared from December 1
 * (on the running total) and corrected in January if the final total points
 * the other way and the owner has not approved yet. Nothing here approves a
 * switch or changes a bill: approval is the owner's tap on Today.
 */
export async function prepareRdfSwitches(now: Date): Promise<void> {
  const todayKey = businessDateKey(now);
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(5, 7));
  await prisma.$transaction(async (tx) => {
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { rdfThresholdCrossedOn: true, shortTermLeaseElection: true, rdfCpaConfirmedOn: true },
    });
    if (!settings) throw new Error("BusinessSettings must be initialized.");

    if (month === 12 || month === 1) {
      const targetYear = month === 12 ? year + 1 : year;
      const jan1 = day(`${targetYear}-01-01`);
      const priorTotal = await recordedRetailSales(tx, targetYear - 1);
      const priorPriorTotal = await recordedRetailSales(tx, targetYear - 2);
      const thresholdCents = (await ruleAsOf<number>("co.rdf.qualified_threshold", jan1, tx)).value;
      // The live decision, asked about sales tests only, is the oracle for
      // whether the fee is on — preparation never invents its own test.
      const appliesOn = (on: Date, previous: number, current: number) =>
        retailDeliveryFeeStatus({
          today: on, saleType: "GOODS", election: settings.shortTermLeaseElection,
          previousYearRetailCents: previous, currentYearRetailCents: current,
          thresholdCents, thresholdCrossedOn: settings.rdfThresholdCrossedOn,
          handling: "PAY_MYSELF", cpaConfirmedOn: settings.rdfCpaConfirmedOn ?? on,
        }).status === "APPLIES";
      const appliesNext = appliesOn(jan1, priorTotal, 0);
      const appliedLast = appliesOn(day(`${targetYear - 1}-12-31`), priorPriorTotal, priorTotal);
      const wanted: "START" | "STOP" | null =
        appliesNext && !appliedLast ? "START"
        : !appliesNext && appliedLast && priorTotal > 0 ? "STOP"
        : null;
      if (month === 1) {
        // December prepared from a running total; if the final total points
        // the other way, replace the still-unapproved switch.
        const stale = await tx.retailDeliveryFeeSwitch.findFirst({
          where: { startsOn: jan1, approvedAt: null },
          select: { id: true, kind: true },
        });
        if (stale && stale.kind !== wanted) {
          await tx.retailDeliveryFeeSwitch.delete({ where: { id: stale.id } });
        }
      }
      if (wanted) await prepareSwitch(tx, wanted, jan1, priorTotal);
    }

    if (settings.rdfThresholdCrossedOn) {
      const startsOn = rdfQualifiedEndsOn(settings.rdfThresholdCrossedOn);
      // An earlier START (for example the January 1 one) already covers this.
      const earlier = await tx.retailDeliveryFeeSwitch.findFirst({
        where: { kind: "START", startsOn: { lte: startsOn } },
        select: { id: true },
      });
      if (!earlier) await prepareSwitch(tx, "START", startsOn, null);
    }
  });
}

/**
 * Prepared switches the owner has not approved yet, earliest first. Per
 * spec §6.3 the To do (and the owner email) appear 30 days before the start;
 * a switch whose date has passed stays listed until it is approved.
 */
export async function listPendingRdfSwitches(now: Date) {
  return prisma.retailDeliveryFeeSwitch.findMany({
    where: {
      approvedAt: null,
      startsOn: { lte: new Date(now.getTime() + 30 * 24 * 3600 * 1000) },
    },
    orderBy: [{ startsOn: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, startsOn: true, basisRetailCents: true, createdAt: true },
  });
}

/** The owner's approval on Today. Locks the row and re-checks the actor, like every write. */
export async function approveRdfSwitch(actorUserId: string, switchId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "RetailDeliveryFeeSwitch" WHERE "id" = ${switchId} FOR UPDATE`;
    const row = await tx.retailDeliveryFeeSwitch.findUnique({
      where: { id: switchId },
      select: { id: true, kind: true, startsOn: true, approvedAt: true },
    });
    if (!row) throw new Error("That delivery fee switch no longer exists.");
    if (row.approvedAt) return;
    await tx.retailDeliveryFeeSwitch.update({
      where: { id: switchId },
      data: { approvedAt: new Date(), approvedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "tax.rdf.switch_approved",
        entityType: "RetailDeliveryFeeSwitch", entityId: switchId,
        newValue: { kind: row.kind, startsOn: businessDateKey(row.startsOn) },
      },
    });
  });
}
