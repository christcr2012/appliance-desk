import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
import { termsPolicyUpdate } from "@/domains/settings/terms-policy";
import { getEarlyTerminationQuote, setAutoRenew } from "@/domains/agreements/term";

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

  it("no quote until the owner has entered the policy; then the quote uses exactly their numbers", async () => {
    await save({});
    expect(await getEarlyTerminationQuote(agreementId, requestedOn)).toBeNull();

    await save({ feeDollars: "50", feePercent: "10", noticeDays: "30", unusedTerm: "CREDIT" });
    const first = (await getEarlyTerminationQuote(agreementId, requestedOn))!;
    expect(first.feeCents).toBe(7200); // 10% of 12 x $60 beats the $50 flat fee
    expect(first.unusedTermTreatment).toBe("CREDIT");
    expect(first.effectiveOn.toISOString()).toBe("2026-11-08T07:00:00.000Z");

    // The owner changes their mind in settings: the very next quote follows.
    await save({ feeDollars: "50", feePercent: "10", feeCapDollars: "60", noticeDays: "45", unusedTerm: "RETAIN" });
    const second = (await getEarlyTerminationQuote(agreementId, requestedOn))!;
    expect(second.feeCents).toBe(6000); // capped at $60
    expect(second.unusedTermTreatment).toBe("RETAIN");
    expect(second.effectiveOn.toISOString()).toBe("2026-12-08T07:00:00.000Z"); // longer notice
    expect(second.policyVersion).not.toBe(first.policyVersion);
  });

  it("the owner can switch the rule back off by clearing the boxes", async () => {
    await save({ feeDollars: "50", noticeDays: "30", unusedTerm: "CREDIT" });
    expect(await getEarlyTerminationQuote(agreementId, requestedOn)).not.toBeNull();
    await save({});
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

  it("auto-renew follows the saved wording: consent works for the current terms and not for older ones", async () => {
    await save({ autoRenewNoticeDays: "30", renewalTermsText: "We renew monthly." });
    const v1 = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).autoRenewTermsVersion!;
    expect(v1).toMatch(/^ar-/);

    await setAutoRenew(ownerId, agreementId, { enabled: true, termsVersion: v1 });
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).autoRenewTermsVersion).toBe(v1);

    // Same wording saved again: same version, nothing the customer agreed to goes stale.
    await save({ autoRenewNoticeDays: "30", renewalTermsText: "We renew monthly." });
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).autoRenewTermsVersion).toBe(v1);

    // New wording: a new version, so the old one can no longer be used to record consent.
    await save({ autoRenewNoticeDays: "30", renewalTermsText: "We renew yearly." });
    const v2 = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).autoRenewTermsVersion!;
    expect(v2).not.toBe(v1);
    await expect(setAutoRenew(ownerId, agreementId, { enabled: true, termsVersion: v1 })).rejects.toThrow(/out of date/);
    // The customer who already agreed keeps the wording they agreed to.
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).autoRenewTermsVersion).toBe(v1);
  });
});
