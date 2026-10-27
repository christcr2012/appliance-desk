// OPS-4: the owner's insurance records. Each write checks the acting team member inside the transaction and locks its row.
// Nothing here contacts anyone: the certificate request only records the ask and drafts an email Chris sends himself.
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey } from "@/lib/business-date";
import {
  KIND_LABELS, certificateEmailDraft, checkCertificateRequest, checkPolicyInput, validateReminderDays,
  type CertificateRequestInput, type InsuranceKindValue, type PolicyInput, type WorkersCompStatusValue,
} from "./rules";

export class InsuranceError extends Error {}

const dateOf = (key: string | undefined) => (key ? businessDateFromKey(key) : null);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type PolicyFacts = { kind: InsuranceKindValue; insurer: string; policyNumber: string; effectiveOn: Date | null; expiresOn: Date; annualPremiumCents: number | null };

/** What the certificate's business record says about its policy. Reminders on the record start only on the day the policy ends (the insurance screen already reminds 60 and 30 days earlier). */
const recordFields = (p: PolicyFacts) => ({
  title: `${KIND_LABELS[p.kind]} certificate — ${p.insurer}`,
  agency: p.insurer, referenceNumber: p.policyNumber, issuedOn: p.effectiveOn, expiresOn: p.expiresOn,
  costCents: p.annualPremiumCents,
});

async function syncCertificateRecord(tx: Tx, actorUserId: string, recordId: string, p: PolicyFacts) {
  await tx.$queryRaw`SELECT "id" FROM "BusinessPaperwork" WHERE "id" = ${recordId} FOR UPDATE`;
  await tx.businessPaperwork.update({ where: { id: recordId }, data: { ...recordFields(p), updatedByUserId: actorUserId, version: { increment: 1 } } });
}

export async function savePolicy(actorUserId: string, policyId: string | null, input: PolicyInput): Promise<string> {
  const { problem, clean } = checkPolicyInput(input);
  if (problem) throw new InsuranceError(problem);
  const expiresOn = dateOf(clean.expiresOnKey);
  if (!expiresOn) throw new InsuranceError("Pick the date this policy ends.");
  const data = {
    kind: clean.kind, insurer: clean.insurer, policyNumber: clean.policyNumber, limitsText: clean.limitsText ?? null,
    annualPremiumCents: clean.annualPremiumCents ?? null, effectiveOn: dateOf(clean.effectiveOnKey), expiresOn,
    agentName: clean.agentName ?? null, agentEmail: clean.agentEmail ?? null, certificateNote: clean.certificateNote ?? null, notes: clean.notes ?? null,
  };
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    if (policyId) {
      await tx.$queryRaw`SELECT "id" FROM "OwnerInsurancePolicy" WHERE "id" = ${policyId} FOR UPDATE`;
      const before = await tx.ownerInsurancePolicy.findUnique({ where: { id: policyId } });
      if (!before) throw new InsuranceError("Couldn't find that policy.");
      await tx.ownerInsurancePolicy.update({ where: { id: policyId }, data });
      // A policy renewal (new end date, cost or number) carries onto its certificate record in the same step.
      if (before.recordId) await syncCertificateRecord(tx, actorUserId, before.recordId, data);
      await tx.auditLog.create({ data: { userId: actorUserId, action: "insurance.policy_updated", entityType: "OwnerInsurancePolicy", entityId: policyId, newValue: { kind: data.kind, insurer: data.insurer, expiresOn: clean.expiresOnKey } } });
      return policyId;
    }
    const made = await tx.ownerInsurancePolicy.create({ data: { ...data, createdByUserId: actorUserId } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "insurance.policy_added", entityType: "OwnerInsurancePolicy", entityId: made.id, newValue: { kind: data.kind, insurer: data.insurer, expiresOn: clean.expiresOnKey } } });
    return made.id;
  });
}

/**
 * OPS-4 + VAULT-1: keep this policy's certificate PDF on a business record (private files, magic-byte checks, export pack
 * and the "Renewed..." history all come from the records vault). Owner only, because that is who the vault lets
 * upload. Idempotent: a second press (or a double click) finds the record already linked and creates nothing.
 */
export async function keepCertificateOnRecord(actorUserId: string, policyId: string): Promise<{ recordId: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "OwnerInsurancePolicy" WHERE "id" = ${policyId} FOR UPDATE`;
    const policy = await tx.ownerInsurancePolicy.findUnique({ where: { id: policyId } });
    if (!policy) throw new InsuranceError("Couldn't find that policy.");
    if (policy.recordId) return { recordId: policy.recordId, created: false };
    const last = await tx.businessPaperwork.aggregate({ _max: { sortOrder: true } });
    const record = await tx.businessPaperwork.create({
      data: {
        ...recordFields(policy), remindDaysBefore: 0, groupName: "Insurance", kind: "INSURANCE", status: "DONE",
        sortOrder: (last._max.sortOrder ?? 0) + 10, createdByUserId: actorUserId, updatedByUserId: actorUserId,
      },
      select: { id: true },
    });
    await tx.ownerInsurancePolicy.update({ where: { id: policyId }, data: { recordId: record.id } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "insurance.certificate_record_created", entityType: "OwnerInsurancePolicy", entityId: policyId, newValue: { recordId: record.id } } });
    return { recordId: record.id, created: true };
  });
}

export async function archivePolicy(actorUserId: string, policyId: string, archive: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "OwnerInsurancePolicy" WHERE "id" = ${policyId} FOR UPDATE`;
    const row = await tx.ownerInsurancePolicy.findUnique({ where: { id: policyId }, select: { id: true } });
    if (!row) throw new InsuranceError("Couldn't find that policy.");
    await tx.ownerInsurancePolicy.update({ where: { id: policyId }, data: { archivedAt: archive ? new Date() : null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: archive ? "insurance.policy_archived" : "insurance.policy_restored", entityType: "OwnerInsurancePolicy", entityId: policyId } });
  });
}

export async function saveReminderDays(actorUserId: string, first: number, second: number): Promise<void> {
  const problem = validateReminderDays(first, second);
  if (problem) throw new InsuranceError(problem);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { insuranceRemindFirstDays: true, insuranceRemindSecondDays: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { insuranceRemindFirstDays: first, insuranceRemindSecondDays: second } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.insurance_reminders", entityType: "BusinessSettings", entityId: "singleton", oldValue: before, newValue: { first, second } } });
  });
}

export async function saveWorkersComp(actorUserId: string, input: { status: WorkersCompStatusValue; employees: number; note?: string; formSentOnKey?: string; mailNumber?: string }): Promise<void> {
  if (!["NOT_SET", "NO_EMPLOYEES_REJECTED", "POLICY_IN_PLACE"].includes(input.status)) throw new InsuranceError("Choose a status.");
  if (!Number.isInteger(input.employees) || input.employees < 0 || input.employees > 1000) throw new InsuranceError("Enter how many employees you have (0 if none).");
  const formSentOn = input.formSentOnKey ? businessDateFromKey(input.formSentOnKey) : null;
  if (input.formSentOnKey && !formSentOn) throw new InsuranceError("Pick a real date for when the form was sent.");
  if (input.status === "NO_EMPLOYEES_REJECTED" && input.employees > 0) throw new InsuranceError("You can't have chosen to go without coverage and also have employees. Set the number of employees to 0, or record the policy.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { workersCompStatus: true, workersCompEmployees: true } });
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: {
        workersCompStatus: input.status, workersCompEmployees: input.employees, workersCompNote: input.note?.trim().slice(0, 300) || null,
        workersCompFormSentOn: formSentOn, workersCompMailNumber: input.mailNumber?.trim().slice(0, 80) || null,
      },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.workers_comp", entityType: "BusinessSettings", entityId: "singleton", oldValue: before, newValue: { status: input.status, employees: input.employees } } });
  });
}

/** Records the ask and returns the email to send. Sends nothing. */
export async function requestCertificate(actorUserId: string, policyId: string, request: CertificateRequestInput) {
  const problem = checkCertificateRequest(request);
  if (problem) throw new InsuranceError(problem);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "OwnerInsurancePolicy" WHERE "id" = ${policyId} FOR UPDATE`;
    const policy = await tx.ownerInsurancePolicy.findUnique({ where: { id: policyId } });
    if (!policy || policy.archivedAt) throw new InsuranceError("Couldn't find that policy.");
    if (!policy.agentEmail) throw new InsuranceError("Add your agent's email to this policy first, so the request has somewhere to go.");
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorUserId }, select: { name: true, email: true } });
    await tx.insuranceCertificateRequest.create({
      data: {
        policyId, requesterName: request.requesterName.trim().slice(0, 120), requesterCompany: request.requesterCompany?.trim().slice(0, 120) || null,
        requesterEmail: request.requesterEmail.trim().slice(0, 160), holderText: request.holderText?.trim().slice(0, 400) || null, requestedByUserId: actorUserId,
      },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "insurance.certificate_requested", entityType: "OwnerInsurancePolicy", entityId: policyId, newValue: { requester: request.requesterName.trim(), company: request.requesterCompany?.trim() ?? null } } });
    return certificateEmailDraft({
      agentEmail: policy.agentEmail, agentName: policy.agentName, insurer: policy.insurer, policyNumber: policy.policyNumber,
      kindLabel: KIND_LABELS[policy.kind], businessName: "Robinson Appliance Rentals", requester: request, ownerName: actor.name ?? actor.email,
    });
  });
}
