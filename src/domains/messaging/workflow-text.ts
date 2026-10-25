import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { recordRealContact } from "@/domains/leads/contact";
import { makeTwilioSmsProvider } from "@/lib/communications/providers/twilio-sms";
import type { TelecomSmsProvider } from "@/lib/communications/providers/types";
import { communicationsPolicySchema, evaluateSmsEligibility, type CommunicationsPolicy } from "./communications-policy";
import { dispatchCommunication, isLiveTelecomDeployment } from "./dispatch-communication";
import { requestCommunication } from "./request-communication";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { renderSmsTemplate, smsPreview, templateVariables, type VariableRules } from "./sms-template";
import { quietHoursEndAt, quietHoursSentence } from "./quiet-hours";
import { RECOMMENDED_QUIET_HOURS } from "./quiet-hours";
import { workflowTextFamily, type WorkflowTextFamily } from "./workflow-text-catalog";
import { loadWorkflowSubject, type LoadedSubject, type WorkflowPrincipal } from "./workflow-text-subjects";
import { hashCommunicationContent } from "./communications-content";

/**
 * Staff-confirmed workflow texts (COM-N1). A signed-in owner or admin opens a record, sees the EXACT text and the phone
 * it would go to, and presses Send. Nothing here sends on its own, and every gate that guards ordinary texts still
 * applies: the master switch, the policy, this family's own switch, approved wording, a ready business number,
 * STOP, recorded permission for that exact number, and quiet hours. The result of every press is recorded as a delivery.
 */

export type WorkflowBlockerCode =
  | "NOT_FOUND" | "WRONG_STATE" | "NO_PHONE" | "BAD_PHONE" | "MASTER_OFF" | "POLICY_OFF" | "FAMILY_OFF"
  | "NOT_APPROVED" | "SENDER_NOT_READY" | "STOPPED" | "NEEDS_CONSENT" | "QUIET_HOURS" | "INVALID_DESTINATION"
  | "SHARED_NUMBER" | "TEXT_PROBLEM" | "RECENT_DUPLICATE";
export type WorkflowBlocker = { code: WorkflowBlockerCode; message: string };

export type WorkflowPriorSend = { at: Date; state: string };
export type WorkflowTextPreview = {
  family: string;
  label: string;
  ready: boolean;
  blockers: WorkflowBlocker[];
  text: string | null;
  textHash: string | null;
  segments: number | null;
  recipientName: string | null;
  maskedPhone: string | null;
  /** True when the only thing missing is recorded permission, which staff can record on the screen. */
  canRecordConsent: boolean;
  consentRecorded: boolean;
  quietHours: string;
  earlier: WorkflowPriorSend[];
  needsLegalReview: boolean;
};

export const STAFF_TEXT_CONSENT_STATEMENT =
  "Staff recorded that this person agreed to receive texts from Robinson Appliance Rentals about their request, rental, appointments and billing. These are not marketing texts. They can reply STOP at any time.";
export const STAFF_TEXT_CONSENT_VERSION = "staff-evidence-v1";
export const STAFF_TEXT_CONSENT_HASH = createHash("sha256").update(STAFF_TEXT_CONSENT_STATEMENT, "utf8").digest("hex");
export const CONSENT_METHODS = { PHONE: "They agreed on the phone", WRITTEN: "They agreed in writing or by email", IN_PERSON: "They agreed in person" } as const;
export type ConsentMethod = keyof typeof CONSENT_METHODS;

const MESSAGES: Record<WorkflowBlockerCode, string> = {
  NOT_FOUND: "That record was not found.",
  WRONG_STATE: "This text does not fit where the record is right now.",
  NO_PHONE: "There is no phone number saved on this record.",
  BAD_PHONE: "The phone number saved here is not a number we can text. Fix it first.",
  MASTER_OFF: "Text messages are switched off. Turn them on in Settings, Phone, texts and provider costs, when you are ready.",
  POLICY_OFF: "Texting is not set up yet. Finish the phone setup in Settings first.",
  FAMILY_OFF: "This kind of text is switched off. You can switch it on in Settings, Phone, texts and provider costs.",
  NOT_APPROVED: "The wording for this text has not been approved yet. The Owner approves wording in Settings, Phone, texts and provider costs.",
  SENDER_NOT_READY: "The business texting number is not ready yet.",
  STOPPED: "This number replied STOP. No texts can be sent to it unless the person texts START themselves.",
  NEEDS_CONSENT: "There is no recorded permission to text this number yet.",
  QUIET_HOURS: "It is quiet hours.",
  INVALID_DESTINATION: "Texts can only go to a U.S. mobile number, and only from the live business site.",
  SHARED_NUMBER: "This phone number is already linked to a different person. Sort that out in Communications first.",
  TEXT_PROBLEM: "This text could not be put together or is too long.",
  RECENT_DUPLICATE: "A text like this was already sent recently.",
};
const block = (code: WorkflowBlockerCode, message?: string): WorkflowBlocker => ({ code, message: message ?? MESSAGES[code] });

export function maskPhone(e164: string): string {
  const ten = e164.replace(/^\+1/, "");
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ***-${ten.slice(6)}` : "***-" + e164.slice(-4);
}

type Db = Prisma.TransactionClient;
type SendContext = {
  enabled: boolean;
  policy: CommunicationsPolicy | null;
  policyVersion: number;
  account: Awaited<ReturnType<typeof loadAccount>>;
};

async function loadAccount(db: Db, policy: CommunicationsPolicy | null) {
  if (!policy) return null;
  const account = await db.telecomAccount.findUnique({ where: { id: policy.primaryAccountId },
    include: { numbers: { where: { id: policy.primaryNumberId } } } });
  return account && account.numbers[0] ? { ...account, number: account.numbers[0] } : null;
}

async function loadSendContext(db: Db): Promise<SendContext> {
  const settings = await db.businessSettings.findUnique({ where: { id: "singleton" },
    select: { customerSmsEnabled: true, communicationsPolicy: true, communicationsPolicyVersion: true } });
  const parsed = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
  const policy = parsed.success ? parsed.data : null;
  return { enabled: settings?.customerSmsEnabled === true, policy,
    policyVersion: settings?.communicationsPolicyVersion ?? 0, account: await loadAccount(db, policy) };
}

/** The current approved wording for a family, or null until the Owner approves it. */
export async function currentApprovedTemplate(db: Db, family: WorkflowTextFamily) {
  return db.communicationTemplateRevision.findFirst({
    where: { key: family.key, channel: "SMS", isCurrent: true, approvedAt: { not: null }, approvedByUserId: { not: null } },
    orderBy: { revision: "desc" },
  });
}

function renderFor(template: { body: string; variables: unknown }, values: Record<string, string>):
  { text: string; used: Record<string, string> } | null {
  try {
    const rules = template.variables as VariableRules;
    const names = templateVariables(template.body, rules);
    const used: Record<string, string> = {};
    for (const name of names) {
      if (typeof values[name] !== "string" || !values[name]) return null;
      used[name] = values[name];
    }
    return { text: renderSmsTemplate(template.body, rules, used), used };
  } catch { return null; }
}

/** Earlier texts of this kind about this record (newest first), so a second press is a deliberate choice. */
async function earlierSends(db: Db, family: WorkflowTextFamily, subject: LoadedSubject): Promise<WorkflowPriorSend[]> {
  const target = subject.links[0];
  if (!target) return [];
  const rows = await db.communicationLink.findMany({
    where: { entityType: target.entityType, entityId: target.entityId,
      message: { delivery: { templateKey: family.key } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5,
    select: { message: { select: { delivery: { select: { state: true, requestedAt: true } } } } },
  });
  return rows.flatMap((row) => row.message.delivery ? [{ at: row.message.delivery.requestedAt, state: row.message.delivery.state }] : []);
}

const RECENT_MS = 24 * 60 * 60 * 1000;
function recentDuplicate(earlier: WorkflowPriorSend[], now: Date): WorkflowPriorSend | undefined {
  return earlier.find((e) => ["PENDING", "ACCEPTED", "DELIVERED", "UNKNOWN"].includes(e.state) && now.getTime() - e.at.getTime() < RECENT_MS);
}

function mapEligibility(reason: string, ctx: SendContext, now: Date): WorkflowBlocker {
  switch (reason) {
    case "MASTER_OFF": return block("MASTER_OFF");
    case "POLICY_OFF": return block("POLICY_OFF");
    case "SENDER_NOT_READY": return block("SENDER_NOT_READY");
    case "SUPPRESSED": return block("STOPPED");
    case "NO_SCOPED_CONSENT": return block("NEEDS_CONSENT");
    case "INVALID_DESTINATION": return block("INVALID_DESTINATION");
    case "QUIET_HOURS": {
      const window = ctx.policy?.quietHours ?? RECOMMENDED_QUIET_HOURS;
      const until = quietHoursEndAt(now, window).toLocaleString("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", minute: "2-digit" });
      return block("QUIET_HOURS", `${quietHoursSentence(window)} Try again after ${until} (Colorado time).`);
    }
    default: return block("SENDER_NOT_READY");
  }
}

/** Looks only; writes nothing. Everything shown here is re-derived and re-checked when Send is pressed. */
export async function getWorkflowTextPreview(
  actorUserId: string, familyKey: string, subjectId: string, now: Date = new Date(),
): Promise<WorkflowTextPreview> {
  const family = workflowTextFamily(familyKey);
  if (!family) throw new Error("Unknown text message.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    return buildPreview(tx, family, subjectId, now);
  });
}

async function buildPreview(tx: Db, family: WorkflowTextFamily, subjectId: string, now: Date): Promise<WorkflowTextPreview> {
  const base: WorkflowTextPreview = { family: family.key, label: family.label, ready: false, blockers: [], text: null,
    textHash: null, segments: null, recipientName: null, maskedPhone: null, canRecordConsent: false,
    consentRecorded: false, quietHours: "", earlier: [], needsLegalReview: Boolean(family.needsLegalReview) };
  const ctx = await loadSendContext(tx);
  base.quietHours = quietHoursSentence(ctx.policy?.quietHours ?? RECOMMENDED_QUIET_HOURS);
  const subject = await loadWorkflowSubject(tx, family.key, subjectId, now);
  if (!subject) return { ...base, blockers: [block("NOT_FOUND")] };
  const blockers: WorkflowBlocker[] = [];
  base.recipientName = subject.displayName || null;
  if (subject.stateProblem) blockers.push(block("WRONG_STATE", subject.stateProblem));
  if (!subject.rawPhone) blockers.push(block("NO_PHONE"));
  else if (!subject.phone) blockers.push(block("BAD_PHONE"));
  if (subject.phone) base.maskedPhone = maskPhone(subject.phone);

  const template = await currentApprovedTemplate(tx, family);
  if (!template) blockers.push(block("NOT_APPROVED"));
  else {
    const rendered = renderFor(template, subject.values);
    if (!rendered) blockers.push(block("TEXT_PROBLEM"));
    else {
      const sms = smsPreview(rendered.text);
      base.text = rendered.text; base.segments = sms.segments;
      base.textHash = hashCommunicationContent(rendered.text);
      if (ctx.policy && sms.segments > ctx.policy.maxSegments) {
        blockers.push(block("TEXT_PROBLEM", `This text would be ${sms.segments} parts, more than the ${ctx.policy.maxSegments} you allow.`));
      }
    }
  }
  if (ctx.policy && ctx.policy.workflowTexts?.families[family.key]?.enabled !== true) blockers.push(block("FAMILY_OFF"));

  if (!ctx.enabled) blockers.push(block("MASTER_OFF"));
  else if (!ctx.policy || !ctx.account) blockers.push(block("POLICY_OFF"));
  else if (subject.phone) {
    const env = ctx.account.environment;
    const point = await tx.contactPoint.findUnique({ where: { environment_channel_address: { environment: env, channel: "SMS", address: subject.phone } } });
    const consents = point ? await tx.consentRecord.findMany({ where: { contactPointId: point.id },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true, contactPointId: true, purpose: true, action: true, source: true, occurredAt: true, createdAt: true,
        disclosureVersion: true, textHash: true, scope: true } }) : [];
    const legacyStop = await tx.marketingSuppression.findUnique({ where: { channel_address: { channel: "SMS", address: subject.phone } } });
    const result = legacyStop ? ({ allowed: false, reason: "SUPPRESSED" } as const) : evaluateSmsEligibility({
      enabled: ctx.enabled, policyValue: ctx.policy, policyVersion: ctx.policyVersion,
      account: ctx.account, number: ctx.account.number,
      thread: { resolution: "RESOLVED", status: "OPEN", accountId: ctx.account.id, businessNumberId: ctx.account.number.id,
        customerId: subject.principal.customerId ?? null, leadId: subject.principal.leadId ?? null },
      point: point ?? { id: "new", environment: env, suppressionState: "NONE", address: subject.phone },
      purpose: "TRANSACTIONAL", consents,
      // The free destination lookup runs when Send is pressed; here we only show whether this site could ever send.
      verifiedDestinationCountry: isLiveTelecomDeployment() ? "US" : undefined, now,
    });
    if (result.allowed) base.consentRecorded = true;
    else {
      const mapped = mapEligibility(result.reason, ctx, now);
      blockers.push(mapped);
      if (mapped.code === "NEEDS_CONSENT") base.canRecordConsent = true;
    }
    // A number already tied to a different person cannot be texted as this one.
    if (point) {
      const bindings = await tx.contactBinding.findMany({ where: { contactPointId: point.id, revokedAt: null },
        select: { customerId: true, leadId: true }, take: 5 });
      const mine = (b: { customerId: string | null; leadId: string | null }) =>
        (subject.principal.customerId && b.customerId === subject.principal.customerId) ||
        (subject.principal.leadId && b.leadId === subject.principal.leadId) ||
        (subject.convertedFromLeadId && b.leadId === subject.convertedFromLeadId);
      if (bindings.some((b) => !mine(b))) blockers.push(block("SHARED_NUMBER"));
    }
  }

  base.earlier = await earlierSends(tx, family, subject);
  const dupe = recentDuplicate(base.earlier, now);
  if (dupe) blockers.push(block("RECENT_DUPLICATE", dupe.state === "UNKNOWN"
    ? "The last attempt to send this text has an unknown result. Check Communications before sending it again."
    : "This text was already sent in the last day. Send it again only if you mean to."));

  const seen = new Set<string>();
  base.blockers = blockers.filter((b) => (seen.has(b.code) ? false : (seen.add(b.code), true)));
  // Only a missing-permission or repeat-send notice can be handled from the screen; everything else must be fixed first.
  const hard = base.blockers.filter((b) => b.code !== "NEEDS_CONSENT" && b.code !== "RECENT_DUPLICATE");
  base.canRecordConsent = base.canRecordConsent && hard.length === 0;
  base.ready = base.blockers.length === 0;
  return base;
}

async function ensureContact(
  tx: Db, actorUserId: string, ctx: SendContext & { account: NonNullable<SendContext["account"]> },
  subject: LoadedSubject, now: Date,
): Promise<{ pointId: string }> {
  const phone = subject.phone!;
  await lockCanonicalSmsAddress(tx, phone);
  const point = await tx.contactPoint.upsert({
    where: { environment_channel_address: { environment: ctx.account.environment, channel: "SMS", address: phone } },
    create: { environment: ctx.account.environment, channel: "SMS", address: phone }, update: {},
  });
  const active = await tx.contactBinding.findMany({ where: { contactPointId: point.id, revokedAt: null },
    select: { id: true, customerId: true, leadId: true, customerContactId: true } });
  const principal = subject.principal;
  const same = (b: (typeof active)[number]) => (principal.customerId && b.customerId === principal.customerId) ||
    (principal.leadId && b.leadId === principal.leadId);
  const fromLead = (b: (typeof active)[number]) => Boolean(subject.convertedFromLeadId) && b.leadId === subject.convertedFromLeadId;
  if (active.some((b) => !same(b) && !fromLead(b))) throw new Error(MESSAGES.SHARED_NUMBER);
  if (!active.some(same)) {
    await tx.contactBinding.create({ data: { contactPointId: point.id, source: "STAFF", verifiedAt: now,
      customerId: principal.customerId ?? null, leadId: principal.leadId ?? null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "COMMUNICATION_CONTACT_CONFIRMED",
      entityType: principal.customerId ? "Customer" : "Lead", entityId: (principal.customerId ?? principal.leadId)!,
      newValue: { contactPointId: point.id } } });
  }
  return { pointId: point.id };
}

/**
 * Staff say they have the person's agreement to text them (a phone call, a written reply, in person). This records that
 * as dated evidence for exactly this business number. It cannot undo a STOP or an opt-out the person made themselves.
 */
export async function recordStaffTextConsent(
  actorUserId: string, input: { principal: WorkflowPrincipal; method: ConsentMethod }, now: Date = new Date(),
): Promise<{ recorded: boolean }> {
  if (!Object.hasOwn(CONSENT_METHODS, input.method)) throw new Error("Choose how they agreed.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const ctx = await loadSendContext(tx);
    if (!ctx.policy || !ctx.account) throw new Error(MESSAGES.POLICY_OFF);
    const account = ctx.account;
    const subject = await loadSubjectForPrincipal(tx, input.principal);
    if (!subject?.phone) throw new Error(subject?.rawPhone ? MESSAGES.BAD_PHONE : MESSAGES.NO_PHONE);
    const { pointId } = await ensureContact(tx, actorUserId, { ...ctx, account }, subject, now);
    await lockCanonicalSmsAddress(tx, subject.phone);
    const stopped = await tx.marketingSuppression.findUnique({ where: { channel_address: { channel: "SMS", address: subject.phone } } });
    const point = await tx.contactPoint.findUniqueOrThrow({ where: { id: pointId } });
    if (stopped || point.suppressionState !== "NONE") throw new Error(MESSAGES.STOPPED);
    const latest = await tx.consentRecord.findFirst({ where: { contactPointId: pointId, purpose: "SMS_TRANSACTIONAL" },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] });
    if (latest?.action === "REVOKE") throw new Error("This person opted out of texts themselves. Staff cannot undo that; they would need to agree again on their own.");
    const scope = latest?.scope as { businessNumberId?: unknown } | null;
    if (latest?.action === "GRANT" && scope?.businessNumberId === account.number.id) return { recorded: false };
    await tx.consentRecord.create({ data: {
      kind: "sms_staff_evidence", contactPointId: pointId,
      customerId: input.principal.customerId ?? null, leadId: input.principal.leadId ?? null,
      purpose: "SMS_TRANSACTIONAL", action: "GRANT", source: "STAFF_EVIDENCE", occurredAt: now,
      disclosureVersion: STAFF_TEXT_CONSENT_VERSION, textHash: STAFF_TEXT_CONSENT_HASH,
      details: { method: input.method, recordedByUserId: actorUserId, statement: STAFF_TEXT_CONSENT_STATEMENT },
      scope: { businessNumberId: account.number.id, channel: "SMS", purpose: "SMS_TRANSACTIONAL" },
    } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "COMMUNICATION_CONSENT_RECORDED",
      entityType: input.principal.customerId ? "Customer" : "Lead", entityId: (input.principal.customerId ?? input.principal.leadId)!,
      newValue: { contactPointId: pointId, method: input.method } } });
    return { recorded: true };
  });
}

async function loadSubjectForPrincipal(tx: Db, principal: WorkflowPrincipal): Promise<LoadedSubject | null> {
  if (principal.leadId) return loadWorkflowSubject(tx, "lead_received", principal.leadId, new Date());
  if (principal.customerId) {
    const customer = await tx.customer.findUnique({ where: { id: principal.customerId }, select: { phone: true, user: { select: { name: true } } } });
    if (!customer) return null;
    let phone: string | null = null;
    try { phone = customer.phone?.trim() ? (await import("./suppression")).normalizeSmsAddress(customer.phone) : null; } catch { phone = null; }
    return { principal, displayName: customer.user.name ?? "", rawPhone: customer.phone?.trim() || null, phone, values: {},
      links: [{ entityType: "Customer", entityId: principal.customerId }], stateProblem: null, convertedFromLeadId: null };
  }
  return null;
}

async function ensureThread(
  tx: Db, ctx: SendContext & { account: NonNullable<SendContext["account"]> }, subject: LoadedSubject, pointId: string, now: Date,
): Promise<{ id: string; version: number }> {
  const key = { accountId: ctx.account.id, businessNumberId: ctx.account.number.id, externalContactPointId: pointId };
  const principal = subject.principal;
  const found = await tx.communicationThread.findUnique({ where: { accountId_businessNumberId_externalContactPointId: key } });
  if (!found) {
    const created = await tx.communicationThread.create({ data: { ...key, resolution: "RESOLVED", status: "OPEN",
      customerId: principal.customerId ?? null, leadId: principal.leadId ?? null, lastActivityAt: now } });
    return { id: created.id, version: created.version };
  }
  await tx.$queryRaw`SELECT "id" FROM "CommunicationThread" WHERE "id" = ${found.id} FOR UPDATE`;
  const current = await tx.communicationThread.findUniqueOrThrow({ where: { id: found.id } });
  if (current.resolution === "AMBIGUOUS") throw new Error(MESSAGES.SHARED_NUMBER);
  const samePerson = (principal.customerId && current.customerId === principal.customerId) ||
    (principal.leadId && current.leadId === principal.leadId);
  const movedFromLead = Boolean(principal.customerId && subject.convertedFromLeadId && current.leadId === subject.convertedFromLeadId);
  const unresolved = current.resolution !== "RESOLVED";
  if (!samePerson && !movedFromLead && !unresolved) throw new Error(MESSAGES.SHARED_NUMBER);
  if (samePerson && current.resolution === "RESOLVED" && current.status !== "CLOSED") return { id: current.id, version: current.version };
  const updated = await tx.communicationThread.update({ where: { id: current.id }, data: {
    resolution: "RESOLVED", status: "OPEN", customerId: principal.customerId ?? null, leadId: principal.leadId ?? null,
    version: { increment: 1 } } });
  await tx.auditLog.create({ data: { action: "COMMUNICATION_THREAD_LINKED", entityType: "CommunicationThread", entityId: current.id,
    newValue: { customerId: principal.customerId ?? null, leadId: principal.leadId ?? null } } });
  return { id: updated.id, version: updated.version };
}

/** Tables for the row lock taken just before a text is prepared (fixed list, never built from input). */
const SUBJECT_TABLE: Record<string, string> = {
  Lead: "Lead", Estimate: "Estimate", RentalAgreement: "RentalAgreement", Job: "Job",
  MaintenanceRequest: "MaintenanceRequest", Invoice: "Invoice",
};

export type WorkflowSendInput = {
  family: string; subjectId: string;
  /** One random value per screen load: pressing Send twice on the same screen can never send two texts. */
  clientToken: string;
  /** Hash of the preview the person actually read. */
  expectedTextHash: string;
  /** True only when the person chose "Send again" after a recent identical text. */
  sendAgain?: boolean;
};
export type WorkflowSendResult =
  | { kind: "BLOCKED"; blockers: WorkflowBlocker[] }
  | { kind: "CHANGED"; message: string }
  | { kind: "ACCEPTED" | "NOT_SENT" | "FAILED" | "UNKNOWN"; deliveryId: string; message: string };

const NOT_SENT_REASONS: Record<string, string> = {
  STOP: "They replied STOP, so nothing was sent.",
  CONSENT_CHANGED: "Their permission changed, so nothing was sent.",
  QUIET_HOURS: "It became quiet hours before it could go out, so nothing was sent.",
  FAMILY_OFF: "This kind of text was switched off, so nothing was sent.",
  ENVIRONMENT_FENCE: "This site is not allowed to send real texts, so nothing was sent.",
  PROVIDER_NOT_CONFIGURED: "Texting is not connected on this site, so nothing was sent.",
  SEGMENT_LIMIT: "The text was longer than your limit, so nothing was sent.",
  MASTER_OFF: "Text messages were switched off, so nothing was sent.",
  POLICY_OFF: "Texting was not set up, so nothing was sent.",
  SENDER_NOT_READY: "The business texting number is not ready, so nothing was sent.",
  INVALID_DESTINATION: "That number could not be confirmed as a U.S. number, so nothing was sent.",
  NO_SCOPED_CONSENT: "There is no recorded permission for this number, so nothing was sent.",
  NO_RESOLVED_CONTACT: "The number is not linked to this person, so nothing was sent.",
};

export async function sendWorkflowText(
  actorUserId: string, input: WorkflowSendInput,
  deps: { provider?: TelecomSmsProvider; callbackOrigin?: string; now?: Date } = {},
): Promise<WorkflowSendResult> {
  const family = workflowTextFamily(input.family);
  if (!family || !/^[A-Za-z0-9_-]{8,40}$/.test(input.clientToken) || !input.subjectId) {
    return { kind: "BLOCKED", blockers: [block("NOT_FOUND")] };
  }
  const now = deps.now ?? new Date();

  // Step 1 (read only): rebuild exactly what the person previewed and make sure it is still sendable.
  const preview = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    return buildPreview(tx, family, input.subjectId, now);
  });
  const outstanding = preview.blockers.filter((b) => b.code !== "RECENT_DUPLICATE" || !input.sendAgain);
  if (outstanding.length || !preview.text || !preview.textHash) return { kind: "BLOCKED", blockers: outstanding };
  if (preview.textHash !== input.expectedTextHash) {
    return { kind: "CHANGED", message: "This text changed since you looked at it. Read it again, then send." };
  }

  // Step 2 (live site only, outside any transaction): the free check that the number is a U.S. number.
  let verifiedDestinationCountry: "US" | undefined;
  const snapshot = await prisma.$transaction(async (tx) => {
    const ctx = await loadSendContext(tx);
    const subject = await loadWorkflowSubject(tx, family.key, input.subjectId, now);
    return { ctx, subject };
  });
  const { ctx, subject } = snapshot;
  if (!ctx.policy || !ctx.account || !subject?.phone) return { kind: "BLOCKED", blockers: [block("POLICY_OFF")] };
  const account = ctx.account;
  if (account.environment === "PRODUCTION" && isLiveTelecomDeployment()) {
    const provider = makeTwilioSmsProvider(account.externalAccountId);
    if (provider?.verifyUsDestination && await provider.verifyUsDestination(subject.phone)) verifiedDestinationCountry = "US";
    else return { kind: "BLOCKED", blockers: [block("INVALID_DESTINATION")] };
  }

  // Step 3: confirm the contact and thread, then freeze the message as one prepared intent.
  const prepared = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const { pointId } = await ensureContact(tx, actorUserId, { ...ctx, account }, subject, now);
    return ensureThread(tx, { ...ctx, account }, subject, pointId, now);
  });
  const template = await currentApprovedTemplate(prisma, family);
  const rendered = template ? renderFor(template, subject.values) : null;
  if (!template || !rendered) return { kind: "BLOCKED", blockers: [block("NOT_APPROVED")] };
  const finalHash = hashCommunicationContent(rendered.text);
  if (finalHash !== input.expectedTextHash) {
    return { kind: "CHANGED", message: "This text changed since you looked at it. Read it again, then send." };
  }
  // Inside the preparing transaction: lock the record, and make sure it still fits, the phone is unchanged and the
  // wording is still the same words the person read. Anything else means "changed", and nothing is prepared.
  const guard = async (tx: Db): Promise<boolean> => {
    const table = SUBJECT_TABLE[family.subject];
    if (!table) return false;
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, input.subjectId);
    const current = await loadWorkflowSubject(tx, family.key, input.subjectId, now);
    if (!current || current.stateProblem || current.phone !== subject.phone) return false;
    const live = await currentApprovedTemplate(tx, family);
    if (!live || live.id !== template.id) return false;
    const again = renderFor(live, current.values);
    return Boolean(again) && hashCommunicationContent(again!.text) === input.expectedTextHash;
  };
  const operationKey = `wf-${family.key}-${input.subjectId}-${input.clientToken}`.slice(0, 120);
  const requested = await requestCommunication(actorUserId, {
    threadId: prepared.id, expectedThreadVersion: prepared.version, operationKey,
    templateRevisionId: template.id, variables: rendered.used,
  }, { verifiedDestinationCountry, links: subject.links, now, guard });
  if (requested.kind === "BLOCKED") {
    const reason = requested.reason;
    return { kind: "BLOCKED", blockers: [mapEligibility(reason, ctx, now)] };
  }
  if (requested.kind === "CONFLICT") {
    return { kind: "CHANGED", message: "Something changed while sending. Read the text again, then send." };
  }

  // Step 4: hand to the carrier. This is the only place a provider is ever called, and it re-checks every gate.
  const outcome = await dispatchCommunication(requested.deliveryId, { provider: deps.provider, callbackOrigin: deps.callbackOrigin, now });
  const delivery = await prisma.messageDelivery.findUniqueOrThrow({ where: { id: requested.deliveryId }, select: { state: true, lastError: true } });
  if (outcome.kind === "ACCEPTED") {
    if (subject.principal.leadId) await recordRealContact(subject.principal.leadId, now);
    return { kind: "ACCEPTED", deliveryId: requested.deliveryId, message: "Handed to the phone carrier. Delivery is not confirmed yet; the Communications page shows the final result." };
  }
  if (outcome.kind === "REJECTED") return { kind: "FAILED", deliveryId: requested.deliveryId, message: "The phone carrier refused this text. Nothing was delivered." };
  if (outcome.kind === "UNKNOWN") return { kind: "UNKNOWN", deliveryId: requested.deliveryId, message: "We could not tell whether this text went out. Do not send it again until you check Communications." };
  if (outcome.kind === "ALREADY_CLAIMED") return { kind: "NOT_SENT", deliveryId: requested.deliveryId, message: "This text was already handled. Nothing new was sent." };
  const reason = delivery.lastError ?? "";
  return { kind: "NOT_SENT", deliveryId: requested.deliveryId, message: NOT_SENT_REASONS[reason] ?? "It was not sent." };
}

/** Recent texts about a record, for the "Texts about this" list on its screen. */
export async function getWorkflowTextHistory(
  actorUserId: string, entityType: "Lead" | "Estimate" | "RentalAgreement" | "Job" | "MaintenanceRequest" | "Invoice" | "Customer",
  entityId: string,
): Promise<{ at: Date; label: string; state: string; threadId: string }[]> {
  await prisma.$transaction((tx) => assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]));
  const rows = await prisma.communicationLink.findMany({
    where: { entityType, entityId, message: { delivery: { isNot: null } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10,
    select: { message: { select: { threadId: true, delivery: { select: { state: true, requestedAt: true, templateKey: true } } } } },
  });
  return rows.flatMap((row) => row.message.delivery ? [{
    at: row.message.delivery.requestedAt, state: row.message.delivery.state, threadId: row.message.threadId,
    label: workflowTextFamily(row.message.delivery.templateKey)?.label ?? "Text message",
  }] : []);
}
