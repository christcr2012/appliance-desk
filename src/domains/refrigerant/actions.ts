// OPS-2: save the refrigerant record for a retired appliance and build the signed statement. Owner and admins only.
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { getRecord } from "@/domains/paperwork/records";
import { checkRefrigerantInput, keepUntil, refrigerantRecordRequired, type RefrigerantInput } from "./rules";
import type { StatementFacts } from "./statement";

export class RefrigerantError extends Error {}

const dateText = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" }).format(d);

export async function saveRefrigerantRecord(actorUserId: string, applianceId: string, input: RefrigerantInput): Promise<void> {
  const checked = checkRefrigerantInput(input);
  if (checked.problems.length) throw new RefrigerantError(checked.problems[0]);
  const recoveredOn = businessDateFromKey(input.recoveredOnKey);
  if (!recoveredOn || businessDateKey(recoveredOn) !== input.recoveredOnKey) throw new RefrigerantError("Choose an actual date.");
  if (businessDateKey(new Date()) < input.recoveredOnKey) throw new RefrigerantError("The date can't be in the future.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${applianceId} FOR UPDATE`;
    const appliance = await tx.appliance.findUnique({
      where: { id: applianceId },
      select: { status: true, assetNumber: true, manufacturer: true, model: true, serialNumber: true, applianceType: { select: { name: true, hasRefrigerant: true } }, retiredPlan: { select: { choice: true, remainder: true, doneOn: true } } },
    });
    if (!appliance) throw new RefrigerantError("Couldn't find that appliance.");
    if (appliance.status !== "RETIRED" || !appliance.retiredPlan) throw new RefrigerantError("Retire the appliance and choose what's next for it first.");
    if (!appliance.applianceType.hasRefrigerant) throw new RefrigerantError("This kind of appliance has no refrigerant system.");
    if (!refrigerantRecordRequired(true, appliance.retiredPlan)) throw new RefrigerantError("The statement is only needed when the appliance is scrapped or thrown away.");
    if (appliance.retiredPlan.doneOn) throw new RefrigerantError("This appliance is already marked done. Reopen it to change the record.");
    const now = new Date();
    const signer = await tx.user.findUnique({ where: { id: actorUserId }, select: { name: true, email: true } });
    const data = {
      signedByName: signer?.name ?? signer?.email ?? "the owner",
      assetNumberSnapshot: appliance.assetNumber,
      applianceDescriptionSnapshot: [appliance.manufacturer, appliance.model, appliance.applianceType.name].filter(Boolean).join(" "),
      serialNumberSnapshot: appliance.serialNumber ?? null,
      refrigerantType: checked.clean.refrigerantType, outcome: checked.clean.outcome,
      recoveredByName: checked.clean.recoveredByName, recoveredByAddress: checked.clean.recoveredByAddress,
      certificationNumber: checked.clean.certificationNumber ?? null, equipmentUsed: checked.clean.equipmentUsed ?? null,
      recoveredOn, recyclerName: checked.clean.recyclerName ?? null, receiptReference: checked.clean.receiptReference ?? null,
      statementSignedAt: now, statementSignedByUserId: actorUserId,
    };
    await tx.refrigerantRecord.upsert({ where: { applianceId }, create: { applianceId, ...data }, update: data });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "appliance.refrigerant_recorded", entityType: "Appliance", entityId: applianceId, newValue: { type: data.refrigerantType, outcome: data.outcome } },
    });
  });
}

/**
 * OPS-2 + VAULT-1: keep the recycler's receipt (photo or PDF) on one business record, so it gets the vault's private
 * files, magic-byte checks and export pack. Owner only (the vault's rule for uploads). Idempotent: pressing it twice, or
 * two people at once, finds the record already linked and creates nothing. Needs the signed record to exist first.
 */
export async function keepReceiptOnRecord(actorUserId: string, applianceId: string): Promise<{ recordId: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${applianceId} FOR UPDATE`;
    const record = await tx.refrigerantRecord.findUnique({ where: { applianceId } });
    if (!record) throw new RefrigerantError("Sign the refrigerant record first, then keep the receipt with it.");
    if (record.receiptRecordId) return { recordId: record.receiptRecordId, created: false };
    const years = (await ruleAsOf<number>("records.refrigerant_keep_years", new Date())).value;
    const last = await tx.businessPaperwork.aggregate({ _max: { sortOrder: true } });
    const made = await tx.businessPaperwork.create({
      data: {
        title: `Refrigerant disposal receipt — ${record.assetNumberSnapshot}`, groupName: "Refrigerant disposal", kind: "DOCUMENT", status: "DONE",
        agency: record.recyclerName, referenceNumber: record.receiptReference, issuedOn: record.recoveredOn, remindDaysBefore: 0,
        notes: `Keep until ${businessDateKey(keepUntil(record.recoveredOn, years))} (${years} years from the recovery date; starting value, not confirmed).`,
        sortOrder: (last._max.sortOrder ?? 0) + 10, createdByUserId: actorUserId, updatedByUserId: actorUserId,
      },
      select: { id: true },
    });
    await tx.refrigerantRecord.update({ where: { applianceId }, data: { receiptRecordId: made.id } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "appliance.refrigerant_receipt_record_created", entityType: "Appliance", entityId: applianceId, newValue: { recordId: made.id } } });
    return { recordId: made.id, created: true };
  });
}

/** `role` is the viewer's: the receipt record is shown only when the vault would show it to them. */
export async function loadRefrigerantPanel(applianceId: string, now: Date, role: string | undefined) {
  const appliance = await prisma.appliance.findUnique({
    where: { id: applianceId },
    select: { applianceType: { select: { hasRefrigerant: true } }, retiredPlan: { select: { choice: true, remainder: true, doneOn: true } }, refrigerantRecord: true },
  });
  if (!appliance?.applianceType.hasRefrigerant || !appliance.retiredPlan) return null;
  if (!refrigerantRecordRequired(true, appliance.retiredPlan)) return null;
  const years = (await ruleAsOf<number>("records.refrigerant_keep_years", now)).value;
  const record = appliance.refrigerantRecord;
  const receiptRecord = record?.receiptRecordId ? await getRecord(role, record.receiptRecordId) : null;
  return { receiptRecord: receiptRecord ? { id: receiptRecord.id, fileCount: receiptRecord.files.length } : null, record, locked: appliance.retiredPlan.doneOn !== null, years, keepUntil: record ? keepUntil(record.recoveredOn, years) : null };
}

export async function loadStatementFacts(applianceId: string): Promise<StatementFacts | null> {
  const record = await prisma.refrigerantRecord.findUnique({ where: { applianceId } });
  if (!record) return null;
  // Everything printed comes from what was saved when the statement was signed, never from today's records.
  return {
    businessName: "Robinson Appliance Rentals",
    assetNumber: record.assetNumberSnapshot,
    applianceDescription: record.applianceDescriptionSnapshot,
    serialNumber: record.serialNumberSnapshot ?? null,
    refrigerantType: record.refrigerantType,
    outcome: record.outcome,
    recoveredByName: record.recoveredByName,
    recoveredByAddress: record.recoveredByAddress,
    certificationNumber: record.certificationNumber,
    equipmentUsed: record.equipmentUsed,
    recoveredOnText: dateText(record.recoveredOn),
    signedByName: record.signedByName,
    signedOnText: dateText(record.statementSignedAt),
  };
}

/** Owner setting: which kinds of appliance have a sealed refrigerant system. Applies to future scrap/dispose steps only. */
export async function saveRefrigerantTypes(actorUserId: string, typeIds: string[]): Promise<void> {
  const wanted = new Set(typeIds);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const types = await tx.applianceType.findMany({ select: { id: true, hasRefrigerant: true } });
    for (const type of types) {
      const next = wanted.has(type.id);
      if (next === type.hasRefrigerant) continue;
      await tx.applianceType.update({ where: { id: type.id }, data: { hasRefrigerant: next } });
      await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.refrigerant_type", entityType: "ApplianceType", entityId: type.id, newValue: { hasRefrigerant: next } } });
    }
  });
}
