import { afterEach, describe, expect, it } from "vitest";
import {
  communicationsPolicySchema, evaluateSmsEligibility, type SmsEligibilityInput,
} from "@/domains/messaging/communications-policy";
import {
  encryptCommunicationContent, decryptCommunicationContent, hashCommunicationContent,
} from "@/domains/messaging/communications-content";

const keyBefore = process.env.COMMUNICATION_CONTENT_KEY;
afterEach(() => {
  if (keyBefore === undefined) delete process.env.COMMUNICATION_CONTENT_KEY;
  else process.env.COMMUNICATION_CONTENT_KEY = keyBefore;
});

function allowedFixture(): SmsEligibilityInput {
  const now = new Date("2026-10-09T14:00:00.000Z");
  return {
    enabled: true,
    policyValue: { schemaVersion: 1, manualSmsEnabled: true, primaryAccountId: "acct",
      primaryNumberId: "number", approvedPolicyVersion: 1, maxSegments: 3,
      supportedCountries: ["US"] },
    policyVersion: 1,
    account: { id: "acct", environment: "TEST", status: "READY" },
    number: { id: "number", accountId: "acct", registrationStatus: "APPROVED",
      verifiedAt: now, retiredAt: null, capabilities: { sms: true } },
    thread: { accountId: "acct", businessNumberId: "number", status: "OPEN",
      resolution: "RESOLVED", customerId: "customer", leadId: null },
    point: { id: "point", environment: "TEST", suppressionState: "NONE",
      address: "+13035551010" },
    purpose: "CONVERSATIONAL",
    now,
    consents: [{ id: "grant", contactPointId: "point", purpose: "SMS_CONVERSATIONAL",
      action: "GRANT", source: "SIGNED_DISCLOSURE", occurredAt: now,
      disclosureVersion: "v1", textHash: "sha256:test",
      scope: { businessNumberId: "number" }, createdAt: now }],
  };
}

describe("COM-L4A default-off eligibility and immutable content", () => {
  it("requires the standalone master flag and strict versioned JSON", () => {
    const value = allowedFixture();
    expect(evaluateSmsEligibility({ ...value, enabled: false })).toMatchObject({
      allowed: false, reason: "MASTER_OFF",
    });
    expect(evaluateSmsEligibility({ ...value, policyValue: {} })).toMatchObject({
      allowed: false, reason: "POLICY_OFF",
    });
    expect(evaluateSmsEligibility({ ...value, policyVersion: 2 })).toMatchObject({
      allowed: false, reason: "POLICY_OFF",
    });
    expect(communicationsPolicySchema.safeParse({ ...(value.policyValue as object),
      customerSmsEnabled: true }).success).toBe(false);
  });

  it("requires one resolved subject and verified account and destination", () => {
    const base = allowedFixture();
    expect(evaluateSmsEligibility(base)).toMatchObject({ allowed: true, consentRecordId: "grant" });
    expect(evaluateSmsEligibility({ ...base, thread: { ...base.thread,
      customerId: null } })).toMatchObject({ allowed: false, reason: "NO_RESOLVED_CONTACT" });
    expect(evaluateSmsEligibility({ ...base, number: { ...base.number,
      verifiedAt: null } })).toMatchObject({ allowed: false, reason: "SENDER_NOT_READY" });
    expect(evaluateSmsEligibility({ ...base, point: { ...base.point,
      suppressionState: "OPTED_OUT" } })).toMatchObject({ allowed: false, reason: "SUPPRESSED" });
    expect(evaluateSmsEligibility({ ...base, account: { ...base.account,
      environment: "PRODUCTION" }, point: { ...base.point,
      environment: "PRODUCTION" } })).toMatchObject({ allowed: false, reason: "INVALID_DESTINATION" });
  });

  it("does not infer broad consent from HELP/START, stale grants or another sender", () => {
    const base = allowedFixture();
    expect(evaluateSmsEligibility({ ...base, consents: [{
      ...base.consents[0]!, action: "HELP",
    }] })).toMatchObject({ allowed: false, reason: "NO_SCOPED_CONSENT" });
    expect(evaluateSmsEligibility({ ...base, consents: [{
      ...base.consents[0]!, scope: { businessNumberId: "someone-else" },
    }] })).toMatchObject({ allowed: false, reason: "NO_SCOPED_CONSENT" });
    expect(evaluateSmsEligibility({ ...base, consents: [{
      ...base.consents[0]!, purpose: "SMS_MARKETING",
    }] })).toMatchObject({ allowed: false, reason: "NO_SCOPED_CONSENT" });
    expect(evaluateSmsEligibility({ ...base, consents: [{
      ...base.consents[0]!, source: "PROVIDER_KEYWORD",
    }] })).toMatchObject({ allowed: false, reason: "NO_SCOPED_CONSENT" });
    const grant = base.consents[0]!;
    expect(evaluateSmsEligibility({ ...base, consents: [grant, {
      ...grant, id: "revoke", action: "REVOKE",
      occurredAt: new Date(grant.occurredAt!.getTime() + 1000),
    }], now: new Date(base.now.getTime() + 2000) })).toMatchObject({
      allowed: false, reason: "NO_SCOPED_CONSENT",
    });
  });

  it("seals content with authenticated encryption and uses a keyed digest", () => {
    delete process.env.COMMUNICATION_CONTENT_KEY;
    expect(() => encryptCommunicationContent("private")).toThrow();
    process.env.COMMUNICATION_CONTENT_KEY = Buffer.alloc(32, 7).toString("base64");
    const first = encryptCommunicationContent("private customer text");
    const second = encryptCommunicationContent("private customer text");
    expect(first).not.toBe(second);
    expect(first).not.toContain("customer");
    expect(decryptCommunicationContent(first)).toBe("private customer text");
    expect(hashCommunicationContent("private customer text")).toHaveLength(64);
    expect(() => decryptCommunicationContent(first.slice(0, -2) + "xq")).toThrow();
  });
});
