import { MISSING_RECORD_MESSAGE, refrigerantRecordRequired } from "@/domains/refrigerant/rules";
import { assertNotRecalledForSale } from "@/domains/recalls/guard";
import type { Prisma, RetiredPlanChoice } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { assertCapability } from "@/domains/capabilities";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { postForSource } from "@/domains/books/post";
import { stageEquipmentBookRetirementInTx, writeOffRetiredBookAssetInTx,
  reverseBookAssetNonSaleDisposalInTx } from "@/domains/books/fixed-assets";
import { applyPartMovementsInTx, lockPartRecords, OPERATION_KEY_PATTERN } from "@/domains/purchasing/ledger";

// ---------------------------------------------------------------------------
// Retired appliances: "What's next for it?" (Batch M-2, design D-M4).
// Retiring an appliance (already built) takes it out of rentals for good. This module records what the owner decided to
// do with it. Choosing, changing, finishing or reopening a plan never books money. Scrap-yard checks are entered in a
// lump (ScrapPayment) and are not split by appliance.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export const PLAN_CHOICES: Array<{ value: RetiredPlanChoice; label: string; help: string }> = [
  { value: "SELL", label: "Sell it", help: "Keep it to sell to a customer. It is finished when the sale is rung up." },
  { value: "STRIP", label: "Strip it for parts", help: "Take the working parts for your shelf, then scrap or throw away the rest." },
  { value: "SCRAP", label: "Scrap it", help: "It goes to a scrap yard." },
  { value: "DISPOSE", label: "Throw it away", help: "It goes to the dump." },
  { value: "OTHER", label: "Donate or something else", help: "Anything else; add a short note." },
];

/** Every enum value must name its frozen book retirement purpose. */
export const BOOK_RETIREMENT_INTENT:Record<RetiredPlanChoice,string> = {
  SELL:"SELL", STRIP:"STRIP", SCRAP:"SCRAP", DISPOSE:"DISPOSE", OTHER:"DONATE_OTHER",
};

/** A plan remains operational even if the accountant must fix its journal later. */
async function bestEffortBookStep(tx:Tx,applianceId:string,work:()=>Promise<void>):Promise<void>{
 await tx.$executeRaw`SAVEPOINT book_plan`;
 try{
  await work();
  await tx.booksProblem.updateMany({where:{kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",
    subjectType:"APPLIANCE",subjectId:applianceId,resolvedAt:null},data:{resolvedAt:new Date()}});
  await tx.$executeRaw`RELEASE SAVEPOINT book_plan`;
 }catch{
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT book_plan`;
  await tx.$executeRaw`RELEASE SAVEPOINT book_plan`;
  await tx.booksProblem.upsert({where:{kind_subjectType_subjectId:{
   kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",subjectType:"APPLIANCE",subjectId:applianceId,
  }},create:{kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",subjectType:"APPLIANCE",subjectId:applianceId,
   message:"This retired appliance's book value needs review."},
   update:{message:"This retired appliance's book value needs review.",lastSeenAt:new Date(),resolvedAt:null}});
 }
}

export function planChoiceLabel(choice: RetiredPlanChoice): string {
  return PLAN_CHOICES.find((c) => c.value === choice)?.label ?? choice;
}

export class RetiredPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetiredPlanError";
  }
}

function cleanText(value: string | undefined | null, max: number): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, max) : null;
}

function pastBusinessDate(key: string): Date {
  const date = businessDateFromKey(key);
  if (!date || businessDateKey(date) !== key) throw new RetiredPlanError("Choose an actual date.");
  if (businessDateKey(new Date()) < key) throw new RetiredPlanError("The date can't be in the future.");
  return date;
}

async function lockRetired(tx: Tx, applianceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${applianceId} FOR UPDATE`;
  const appliance = await tx.appliance.findUnique({
    where: { id: applianceId },
    select: { id: true, status: true, assetNumber: true, retiredPlan: true },
  });
  if (!appliance) throw new RetiredPlanError("Couldn't find that appliance.");
  if (appliance.status !== "RETIRED") throw new RetiredPlanError("Only a retired appliance can have a plan. Retire it first.");
  return appliance;
}

/** Choose (or change) what happens next. `choice = null` goes back to "Decide later". Not allowed once marked done. */
export async function setRetiredPlan(
  actorUserId: string,
  applianceId: string,
  input: { choice: RetiredPlanChoice | null; note?: string },
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const appliance = await lockRetired(tx, applianceId);
    const existing = appliance.retiredPlan;
    if (existing?.doneOn) throw new RetiredPlanError("This one is already marked done. Reopen it first if it needs to change.");
    const note = cleanText(input.note, 300);
    if (input.choice === "OTHER" && !note) throw new RetiredPlanError("Add a short note about what happens to it.");
    if (input.choice === null) {
      if (existing) {
        const parts = await tx.partStockMovement.count({ where: { applianceId, kind: "SALVAGE" } });
        if (parts > 0) throw new RetiredPlanError("Parts were already taken from this appliance, so the plan can't be cleared. Finish it instead.");
        await tx.retiredAppliancePlan.delete({ where: { applianceId } });
      }
    } else if (existing) {
      if (existing.choice === "STRIP" && input.choice !== "STRIP") {
        const parts = await tx.partStockMovement.count({ where: { applianceId, kind: "SALVAGE" } });
        if (parts > 0) throw new RetiredPlanError("Parts were already taken from this appliance, so it has to stay “Strip it for parts”.");
      }
      await tx.retiredAppliancePlan.update({
        where: { applianceId },
        data: { choice: input.choice, note, remainder: input.choice === "STRIP" ? existing.remainder : null, decidedAt: now, decidedByUserId: actorUserId },
      });
    } else {
      await tx.retiredAppliancePlan.create({
        data: { applianceId, choice: input.choice, note, decidedAt: now, decidedByUserId: actorUserId },
      });
    }
    await tx.bookAsset.updateMany({
      where:{applianceId,retiredOn:{not:null},disposedOn:null},
      data:{retirementIntent:input.choice?BOOK_RETIREMENT_INTENT[input.choice]:"DECIDE_LATER"},
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "appliance.retired_plan.set", entityType: "Appliance", entityId: applianceId,
        oldValue: existing ? { choice: existing.choice } : undefined,
        newValue: { choice: input.choice, note },
      },
    });
  });
}

export type CompleteInput = {
  doneOnKey: string;
  note?: string;
  /** STRIP only: what happened to the rest. */
  remainder?: "SCRAPPED" | "THROWN_AWAY";
};

async function completeInTx(tx: Tx, actorUserId: string, applianceId: string, input: CompleteInput, bulk: boolean): Promise<void> {
  const doneOn = pastBusinessDate(input.doneOnKey);
  const appliance = await lockRetired(tx, applianceId);
  const plan = appliance.retiredPlan;
  if (!plan) throw new RetiredPlanError("Choose what's next for this appliance first.");
  if (plan.doneOn) return; // already done: a repeat changes nothing
  if (plan.choice === "SELL") throw new RetiredPlanError("A “Sell it” plan is finished when the sale is rung up.");
  const note = cleanText(input.note, 300);
  if (plan.choice === "OTHER" && !note && !plan.note) throw new RetiredPlanError("Add a short note about what happened to it.");
  let remainder: string | null = null;
  if (plan.choice === "STRIP") {
    if (bulk) throw new RetiredPlanError("Strip-for-parts appliances are finished one at a time, so the parts and the leftovers are recorded.");
    if (input.remainder !== "SCRAPPED" && input.remainder !== "THROWN_AWAY") throw new RetiredPlanError("Say what happened to the rest: scrapped or thrown away.");
    remainder = input.remainder;
  }
  // OPS-2: a refrigerator-type appliance can't be scrapped or thrown away until its refrigerant statement is on file.
  const refrigerant = await tx.appliance.findUnique({
    where: { id: applianceId },
    select: { assetNumber: true, applianceType: { select: { hasRefrigerant: true } }, refrigerantRecord: { select: { applianceId: true } } },
  });
  if (refrigerantRecordRequired(refrigerant?.applianceType.hasRefrigerant === true, { choice: plan.choice, remainder: remainder ?? plan.remainder }) && !refrigerant?.refrigerantRecord) {
    throw new RetiredPlanError(`${MISSING_RECORD_MESSAGE}${bulk ? ` (${refrigerant?.assetNumber ?? "one of the appliances"})` : ""}`);
  }
  await tx.retiredAppliancePlan.update({
    where: { applianceId },
    data: { doneOn, doneNote: note, doneByUserId: actorUserId, remainder: remainder ?? plan.remainder, reopenedAt: null, reopenReason: null },
  });
  await bestEffortBookStep(tx,applianceId,async()=>{
    const staged=await stageEquipmentBookRetirementInTx(
      tx,actorUserId,applianceId,doneOn,BOOK_RETIREMENT_INTENT[plan.choice]);
    if(!staged)throw new Error("Book retirement needs review.");
    await writeOffRetiredBookAssetInTx(
      tx,{kind:"equipment",userId:actorUserId},applianceId,doneOn,plan.choice.toLowerCase());
  });
  await tx.auditLog.create({
    data: {
      userId: actorUserId, action: "appliance.retired_plan.done", entityType: "Appliance", entityId: applianceId,
      newValue: { choice: plan.choice, doneOn: input.doneOnKey, remainder, note },
    },
  });
}

export async function completeRetiredPlan(actorUserId: string, applianceId: string, input: CompleteInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await completeInTx(tx, actorUserId, applianceId, input, false);
  });
}

export const BULK_DONE_LIMIT = 100;

/** Mark a truckload done at once (scrap, throw away or other plans only). All or nothing. */
export async function completeRetiredPlans(actorUserId: string, applianceIds: string[], doneOnKey: string): Promise<{ marked: number }> {
  const ids = [...new Set(applianceIds)].sort();
  if (ids.length < 1) throw new RetiredPlanError("Tick at least one appliance.");
  if (ids.length > BULK_DONE_LIMIT) throw new RetiredPlanError(`Mark up to ${BULK_DONE_LIMIT} at a time.`);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    for (const id of ids) await completeInTx(tx, actorUserId, id, { doneOnKey }, true);
    return { marked: ids.length };
  });
}

/** Owner only: put a finished plan back to "not done" with a reason (nothing was booked, so nothing is undone). */
export async function reopenRetiredPlan(actorUserId: string, applianceId: string, reason: string, now = new Date()): Promise<void> {
  const why = cleanText(reason, 200);
  if (!why) throw new RetiredPlanError("Say why it is being reopened.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const appliance = await lockRetired(tx, applianceId);
    const plan = appliance.retiredPlan;
    if (!plan?.doneOn) throw new RetiredPlanError("This one isn't marked done.");
    const liveSale = await tx.invoiceLineItem.findFirst({ where: { applianceId, invoice: { status: { not: "VOID" } } }, select: { invoice: { select: { invoiceNumber: true } } } });
    if (liveSale) throw new RetiredPlanError(`This appliance was sold on sale #${liveSale.invoice.invoiceNumber}. Cancel that sale first (Money, then Shop sales); that also puts its book value back.`);
    await tx.retiredAppliancePlan.update({
      where: { applianceId },
      data: { doneOn: null, doneNote: null, doneByUserId: null, reopenedAt: now, reopenReason: why },
    });
    await bestEffortBookStep(tx,applianceId,async()=>{
      await reverseBookAssetNonSaleDisposalInTx(
        tx,{kind:"equipment",userId:actorUserId},applianceId,now);
    });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "appliance.retired_plan.reopened", entityType: "Appliance", entityId: applianceId, newValue: { reason: why } },
    });
  });
}

// ---------------------------------------------------------------------------
// Parts taken from a stripped appliance
// ---------------------------------------------------------------------------

export type SalvageLine =
  | { partRecordId: string; quantity: number; note?: string }
  | { newPart: { modelNumber: string; partNumber: string; partName?: string }; quantity: number; note?: string };

const MAX_SALVAGE_LINES = 30;
const MAX_SALVAGE_QUANTITY = 100;

/**
 * Adds the parts kept from a "Strip it for parts" appliance to stock at $0 cost (what they cost is already inside the
 * appliance's purchase price). One request key makes a retry change nothing.
 */
export async function addSalvagedParts(
  actorUserId: string,
  applianceId: string,
  operationKey: string,
  lines: SalvageLine[],
): Promise<{ partRecordIds: string[]; replayed: boolean }> {
  if (!OPERATION_KEY_PATTERN.test(operationKey)) throw new RetiredPlanError("This request has no valid identity. Reload the page and try again.");
  if (lines.length < 1) throw new RetiredPlanError("Add at least one part.");
  if (lines.length > MAX_SALVAGE_LINES) throw new RetiredPlanError(`Add up to ${MAX_SALVAGE_LINES} parts at a time.`);
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_SALVAGE_QUANTITY) {
      throw new RetiredPlanError(`Enter a quantity from 1 to ${MAX_SALVAGE_QUANTITY}.`);
    }
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const appliance = await lockRetired(tx, applianceId);
    // OPS-1: parts from a recalled machine are not listed for sale.
    await assertNotRecalledForSale(tx, applianceId, "listed for parts");
    const plan = appliance.retiredPlan;
    if (!plan || plan.choice !== "STRIP") throw new RetiredPlanError("Choose “Strip it for parts” for this appliance first.");

    // A retry (lost response, double tap) finds its first run by the key and changes nothing.
    const prior = await tx.partStockMovement.findMany({ where: { applianceId, kind: "SALVAGE", operationKey: { startsWith: `${operationKey}:` } }, select: { partRecordId: true } });
    if (prior.length > 0) return { partRecordIds: prior.map((m) => m.partRecordId), replayed: true };
    if (plan.doneOn) throw new RetiredPlanError("This one is already marked done. Reopen it first to add more parts.");

    // Resolve parts: reuse an existing one or create a new one (same model + part number is reused, not duplicated).
    const resolved: Array<{ partRecordId: string; quantity: number; note: string | null }> = [];
    for (const line of lines) {
      if ("partRecordId" in line) {
        const part = await tx.partRecord.findUnique({ where: { id: line.partRecordId }, select: { id: true, archivedAt: true } });
        if (!part) throw new RetiredPlanError("One of those parts no longer exists. Reload the page.");
        if (part.archivedAt) throw new RetiredPlanError("One of those parts is archived. Restore it on the Parts screen first.");
        resolved.push({ partRecordId: part.id, quantity: line.quantity, note: cleanText(line.note, 200) });
      } else {
        const modelNumber = cleanText(line.newPart.modelNumber, 80);
        const partNumber = cleanText(line.newPart.partNumber, 80);
        if (!modelNumber || !partNumber) throw new RetiredPlanError("A new part needs the model it fits and its part number.");
        const found = await tx.partRecord.findFirst({
          where: { modelNumber: { equals: modelNumber, mode: "insensitive" }, partNumber: { equals: partNumber, mode: "insensitive" }, archivedAt: null },
          select: { id: true },
        });
        const id = found?.id ?? (await tx.partRecord.create({
          data: { modelNumber, partNumber, partName: cleanText(line.newPart.partName, 120) },
          select: { id: true },
        })).id;
        resolved.push({ partRecordId: id, quantity: line.quantity, note: cleanText(line.note, 200) });
      }
    }
    const ids = resolved.map((r) => r.partRecordId);
    if (new Set(ids).size !== ids.length) throw new RetiredPlanError("Each part can be on the list once. Change its quantity instead of adding it again.");
    await lockPartRecords(tx, ids);
    for (const r of resolved) {
      await applyPartMovementsInTx(tx, actorUserId, `${operationKey}:${r.partRecordId}`, [
        {
          partRecordId: r.partRecordId, kind: "SALVAGE", quantityDelta: r.quantity, unitCostCents: 0, applianceId,
          reason: `Taken from retired appliance ${appliance.assetNumber}${r.note ? `: ${r.note}` : ""}`,
        },
      ]);
    }
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "appliance.salvage", entityType: "Appliance", entityId: applianceId,
        newValue: { operationKey, parts: resolved.map((r) => ({ partRecordId: r.partRecordId, quantity: r.quantity })) },
      },
    });
    return { partRecordIds: ids, replayed: false };
  });
}

export async function getSalvagedParts(applianceId: string) {
  return prisma.partStockMovement.findMany({
    where: { applianceId, kind: "SALVAGE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true, quantityDelta: true, createdAt: true, reason: true,
      partRecord: { select: { id: true, modelNumber: true, partNumber: true, partName: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// The retired list and the Today reminder
// ---------------------------------------------------------------------------

export type RetiredFilter = "ALL" | "DECIDE_LATER" | RetiredPlanChoice | "DONE";
export const RETIRED_LIST_LIMIT = 300;

export async function listRetiredAppliances(actorUserId: string, filter: RetiredFilter = "ALL") {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN", "STAFF"]);
  const where: Prisma.ApplianceWhereInput = { status: "RETIRED" };
  if (filter === "DECIDE_LATER") where.retiredPlan = { is: null };
  else if (filter === "DONE") where.retiredPlan = { is: { doneOn: { not: null } } };
  else if (filter !== "ALL") where.retiredPlan = { is: { choice: filter, doneOn: null } };
  const rows = await prisma.appliance.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: RETIRED_LIST_LIMIT,
    select: {
      id: true, assetNumber: true, manufacturer: true, model: true, serialNumber: true, updatedAt: true,
      applianceType: { select: { name: true } },
      retiredPlan: { select: { choice: true, note: true, remainder: true, doneOn: true, doneNote: true, decidedAt: true } },
    },
  });
  return rows;
}

export async function countRetiredByState(actorUserId: string) {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN", "STAFF"]);
  const [all, decideLater, done] = await Promise.all([
    prisma.appliance.count({ where: { status: "RETIRED" } }),
    prisma.appliance.count({ where: { status: "RETIRED", retiredPlan: { is: null } } }),
    prisma.appliance.count({ where: { status: "RETIRED", retiredPlan: { is: { doneOn: { not: null } } } } }),
  ]);
  return { all, decideLater, done, waiting: all - done };
}

/** Whole Denver days from one business date to another (both "YYYY-MM-DD"). */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

/** True when a retirement dated `retiredAt` has waited at least `followUpDays` Denver days. 0 = reminders off. */
export function retirementIsOverdue(retiredAt: Date, now: Date, followUpDays: number): boolean {
  if (!Number.isSafeInteger(followUpDays) || followUpDays <= 0) return false;
  return daysBetweenKeys(businessDateKey(retiredAt), businessDateKey(now)) >= followUpDays;
}

/**
 * The single Today reminder: how many retired appliances have had no plan, or an unfinished one, for at least the
 * owner's number of days (counted from the day it was retired). Never per appliance, never blocking.
 */
export async function countRetiredAwaitingDecision(now = new Date()): Promise<number> {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { retiredFollowUpDays: true } });
  const days = settings?.retiredFollowUpDays ?? 30;
  if (days <= 0) return 0;
  // Read in pages of 50 (the Today list never reads more than 50 rows at once); 20 pages is far more than the fleet.
  const waiting: { id: string; updatedAt: Date }[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = await prisma.appliance.findMany({
      where: { status: "RETIRED", OR: [{ retiredPlan: { is: null } }, { retiredPlan: { is: { doneOn: null } } }] },
      select: { id: true, updatedAt: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 50,
      ...(waiting.length ? { cursor: { id: waiting[waiting.length - 1].id }, skip: 1 } : {}),
    });
    waiting.push(...rows);
    if (rows.length < 50) break;
  }
  if (waiting.length === 0) return 0;
  // The day it was retired comes from the status-change record; an older appliance falls back to its last update.
  const events = await prisma.auditLog.findMany({
    where: { action: "appliance.unit.status", entityType: "Appliance", entityId: { in: waiting.map((w) => w.id) }, newValue: { path: ["status"], equals: "RETIRED" } },
    select: { entityId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const retiredOn = new Map<string, Date>();
  for (const e of events) if (e.entityId && !retiredOn.has(e.entityId)) retiredOn.set(e.entityId, e.createdAt);
  return waiting.filter((w) => retirementIsOverdue(retiredOn.get(w.id) ?? w.updatedAt, now, days)).length;
}

// ---------------------------------------------------------------------------
// Scrap money received (a lump per check or ticket)
// ---------------------------------------------------------------------------

export type ScrapPaymentInput = {
  operationKey: string;
  receivedOnKey: string;
  amountCents: number;
  yardName: string;
  note?: string;
  depositAccountId: string;
};

export async function recordScrapPayment(actorUserId: string, input: ScrapPaymentInput): Promise<{ id: string; replayed: boolean }> {
  if (!OPERATION_KEY_PATTERN.test(input.operationKey)) throw new RetiredPlanError("This request has no valid identity. Reload the page and try again.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 1_000_000_00) throw new RetiredPlanError("Enter an amount greater than $0 and at most $1,000,000.");
  const yardName = cleanText(input.yardName, 120);
  if (!yardName) throw new RetiredPlanError("Enter the scrap yard's name.");
  const receivedOn = pastBusinessDate(input.receivedOnKey);
  const note = cleanText(input.note, 300);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const existing = await tx.scrapPayment.findUnique({ where: { operationKey: input.operationKey } });
    if (existing) {
      if (existing.amountCents !== input.amountCents || existing.yardName !== yardName || businessDateKey(existing.receivedOn) !== input.receivedOnKey || existing.depositAccountId !== input.depositAccountId) {
        throw new RetiredPlanError("That request was already used for a different entry. Reload the page and try again.");
      }
      return { id: existing.id, replayed: true };
    }
    const deposit = await tx.ledgerAccount.findUnique({ where: { id: input.depositAccountId }, select: { isPaymentSource: true, active: true, type: true } });
    if (!deposit || !deposit.active || !deposit.isPaymentSource || deposit.type !== "ASSET") {
      throw new RetiredPlanError("Choose the bank or cash account the money went into.");
    }
    const created = await tx.scrapPayment.create({
      data: {
        operationKey: input.operationKey, receivedOn, amountCents: input.amountCents, yardName, note,
        depositAccountId: input.depositAccountId, recordedByUserId: actorUserId,
      },
    });
    await postForSource(tx, "SCRAP_PAYMENT", created.id);
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "scrap_payment.create", entityType: "ScrapPayment", entityId: created.id, newValue: { amountCents: input.amountCents, yardName, receivedOn: input.receivedOnKey } },
    });
    return { id: created.id, replayed: false };
  });
}

export async function voidScrapPayment(actorUserId: string, id: string, reason: string, now = new Date()): Promise<void> {
  const why = cleanText(reason, 200);
  if (!why) throw new RetiredPlanError("Say why this entry is being voided.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "ScrapPayment" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.scrapPayment.findUnique({ where: { id } });
    if (!row) throw new RetiredPlanError("Couldn't find that entry.");
    if (row.voidedAt) return;
    await tx.scrapPayment.update({ where: { id }, data: { voidedAt: now, voidReason: why, voidedByUserId: actorUserId } });
    await postForSource(tx, "SCRAP_PAYMENT", id);
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "scrap_payment.void", entityType: "ScrapPayment", entityId: id, newValue: { reason: why } },
    });
  });
}

export const SCRAP_LIST_LIMIT = 100;

export async function listScrapPayments(actorUserId: string) {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN"]);
  return prisma.scrapPayment.findMany({
    orderBy: [{ receivedOn: "desc" }, { id: "desc" }],
    take: SCRAP_LIST_LIMIT,
    select: { id: true, receivedOn: true, amountCents: true, yardName: true, note: true, voidedAt: true, voidReason: true, depositAccountId: true },
  });
}

/** Bank and cash accounts a scrap check can be deposited to. */
export async function listDepositAccounts(actorUserId: string) {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN"]);
  return prisma.ledgerAccount.findMany({
    where: { isPaymentSource: true, active: true, type: "ASSET" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

// ---------------------------------------------------------------------------
// Owner setting: how many days before the Today reminder (0 = never remind)
// ---------------------------------------------------------------------------

export const DEFAULT_RETIRED_FOLLOW_UP_DAYS = 30;

export async function getRetiredFollowUpDays(): Promise<number> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { retiredFollowUpDays: true } });
  return row?.retiredFollowUpDays ?? DEFAULT_RETIRED_FOLLOW_UP_DAYS;
}

export async function setRetiredFollowUpDays(actorUserId: string, days: number): Promise<void> {
  if (!Number.isSafeInteger(days) || days < 0 || days > 365) throw new RetiredPlanError("Enter a number of days from 0 to 365 (0 turns the reminder off).");
  await prisma.$transaction(async (tx) => {
    await assertCapability(tx, actorUserId, "EDIT_SETTINGS");
    const before = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { retiredFollowUpDays: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { retiredFollowUpDays: days } });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "settings.retired_follow_up_days", entityType: "BusinessSettings", entityId: "singleton", oldValue: { days: before?.retiredFollowUpDays ?? null }, newValue: { days } },
    });
  });
}
