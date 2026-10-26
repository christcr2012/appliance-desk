// OPS-7: what the owner does about privacy and security duties. Everything here is owner-only and audited; nothing is
// sent to anyone by this file (letters are printed or copied by Chris).
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { ruleAsOf } from "@/domains/rules/reads";
import { clampHour, clampYears, RECOMMENDED_RETENTION, RECOMMENDED_VENDOR_REVIEW_MONTHS, type BreachRules } from "./rules";

export class SecurityError extends Error {}

export async function readBreachRules(at: Date): Promise<BreachRules> {
  const [days, ag, bureau] = await Promise.all([
    ruleAsOf<number>("co.breach_notice_days", at),
    ruleAsOf<number>("co.breach_ag_threshold", at),
    ruleAsOf<number>("co.breach_bureau_threshold", at),
  ]);
  return { noticeDays: days.value, agThreshold: ag.value, bureauThreshold: bureau.value };
}

const clean = (text: string, max: number) => text.trim().slice(0, max);

// ---------- Security incidents ----------

export async function openIncident(actorUserId: string, input: { summary: string; discoveredAt: Date }): Promise<string> {
  const summary = clean(input.summary, 1000);
  if (!summary) throw new SecurityError("Say briefly what happened or what you noticed.");
  if (Number.isNaN(input.discoveredAt.getTime()) || input.discoveredAt.getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new SecurityError("The date you found out can't be in the future.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const row = await tx.securityIncident.create({
      data: { summary, discoveredAt: input.discoveredAt, openedByUserId: actorUserId },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.incident_opened", entityType: "SecurityIncident", entityId: row.id } });
    return row.id;
  });
}

async function lockIncident(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], id: string) {
  await tx.$queryRaw`SELECT "id" FROM "SecurityIncident" WHERE "id" = ${id} FOR UPDATE`;
  const row = await tx.securityIncident.findUnique({ where: { id } });
  if (!row) throw new SecurityError("Couldn't find that incident.");
  if (row.state === "CLOSED") throw new SecurityError("This incident is already closed.");
  return row;
}

/** "Yes, information was exposed": starts the clock. Once set, the date can't be moved later to dodge a deadline. */
export async function determineIncident(actorUserId: string, id: string, input: { determinedAt: Date; residentsAffected: number }): Promise<void> {
  if (!Number.isInteger(input.residentsAffected) || input.residentsAffected < 0 || input.residentsAffected > 10_000_000) {
    throw new SecurityError("Enter how many Colorado residents were affected (0 if none).");
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const row = await lockIncident(tx, id);
    if (input.determinedAt.getTime() < row.discoveredAt.getTime()) throw new SecurityError("You can't decide before you found out.");
    if (input.determinedAt.getTime() > Date.now() + 24 * 3600 * 1000) throw new SecurityError("The date can't be in the future.");
    if (row.determinedAt && input.determinedAt.getTime() > row.determinedAt.getTime()) {
      throw new SecurityError("The date the clock started can only be moved earlier, never later.");
    }
    await tx.securityIncident.update({ where: { id }, data: { determinedAt: input.determinedAt, residentsAffected: input.residentsAffected } });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "security.incident_determined", entityType: "SecurityIncident", entityId: id, newValue: { residentsAffected: input.residentsAffected } },
    });
  });
}

export type IncidentStepKey = "RESIDENTS" | "ATTORNEY_GENERAL" | "BUREAUS" | "VENDORS";
const STEP_FIELD = {
  RESIDENTS: "residentsNotifiedAt", ATTORNEY_GENERAL: "attorneyGeneralNotifiedAt", BUREAUS: "bureausNotifiedAt", VENDORS: "vendorsNotifiedAt",
} as const;

/** Chris says he did the step himself (sent the letter, filed with the Attorney General...). The app sends nothing. */
export async function markIncidentStepDone(actorUserId: string, id: string, step: IncidentStepKey, doneAt: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const row = await lockIncident(tx, id);
    if (!row.determinedAt) throw new SecurityError("Record the decision first (was information exposed, and how many people).");
    const field = STEP_FIELD[step];
    if (row[field]) return;
    await tx.securityIncident.update({ where: { id }, data: { [field]: doneAt } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.incident_step_done", entityType: "SecurityIncident", entityId: id, newValue: { step } } });
  });
}

export async function closeIncident(actorUserId: string, id: string, note: string): Promise<void> {
  const text = clean(note, 1000);
  if (!text) throw new SecurityError("Add a short closing note: what was found and what was fixed.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const row = await lockIncident(tx, id);
    const rules = await readBreachRules(new Date());
    if (row.determinedAt && row.residentsAffected !== null) {
      const owed: string[] = [];
      if (!row.residentsNotifiedAt && row.residentsAffected > 0) owed.push("tell the affected people");
      if (row.residentsAffected >= rules.agThreshold && !row.attorneyGeneralNotifiedAt) owed.push("tell the Attorney General");
      if (row.residentsAffected > rules.bureauThreshold && !row.bureausNotifiedAt) owed.push("tell the credit bureaus");
      if (owed.length) throw new SecurityError(`Not yet: you still need to ${owed.join(", ")}.`);
    }
    await tx.securityIncident.update({ where: { id }, data: { state: "CLOSED", closedAt: new Date(), closedNote: text } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.incident_closed", entityType: "SecurityIncident", entityId: id } });
  });
}

// ---------- Service providers ----------

export async function markVendorReviewed(actorUserId: string, vendorId: string, reviewedOn: Date, notes: string): Promise<void> {
  if (Number.isNaN(reviewedOn.getTime()) || reviewedOn.getTime() > Date.now() + 24 * 3600 * 1000) throw new SecurityError("The review date can't be in the future.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "ServiceVendor" WHERE "id" = ${vendorId} FOR UPDATE`;
    const vendor = await tx.serviceVendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new SecurityError("Couldn't find that service provider.");
    await tx.serviceVendor.update({ where: { id: vendorId }, data: { termsReviewedOn: reviewedOn, termsReviewedByUserId: actorUserId, notes: clean(notes, 500) || null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.vendor_reviewed", entityType: "ServiceVendor", entityId: vendorId } });
  });
}

export async function addVendor(actorUserId: string, input: { name: string; whatTheyDo: string; dataTheyHold: string }): Promise<void> {
  const name = clean(input.name, 80);
  if (!name || !clean(input.whatTheyDo, 200) || !clean(input.dataTheyHold, 200)) throw new SecurityError("Fill in the name, what they do, and what information they hold.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const exists = await tx.serviceVendor.findUnique({ where: { name } });
    if (exists) throw new SecurityError("That service provider is already on the list.");
    const row = await tx.serviceVendor.create({ data: { name, whatTheyDo: clean(input.whatTheyDo, 200), dataTheyHold: clean(input.dataTheyHold, 200) } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.vendor_added", entityType: "ServiceVendor", entityId: row.id } });
  });
}

// ---------- Legal hold ----------

export async function setLegalHold(actorUserId: string, customerId: string, hold: boolean, reason: string): Promise<void> {
  const text = clean(reason, 500);
  if (hold && !text) throw new SecurityError("Say why (for example: dispute with this customer, or a lawyer asked us to keep everything).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { legalHoldAt: true } });
    if (!customer) throw new SecurityError("Couldn't find that customer.");
    if (hold === Boolean(customer.legalHoldAt)) return;
    await tx.customer.update({
      where: { id: customerId },
      data: hold ? { legalHoldAt: new Date(), legalHoldReason: text } : { legalHoldAt: null, legalHoldReason: null },
    });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: hold ? "security.legal_hold_on" : "security.legal_hold_off", entityType: "Customer", entityId: customerId, newValue: hold ? { reason: text } : undefined },
    });
  });
}

// ---------- Accessibility complaints ----------

export async function recordAccessibilityComplaint(actorUserId: string, input: { receivedAt: Date; fromWho: string; description: string }): Promise<string> {
  const description = clean(input.description, 2000);
  if (!description) throw new SecurityError("Describe what the person couldn't use or read.");
  if (Number.isNaN(input.receivedAt.getTime()) || input.receivedAt.getTime() > Date.now() + 24 * 3600 * 1000) throw new SecurityError("The date received can't be in the future.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const row = await tx.accessibilityComplaint.create({
      data: { receivedAt: input.receivedAt, fromWho: clean(input.fromWho, 200) || null, description, recordedByUserId: actorUserId },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.accessibility_complaint", entityType: "AccessibilityComplaint", entityId: row.id } });
    return row.id;
  });
}

export async function resolveAccessibilityComplaint(actorUserId: string, id: string, note: string): Promise<void> {
  const text = clean(note, 1000);
  if (!text) throw new SecurityError("Say what was fixed.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "AccessibilityComplaint" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.accessibilityComplaint.findUnique({ where: { id } });
    if (!row) throw new SecurityError("Couldn't find that complaint.");
    if (row.resolvedAt) return;
    await tx.accessibilityComplaint.update({ where: { id }, data: { resolvedAt: new Date(), resolvedNote: text } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "security.accessibility_resolved", entityType: "AccessibilityComplaint", entityId: id } });
  });
}

// ---------- Owner settings ----------

export type PrivacySettingsInput = {
  retentionAgreementYears: number; retentionTaxYears: number; retentionRefrigerantYears: number;
  retentionLeadYears: number; retentionMessageYears: number; retentionPurgeEnabled: boolean;
  faceMatchIdEnabled: boolean; marketingTextStartHour: number; marketingTextEndHour: number; vendorReviewMonths: number;
};

export const RECOMMENDED_PRIVACY_SETTINGS: PrivacySettingsInput = {
  retentionAgreementYears: RECOMMENDED_RETENTION.agreementYears, retentionTaxYears: RECOMMENDED_RETENTION.taxYears,
  retentionRefrigerantYears: RECOMMENDED_RETENTION.refrigerantYears, retentionLeadYears: RECOMMENDED_RETENTION.leadYears,
  retentionMessageYears: RECOMMENDED_RETENTION.messageYears, retentionPurgeEnabled: false, faceMatchIdEnabled: false,
  marketingTextStartHour: 8, marketingTextEndHour: 21, vendorReviewMonths: RECOMMENDED_VENDOR_REVIEW_MONTHS,
};

export async function savePrivacySettings(actorUserId: string, input: PrivacySettingsInput): Promise<PrivacySettingsInput> {
  const next: PrivacySettingsInput = {
    retentionAgreementYears: clampYears(input.retentionAgreementYears, 7),
    retentionTaxYears: clampYears(input.retentionTaxYears, 7),
    retentionRefrigerantYears: clampYears(input.retentionRefrigerantYears, 6),
    retentionLeadYears: clampYears(input.retentionLeadYears, 2),
    retentionMessageYears: clampYears(input.retentionMessageYears, 3),
    retentionPurgeEnabled: Boolean(input.retentionPurgeEnabled),
    faceMatchIdEnabled: Boolean(input.faceMatchIdEnabled),
    marketingTextStartHour: clampHour(input.marketingTextStartHour, 8),
    marketingTextEndHour: clampHour(input.marketingTextEndHour, 21),
    vendorReviewMonths: Math.min(36, Math.max(1, Math.round(input.vendorReviewMonths) || 12)),
  };
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: next });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "settings.privacy", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: Object.fromEntries(Object.keys(next).map((k) => [k, (before as Record<string, unknown>)[k]])) as object,
        newValue: next as object,
      },
    });
  });
  return next;
}
