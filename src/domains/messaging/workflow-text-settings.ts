import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { communicationsPolicySchema, type CommunicationsPolicy } from "./communications-policy";
import { quietHoursSchema, RECOMMENDED_QUIET_HOURS, type QuietHours } from "./quiet-hours";
import {
  REQUIRED_TEXT_FOOTER, WORKFLOW_TEXT_FAMILIES, workflowTextFamily, type WorkflowTextFamily,
} from "./workflow-text-catalog";
import { smsPreview, templateVariables } from "./sms-template";

/**
 * Owner-only controls for workflow texts: approve the wording, switch each kind of text on or off, set quiet hours.
 * Nothing here sends a text, and nothing here turns on the master text switch.
 */
export type FamilySetting = {
  key: string; label: string; when: string; group: WorkflowTextFamily["group"];
  enabled: boolean; approved: boolean; wording: string; sample: string; sampleParts: number;
  approvedWordingIsStarting: boolean; needsLegalReview: boolean;
};
export type WorkflowTextSettings = {
  policyReady: boolean; policyVersion: number; quietHours: QuietHours; quietHoursIsRecommended: boolean;
  families: FamilySetting[];
};

function sampleFor(family: WorkflowTextFamily, body: string): { text: string; parts: number } {
  const values: Record<string, string> = {};
  for (const [name, rule] of Object.entries(family.variables)) values[name] = rule.example;
  let text = body;
  for (const name of templateVariables(body, family.variables)) text = text.replaceAll(`{{${name}}}`, values[name] ?? "");
  return { text, parts: smsPreview(text).segments };
}

export async function getWorkflowTextSettings(ownerUserId: string): Promise<WorkflowTextSettings> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" },
      select: { communicationsPolicy: true, communicationsPolicyVersion: true } });
    const parsed = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
    const policy = parsed.success ? parsed.data : null;
    const current = await tx.communicationTemplateRevision.findMany({
      where: { key: { in: WORKFLOW_TEXT_FAMILIES.map((f) => f.key) }, channel: "SMS", isCurrent: true, approvedAt: { not: null } } });
    const quiet = policy?.quietHours ?? RECOMMENDED_QUIET_HOURS;
    return {
      policyReady: Boolean(policy), policyVersion: settings?.communicationsPolicyVersion ?? 0,
      quietHours: quiet,
      quietHoursIsRecommended: quiet.startMinute === RECOMMENDED_QUIET_HOURS.startMinute && quiet.endMinute === RECOMMENDED_QUIET_HOURS.endMinute,
      families: WORKFLOW_TEXT_FAMILIES.map((family) => {
        const rev = current.find((r) => r.key === family.key);
        const wording = rev?.body ?? family.defaultBody;
        const sample = sampleFor(family, wording);
        return { key: family.key, label: family.label, when: family.when, group: family.group,
          enabled: policy?.workflowTexts?.families[family.key]?.enabled === true, approved: Boolean(rev),
          wording, sample: sample.text, sampleParts: sample.parts, approvedWordingIsStarting: rev ? rev.body === family.defaultBody : true,
          needsLegalReview: Boolean(family.needsLegalReview) };
      }),
    };
  });
}

type Tx = Prisma.TransactionClient;
export async function updatePolicy(tx: Tx, ownerUserId: string, expectedVersion: number,
  change: (policy: CommunicationsPolicy) => CommunicationsPolicy, audit: Prisma.InputJsonValue) {
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
  const row = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" },
    select: { communicationsPolicy: true, communicationsPolicyVersion: true } });
  if (row.communicationsPolicyVersion !== expectedVersion) throw new Error("Settings changed. Refresh before saving.");
  const parsed = communicationsPolicySchema.safeParse(row.communicationsPolicy);
  if (!parsed.success) throw new Error("Finish the phone setup in Settings first.");
  const version = expectedVersion + 1;
  const next = communicationsPolicySchema.parse(change({ ...parsed.data, approvedPolicyVersion: version }));
  await tx.businessSettings.update({ where: { id: "singleton" },
    data: { communicationsPolicy: next, communicationsPolicyVersion: version } });
  await tx.auditLog.create({ data: { userId: ownerUserId, action: "COMMUNICATION_POLICY_UPDATED",
    entityType: "BusinessSettings", entityId: "singleton", newValue: { version, ...(audit as object) } } });
  return version;
}

export async function setWorkflowTextEnabled(
  ownerUserId: string, input: { family: string; enabled: boolean; expectedVersion: number },
): Promise<{ version: number }> {
  const family = workflowTextFamily(input.family);
  if (!family) throw new Error("Unknown text message.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    if (input.enabled) {
      const rev = await tx.communicationTemplateRevision.findFirst({ where: { key: family.key, channel: "SMS", isCurrent: true, approvedAt: { not: null } } });
      if (!rev) throw new Error("Approve the wording before switching this text on.");
    }
    const version = await updatePolicy(tx, ownerUserId, input.expectedVersion, (p) => ({ ...p,
      workflowTexts: { families: { ...(p.workflowTexts?.families ?? {}), [family.key]: { enabled: input.enabled } } } }),
      { workflowText: family.key, enabled: input.enabled });
    return { version };
  });
}

export async function saveWorkflowQuietHours(
  ownerUserId: string, input: { quietHours: QuietHours | null; expectedVersion: number },
): Promise<{ version: number }> {
  const hours = input.quietHours ? quietHoursSchema.parse(input.quietHours) : null;
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    const version = await updatePolicy(tx, ownerUserId, input.expectedVersion, (p) => {
      const { quietHours: _drop, ...rest } = p; void _drop;
      return hours ? { ...rest, quietHours: hours } : rest;
    }, { quietHours: hours ?? "recommended" });
    return { version };
  });
}

/**
 * The Owner approves wording. Saved as a new numbered revision that becomes current; older revisions stay untouched so
 * past texts still point to the exact words they used. Switching a text off is separate from approving it.
 */
export async function approveWorkflowWording(
  ownerUserId: string, input: { family: string; body: string },
): Promise<{ revision: number; changed: boolean }> {
  const family = workflowTextFamily(input.family);
  if (!family) throw new Error("Unknown text message.");
  const body = input.body.trim().replace(/\s+/g, " ");
  if (body.length < 10 || body.length > 600) throw new Error("The wording must be between 10 and 600 characters.");
  if (!REQUIRED_TEXT_FOOTER.test(body)) throw new Error('Keep "Reply STOP to opt out." in the text.');
  let used: string[];
  try { used = templateVariables(body, family.variables); } catch { throw new Error("The wording uses a blank that is not allowed for this text."); }
  if (family.key && !body.includes("Robinson Appliance Rentals")) throw new Error("Keep the business name in the text so people know who it is from.");
  const worst = body.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => "x".repeat(family.variables[name]?.maxLength ?? 0));
  if (smsPreview(worst).segments > 3) throw new Error("The wording is too long: it could use more than 3 text parts.");
  void used;
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const latest = await tx.communicationTemplateRevision.findFirst({ where: { key: family.key }, orderBy: { revision: "desc" } });
    if (latest?.isCurrent && latest.approvedAt && latest.body === body) return { revision: latest.revision, changed: false };
    const revision = (latest?.revision ?? 0) + 1;
    await tx.communicationTemplateRevision.updateMany({ where: { key: family.key, isCurrent: true }, data: { isCurrent: false } });
    await tx.communicationTemplateRevision.create({ data: {
      key: family.key, revision, channel: "SMS", purpose: "TRANSACTIONAL", body,
      triggerKey: family.key, variables: family.variables as unknown as Prisma.InputJsonValue,
      isCurrent: true, approvedAt: new Date(), approvedByUserId: ownerUserId, createdByUserId: ownerUserId } });
    await tx.auditLog.create({ data: { userId: ownerUserId, action: "COMMUNICATION_TEMPLATE_APPROVED",
      entityType: "CommunicationTemplateRevision", entityId: `${family.key}:${revision}`, newValue: { revision } } });
    return { revision, changed: true };
  });
}
