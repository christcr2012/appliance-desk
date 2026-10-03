import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
import { termsPolicyUpdate } from "@/domains/settings/terms-policy";
import { getEarlyTerminationQuote, setAutoRenew, type TermActor } from "@/domains/agreements/term";
import { buildTermsSnapshot } from "@/domains/agreements/terms-snapshot";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const POLICY_KEYS = [
  "earlyTerminationFeeCents",
  "earlyTerminationFeePercent",
  "earlyTerminationFeeCapCents",
  "earlyTerminationNoticeDays",
  "unusedTermTreatment",
  "terminationTermsText",
  "autoRenewNoticeDays",
  "autoRenewTermsVersion",
  "renewalTermsText",
] as const;

const blank = {
  feeDollars: "",
  feePercent: "",
  feeCapDollars: "",
  noticeDays: "",
  unusedTerm: "",
  terminationTermsText: "",
  autoRenewNoticeDays: "",
  renewalTermsText: "",
};

describe.skipIf(!enabled)("owner-entered policy drives the quote (nothing fixed in code)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `policy-owner-${tag}`;
  const customerUserId = `policy-cust-user-${tag}`;
  const customerId = `policy-customer-${tag}`;
  const addressId = `policy-address-${tag}`;
  const agreementId = `policy-agreement-${tag}`;
  let original: Record<string, unknown> = {};
  const requestedOn = new Date("2026-10-03T12:00:00Z");

  const owner: TermActor = { userId: ownerId, kind: "team" };

  /** What sending an agreement for signing does: freeze whatever the settings say right now. */
  async function lockFromSettings() {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { termsSnapshot: JSON.parse(JSON.stringify(buildTermsSnapshot(settings, null, new Date()))) },
    });
  }

  async function save(form: Record<string, string>) {
    const parsed = termsPolicyUpdate({ ...blank, ...form });
    if (!parsed.success) throw new Error(parsed.message);
    await updateBusinessSettings(ownerId, parsed.update);
  }

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    original = Object.fromEntries(POLICY_KEYS.map((key) => [key, (settings as Record<string, unknown>)[key]]));
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "Policy Owner", role: "OWNER", emailVerified: true },
        { id: customerUserId, email: `${tag}-cust@example.test`, name: "Policy Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: `P${tag.slice(0, 18)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 12,
        endDate: new Date("2027-11-08T06:59:59Z"),
        nextBillingDate: new Date("2026-11-08T19:00:00Z"),
        lines: { create: [{ label: "Washer", monthlyPriceCents: 6000, listPriceCents: 6000 }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: original });
    await prisma.consentRecord.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: agreementId }, { userId: ownerId }] } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("no quote until the owner has entered the policy; then an agreement locks exactly their numbers", async () => {
    await save({});
    await lockFromSettings();
    expect(await getEarlyTerminationQuote(agreementId, requestedOn)).toBeNull();

    await save({ feeDollars: "50", feePercent: "10", noticeDays: "30", unusedTerm: "CREDIT", terminationTermsText: "Pay the fee." });
    await lockFromSettings();
    const first = (await getEarlyTerminationQuote(agreementId, requestedOn))!;
    expect(first.feeCents).toBe(7200); // 10% of 12 x $60 beats the $50 flat fee
    expect(first.unusedTermTreatment).toBe("CREDIT");
    expect(first.effectiveOn.toISOString()).toBe("2026-11-08T07:00:00.000Z");

    // The owner changes the terms: an agreement already locked does not move...
    await save({ feeDollars: "50", feePercent: "10", feeCapDollars: "60", noticeDays: "45", unusedTerm: "RETAIN", terminationTermsText: "Pay the fee, capped." });
    const unchanged = (await getEarlyTerminationQuote(agreementId, requestedOn))!;
    expect(unchanged.feeCents).toBe(7200);
    expect(unchanged.policyVersion).toBe(first.policyVersion);

    // ...and the next agreement to be signed gets the new terms.
    await lockFromSettings();
    const second = (await getEarlyTerminationQuote(agreementId, requestedOn))!;
    expect(second.feeCents).toBe(6000); // capped at $60
    expect(second.unusedTermTreatment).toBe("RETAIN");
    expect(second.effectiveOn.toISOString()).toBe("2026-12-08T07:00:00.000Z"); // longer notice
    expect(second.policyVersion).not.toBe(first.policyVersion);
  });

  it("the owner can switch the rule back off by clearing the boxes (for agreements signed afterwards)", async () => {
    await save({ feeDollars: "50", noticeDays: "30", unusedTerm: "CREDIT", terminationTermsText: "Pay the fee." });
    await lockFromSettings();
    expect(await getEarlyTerminationQuote(agreementId, requestedOn)).not.toBeNull();
    await save({});
    await lockFromSettings();
    expect(await getEarlyTerminationQuote(agreementId, requestedOn)).toBeNull();
  });

  it("every change is written to the change history with who made it", async () => {
    await save({ feeDollars: "12", noticeDays: "7", unusedTerm: "REFUND" });
    const latest = await prisma.auditLog.findFirst({
      where: { userId: ownerId, action: "settings.update" },
      orderBy: { createdAt: "desc" },
    });
    expect((latest?.newValue as { earlyTerminationFeeCents?: number }).earlyTerminationFeeCents).toBe(1200);
    expect((latest?.oldValue as { earlyTerminationFeeCents?: number | null }).earlyTerminationFeeCents).toBeNull();
  });

  it("auto-renew: the version follows the wording, and an agreement keeps the wording it was signed with", async () => {
    await save({ autoRenewNoticeDays: "30", renewalTermsText: "We renew monthly." });
    const v1 = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).autoRenewTermsVersion!;
    expect(v1).toMatch(/^ar-/);
    await lockFromSettings();

    await setAutoRenew(owner, agreementId, { enabled: true, termsVersion: v1 });
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).autoRenewTermsVersion).toBe(v1);

    // Same wording saved again: same version.
    await save({ autoRenewNoticeDays: "30", renewalTermsText: "We renew monthly." });
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).autoRenewTermsVersion).toBe(v1);

    // New wording: a new version for new agreements. This agreement is locked to v1, so v1 is still its version.
    await save({ autoRenewNoticeDays: "30", renewalTermsText: "We renew yearly." });
    const v2 = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).autoRenewTermsVersion!;
    expect(v2).not.toBe(v1);
    await expect(setAutoRenew(owner, agreementId, { enabled: true, termsVersion: v2 })).rejects.toThrow(/out of date/);
    await setAutoRenew(owner, agreementId, { enabled: true, termsVersion: v1 });
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).autoRenewTermsVersion).toBe(v1);
  });
});
