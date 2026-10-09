import { z } from "zod";
import { voiceRoutingSchema } from "./voice-routing";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * The outer customerSmsEnabled flag is intentionally NOT part of this policy.
 * Absent or unrecognized policy means every telecom capability is disabled.
 */
export const communicationsPolicySchema = z.object({
  schemaVersion: z.literal(1),
  manualSmsEnabled: z.boolean(),
  primaryAccountId: z.string().min(1),
  primaryNumberId: z.string().min(1),
  approvedPolicyVersion: z.number().int().positive(),
  maxSegments: z.number().int().min(1).max(10),
  supportedCountries: z.array(z.literal("US")).min(1).max(1),
  inboundSmsEnabled: z.boolean().optional(),
  voiceRoutingEnabled: z.boolean().optional(),
  voiceRouting: voiceRoutingSchema.optional(),
  productionWebhookOrigin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash && !url.hostname.includes("_");
  }).optional(),
}).strict();
export type CommunicationsPolicy = z.infer<typeof communicationsPolicySchema>;

export type CommunicationConsentEvidence = {
  id: string;
  contactPointId: string | null;
  purpose: "SMS_TRANSACTIONAL" | "SMS_MARKETING" | "SMS_CONVERSATIONAL" | null;
  action: "GRANT" | "REVOKE" | "PROVIDER_REENABLE" | "HELP" | null;
  source: string | null;
  occurredAt: Date | null;
  disclosureVersion: string | null;
  textHash: string | null;
  scope: unknown;
  createdAt: Date;
};

export type SmsEligibilityInput = {
  enabled: boolean;
  policyValue: unknown;
  policyVersion: number;
  account: { id: string; environment: "PRODUCTION" | "TEST"; status: string };
  number: {
    id: string; accountId: string; registrationStatus: string;
    verifiedAt: Date | null; retiredAt: Date | null;
    capabilities: unknown;
  };
  thread: { resolution: string; status: string; accountId: string; businessNumberId: string; customerId?: string | null; leadId?: string | null };
  point: { id: string; environment: "PRODUCTION" | "TEST"; suppressionState: string; address: string };
  purpose: "TRANSACTIONAL" | "MARKETING" | "CONVERSATIONAL";
  verifiedDestinationCountry?: "US";
  consents: CommunicationConsentEvidence[];
  now: Date;
};

export type SmsEligibility =
  | { allowed: true; policy: CommunicationsPolicy; consentRecordId: string }
  | { allowed: false; reason:
    "MASTER_OFF" | "POLICY_OFF" | "SENDER_NOT_READY" | "NO_RESOLVED_CONTACT" |
    "SUPPRESSED" | "NO_SCOPED_CONSENT" | "INVALID_DESTINATION" };

function validUsPhone(value: string): boolean {
  // NANP numbers also exist in non-US territories. The provider's validated
  // country lookup is a separate activation gate in COM-L4B.
  return /^\+1[2-9][0-9]{9}$/.test(value);
}

export function evaluateSmsEligibility(input: SmsEligibilityInput): SmsEligibility {
  if (!input.enabled) return { allowed: false, reason: "MASTER_OFF" };
  const parsed = communicationsPolicySchema.safeParse(input.policyValue);
  if (!parsed.success || input.policyVersion <= 0 ||
      parsed.data.approvedPolicyVersion !== input.policyVersion ||
      !parsed.data.manualSmsEnabled) return { allowed: false, reason: "POLICY_OFF" };
  const policy = parsed.data;
  if (policy.primaryAccountId !== input.account.id ||
      policy.primaryNumberId !== input.number.id ||
      input.thread.accountId !== input.account.id ||
      input.thread.businessNumberId !== input.number.id ||
      input.account.environment !== input.point.environment ||
      input.number.accountId !== input.account.id ||
      input.account.status !== "READY" ||
      input.number.registrationStatus !== "APPROVED" ||
      !input.number.verifiedAt || input.number.retiredAt ||
      (input.number.capabilities as { sms?: unknown } | null)?.sms !== true) {
    return { allowed: false, reason: "SENDER_NOT_READY" };
  }
  if (input.point.suppressionState !== "NONE") return { allowed: false, reason: "SUPPRESSED" };
  if (input.thread.resolution !== "RESOLVED" || input.thread.status === "CLOSED" ||
      Number(Boolean(input.thread.customerId)) + Number(Boolean(input.thread.leadId)) !== 1) {
    return { allowed: false, reason: "NO_RESOLVED_CONTACT" };
  }
  if (!validUsPhone(input.point.address) || (input.account.environment === "PRODUCTION" && input.verifiedDestinationCountry !== "US")) return { allowed: false, reason: "INVALID_DESTINATION" };
  const purpose = ("SMS_" + input.purpose) as CommunicationConsentEvidence["purpose"];
  // A grant belongs to one exact business sender and phone, not an account,
  // person or global "opted in" flag. Even a verified START is not marketing consent.
  const evidence = input.consents
    .filter((row) => row.contactPointId === input.point.id &&
      row.purpose === purpose && row.occurredAt !== null &&
      row.occurredAt.getTime() <= input.now.getTime())
    .sort((a, b) =>
      b.occurredAt!.getTime() - a.occurredAt!.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id.localeCompare(a.id));
  const latest = evidence[0];
  if (!latest || latest.action !== "GRANT" || !latest.disclosureVersion || !latest.textHash ||
      !(["SIGNED_DISCLOSURE", "PORTAL", "WEB_FORM", "STAFF_EVIDENCE"].includes(latest.source ?? "")) ||
      !latest.scope || typeof latest.scope !== "object" ||
      Array.isArray(latest.scope) ||
      (latest.scope as Record<string, unknown>).businessNumberId !== input.number.id) {
    return { allowed: false, reason: "NO_SCOPED_CONSENT" };
  }
  return { allowed: true, policy, consentRecordId: latest.id };
}

/** Owner policy update. The separate SMS master gate stays unchanged. */
export async function saveCommunicationsPolicy(
  ownerUserId: string,
  nextPolicy: CommunicationsPolicy,
  expectedVersion: number,
): Promise<{ version: number }> {
  const policy = communicationsPolicySchema.parse(nextPolicy);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
      policy.approvedPolicyVersion !== expectedVersion + 1) {
    throw new Error("Communication policy version conflict.");
  }
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const current = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { communicationsPolicyVersion: true },
    });
    if (current.communicationsPolicyVersion !== expectedVersion) {
      throw new Error("Communication policy changed. Refresh before saving.");
    }
    const version = expectedVersion + 1;
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: { communicationsPolicy: policy, communicationsPolicyVersion: version },
    });
    await tx.auditLog.create({ data: {
      userId: ownerUserId, action: "COMMUNICATION_POLICY_UPDATED",
      entityType: "BusinessSettings", entityId: "singleton",
      newValue: { schemaVersion: policy.schemaVersion, version, manualSmsEnabled: policy.manualSmsEnabled },
    } });
    return { version };
  });
}
