import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { communicationsPolicySchema } from "./communications-policy";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { normalizeSmsAddress } from "./suppression";

/**
 * The portal checkbox is a transactional notification choice ONLY. Any copy
 * change requires a new disclosure version, ensuring an audit can recover the
 * exact words a customer chose. It never authorizes marketing.
 */
import { PORTAL_SMS_DISCLOSURE, PORTAL_SMS_DISCLOSURE_VERSION } from "./portal-disclosure";
export const PORTAL_SMS_DISCLOSURE_HASH =
  createHash("sha256").update(PORTAL_SMS_DISCLOSURE, "utf8").digest("hex");

const ALL = ["SMS_TRANSACTIONAL", "SMS_MARKETING", "SMS_CONVERSATIONAL"] as const;

/** Caller must have verified the portal session and resolved its own Customer. */
export async function recordPortalSmsChoice(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    priorPhone: string | null;
    nextPhone: string | null;
    optedIn: boolean;
    at: Date;
  },
): Promise<void> {
  const current = input.nextPhone ? normalizeSmsAddress(input.nextPhone) : null;
  let prior: string | null = null;
  try { prior = input.priorPhone ? normalizeSmsAddress(input.priorPhone) : null; }
  catch { /* a historic unrecognized number has no canonical SMS consent */ }
  const addresses = [...new Set([prior, current].filter((s): s is string => Boolean(s)))].sort();
  if (!addresses.length) return;

  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { communicationsPolicy: true, communicationsPolicyVersion: true },
  });
  const parsed = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
  const senderId = parsed.success &&
    parsed.data.approvedPolicyVersion === settings?.communicationsPolicyVersion
    ? parsed.data.primaryNumberId : null;

  for (const address of addresses) {
    await lockCanonicalSmsAddress(tx, address);
    const point = await tx.contactPoint.upsert({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address,
      } },
      create: { environment: "PRODUCTION", channel: "SMS", address },
      update: {},
    });
    // A phone-number edit revokes the former address instead of transferring
    // consent to a new, unverified destination. Never auto-verify a binding.
    if (prior && prior !== current && address === prior) {
      await tx.contactBinding.updateMany({
        where: { contactPointId: point.id, customerId: input.customerId, revokedAt: null },
        data: { revokedAt: input.at },
      });
    }
    const grant = input.optedIn && current === address;
    // A signed-in customer may type anybody's phone number. Consent is not
    // effective for sending until one verified active contact binding proves
    // that this particular customer controls the destination. Otherwise a
    // customer could inadvertently authorize messages to someone else.
    const bindings = grant ? await tx.contactBinding.findMany({
      where: { contactPointId: point.id, revokedAt: null, verifiedAt: { not: null } },
      select: { customerId: true, leadId: true,
        customerContact: { select: { customerId: true } } },
      take: 2,
    }) : [];
    const verifiedOwner = bindings.length === 1 && !bindings[0].leadId &&
      (bindings[0].customerId === input.customerId ||
       bindings[0].customerContact?.customerId === input.customerId);
    const eligibleSenderId = verifiedOwner ? senderId : null;
    await tx.consentRecord.createMany({
      data: (grant ? ["SMS_TRANSACTIONAL"] as const : ALL).map((purpose) => ({
        customerId: input.customerId,
        contactPointId: point.id,
        kind: "sms_portal_preference",
        action: grant ? "GRANT" as const : "REVOKE" as const,
        purpose, source: "PORTAL" as const, occurredAt: input.at,
        disclosureVersion: grant ? PORTAL_SMS_DISCLOSURE_VERSION : null,
        textHash: grant ? PORTAL_SMS_DISCLOSURE_HASH : null,
        details: { disclosure: grant ? PORTAL_SMS_DISCLOSURE : null,
          choice: grant ? "transactional_only" : "opted_out" },
        scope: { businessNumberId: grant ? eligibleSenderId : senderId,
          channel: "SMS", purpose },
      })),
    });
  }
}
