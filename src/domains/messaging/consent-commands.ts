import { prisma } from "@/lib/prisma";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { normalizeSmsAddress } from "./suppression";

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const PURPOSES = ["SMS_TRANSACTIONAL", "SMS_MARKETING", "SMS_CONVERSATIONAL"] as const;
export type SmsKeyword = "STOP" | "START" | "HELP";

export function classifyProviderKeyword(text: string, optOutType?: string | null): SmsKeyword | null {
  // Twilio Advanced Opt-Out's type is authoritative; do not reinterpret
  // a free-text keyword as the opposite of a provider-confirmed action.
  if (optOutType) return ["STOP", "START", "HELP"].includes(optOutType) ? optOutType as SmsKeyword : null;
  const keyword = text.trim().toUpperCase();
  if (STOP.has(keyword)) return "STOP";
  if (keyword === "START" || keyword === "UNSTOP") return "START";
  if (keyword === "HELP") return "HELP";
  return null;
}

/**
 * Verified webhook only: provider STOP applies to the destination address even
 * when nobody can identify its owner. START acknowledges carrier re-enable but
 * NEVER creates business consent. One event claim + canonical address lock keep
 * duplicated messages from writing conflicting consent evidence.
 */
export async function projectVerifiedSmsKeyword(input: {
  accountSid: string;
  businessNumberId: string;
  messageSid: string;
  from: string;
  text: string;
  optOutType?: string | null;
}): Promise<{ keyword: SmsKeyword | null; duplicate: boolean }> {
  const keyword = classifyProviderKeyword(input.text, input.optOutType);
  if (!keyword) return { keyword: null, duplicate: false };
  if (!/^AC[0-9a-fA-F]{32}$/.test(input.accountSid) ||
      !/^(SM|MM)[0-9a-fA-F]{32}$/.test(input.messageSid)) throw new Error("Invalid verified provider evidence.");
  const address = normalizeSmsAddress(input.from);
  return prisma.$transaction(async (tx) => {
    const sender = await tx.businessPhoneNumber.findFirst({
      where: { id: input.businessNumberId, account: { externalAccountId: input.accountSid,
        environment: "PRODUCTION", provider: "twilio" },
        retiredAt: null, registrationStatus: "APPROVED", verifiedAt: { not: null } },
      select: { id: true, accountId: true },
    });
    if (!sender) throw new Error("Verified provider sender not available.");
    await lockCanonicalSmsAddress(tx, address);
    const claim = await tx.providerEvent.createMany({
      data: [{ provider: "twilio", eventId: "consent:" + input.messageSid,
        type: "sms.consent." + keyword.toLowerCase(), telecomAccountId: sender.accountId,
        environment: "PRODUCTION", disposition: "APPLIED", processedAt: new Date(),
        summary: { kind: keyword, businessNumberId: sender.id } }],
      skipDuplicates: true,
    });
    if (claim.count === 0) return { keyword, duplicate: true };
    const point = await tx.contactPoint.upsert({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address,
      } },
      create: { environment: "PRODUCTION", channel: "SMS", address },
      update: {},
    });
    const occurredAt = new Date();
    if (keyword === "STOP") {
      // Legacy STOP already persisted the global suppression; the point's
      // scoped evidence makes every purpose ineligible even after START.
      await tx.contactPoint.update({ where: { id: point.id },
        data: { suppressionState: "OPTED_OUT", stoppedAt: occurredAt,
          suppressionVersion: { increment: 1 } } });
    } else if (keyword === "START" && input.optOutType === "START") {
      // Only a provider-confirmed START may clear a provider-created STOP.
      // Do NOT clear a portal or staff opt-out, and do NOT issue a GRANT.
      const cleared = await tx.marketingSuppression.deleteMany({
        where: { channel: "SMS", address, reason: "stop",
          source: { startsWith: "twilio_stop:" } },
      });
      if (cleared.count) {
        await tx.contactPoint.update({ where: { id: point.id },
          data: { suppressionState: "NONE", suppressionVersion: { increment: 1 } } });
      }
    }
    await tx.consentRecord.createMany({
      data: (keyword === "STOP" ? PURPOSES : [null]).map((purpose) => ({
        kind: "sms_provider_keyword",
        contactPointId: point.id,
        purpose,
        action: keyword === "STOP" ? "REVOKE" as const :
          keyword === "START" ? "PROVIDER_REENABLE" as const : "HELP" as const,
        source: "PROVIDER_KEYWORD" as const, occurredAt,
        scope: { businessNumberId: sender.id, providerEventId: input.messageSid },
      })),
    });
    return { keyword, duplicate: false };
  });
}
