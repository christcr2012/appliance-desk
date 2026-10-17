import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { getSetupChecklist, type SetupEnv } from "@/domains/setup/checklist";
import { getTaxWorkspaceOverview } from "@/domains/tax/workspace-overview";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

const TEST_ENV: SetupEnv = {
  STRIPE_SECRET_KEY: ["sk_test_","NotARealKeyOnlyForTests123"].join(""),
  STRIPE_WEBHOOK_SECRET: ["whsec_","NotARealSecretOnlyForTests789"].join(""),
  RESEND_API_KEY: ["re_","NotARealKeyOnlyForTests000"].join(""),
  RESEND_FROM_EMAIL: "Robinson <hello@robinson.example.test>",
};

describe.skipIf(!enabled)("W-7 first-time setup checklist on real PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 20);
  const ownerId = "w7-o-" + tag, adminId = "w7-a-" + tag, staffId = "w7-s-" + tag;
  const customerUserId = "w7-c-" + tag, archivedOwnerId = "w7-x-" + tag;
  const jurisdictionIds: string[] = [], accountIds: string[] = [], locationIds: string[] = [];
  const typeIds: string[] = [], packageIds: string[] = [];
  let old: {
    settings: Record<string, unknown>;
    types: string[]; packages: string[]; accounts: string[]; locations: string[];
  };

  const steps = async (env: SetupEnv = TEST_ENV) => {
    const result = await getSetupChecklist(ownerId, env);
    return { result, byKey: Object.fromEntries(result.steps.map(step => [step.key, step])) };
  };
  const overviewTaxDone = async () => {
    const overview = await getTaxWorkspaceOverview(ownerId);
    const setup = Object.fromEntries(overview.setup.map(step => [step.key, step.complete]));
    return Boolean(setup.accounts && setup["use-accounts"] && setup.periods);
  };
  const saveSettings = (data: Record<string, unknown>) =>
    prisma.businessSettings.update({ where: { id: "singleton" }, data });

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: {
        publicBusinessName: true, publicPhone: true, publicEmail: true, publicAddress: true,
        serviceAreaCities: true, serviceAreaZips: true, customerEmailEnabled: true,
      },
    });
    old = {
      settings,
      types: (await prisma.applianceType.findMany({ where: { isActive: true }, select: { id: true } })).map(x => x.id),
      packages: (await prisma.rentalPackage.findMany({ where: { isActive: true }, select: { id: true } })).map(x => x.id),
      accounts: (await prisma.taxFilingAccount.findMany({ where: { active: true }, select: { id: true } })).map(x => x.id),
      locations: (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map(x => x.id),
    };
    // Start from a blank business so every step's before/after is exact. Restored in afterAll.
    await prisma.applianceType.updateMany({ where: { id: { in: old.types } }, data: { isActive: false } });
    await prisma.rentalPackage.updateMany({ where: { id: { in: old.packages } }, data: { isActive: false } });
    await prisma.taxFilingAccount.updateMany({ where: { id: { in: old.accounts } }, data: { active: false } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: old.locations } }, data: { isCurrent: false } });
    await saveSettings({
      publicBusinessName: "[Company Name]", publicPhone: "[Phone Number]", publicEmail: "[Email Address]",
      publicAddress: "[Business Address]", serviceAreaCities: [], serviceAreaZips: [], customerEmailEnabled: false,
    });
    await prisma.user.createMany({ data: [
      { id: ownerId, email: tag + "-o@example.test", name: "W7 Owner", role: "OWNER", emailVerified: true },
      { id: adminId, email: tag + "-a@example.test", name: "W7 Admin", role: "ADMIN", emailVerified: true },
      { id: staffId, email: tag + "-s@example.test", name: "W7 Staff", role: "STAFF", emailVerified: true },
      { id: customerUserId, email: tag + "-c@example.test", name: "W7 Customer", role: "CUSTOMER", emailVerified: true },
      { id: archivedOwnerId, email: tag + "-x@example.test", name: "W7 Old Owner", role: "OWNER", emailVerified: true, archivedAt: new Date() },
    ] });
  });

  afterAll(async () => {
    await prisma.addressTaxLocation.deleteMany({ where: { id: { in: locationIds } } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: { in: jurisdictionIds } } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.rentalPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: typeIds } } });
    await prisma.taxFilingAccount.updateMany({ where: { id: { in: old.accounts } }, data: { active: true } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: old.locations } }, data: { isCurrent: true } });
    await prisma.rentalPackage.updateMany({ where: { id: { in: old.packages } }, data: { isActive: true } });
    await prisma.applianceType.updateMany({ where: { id: { in: old.types } }, data: { isActive: true } });
    await saveSettings(old.settings);
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId, customerUserId, archivedOwnerId] } } });
  });

  it("is refused for everyone except an active owner, at the read itself", async () => {
    for (const who of [adminId, staffId, customerUserId, archivedOwnerId, "no-such-user-" + tag]) {
      await expect(getSetupChecklist(who, TEST_ENV), who).rejects.toThrow("Only the owner can see the setup checklist.");
    }
    await expect(getSetupChecklist(ownerId, TEST_ENV)).resolves.toMatchObject({ total: 6 });
  });

  it("starts with every step not done on a blank business, in the required order", async () => {
    const { result, byKey } = await steps({});
    expect(result.steps.map(step => step.key)).toEqual(["business", "service-area", "prices", "tax", "payments", "email"]);
    expect(result).toMatchObject({ doneCount: 0, total: 6, complete: false });
    expect(byKey.business.detail).toBe("Add your business name, phone number, email address and business address.");
    expect(byKey["service-area"].detail).toBe("Add the cities or ZIP codes you serve.");
    expect(byKey.prices.detail).toBe("Set a monthly price for at least one appliance or set.");
    expect(byKey.tax.detail).toBe("Add your Colorado sales tax account. 2 more after that.");
    expect(byKey.payments.detail).toContain("Payments aren't connected yet");
    expect(byKey.email.detail).toContain("email service isn't connected");
  });

  it("business details become done only when all four real details are saved", async () => {
    await saveSettings({ publicBusinessName: "Robinson Appliance Rentals", publicPhone: "(970) 555-0100" });
    expect((await steps()).byKey.business).toMatchObject({ done: false, detail: "Add your email address and business address." });
    await saveSettings({ publicEmail: "hello@robinson.example.test", publicAddress: "[Business Address]" });
    expect((await steps()).byKey.business).toMatchObject({ done: false, detail: "Add your business address." });
    await saveSettings({ publicAddress: "1 Main St, Greeley, CO 80631" });
    expect((await steps()).byKey.business).toMatchObject({ done: true });
  });

  it("service area is done once a real city or ZIP code is saved", async () => {
    await saveSettings({ serviceAreaCities: [" "], serviceAreaZips: [] });
    expect((await steps()).byKey["service-area"].done).toBe(false);
    await saveSettings({ serviceAreaCities: ["Greeley"], serviceAreaZips: ["80631", "80634"] });
    expect((await steps()).byKey["service-area"]).toMatchObject({ done: true, detail: "You serve 1 city and 2 ZIP codes." });
  });

  it("prices count only active appliances and sets with a monthly price above $0", async () => {
    const type = await prisma.applianceType.create({
      data: { name: "W7 Test Washer " + tag, slug: "w7-test-washer-" + tag, monthlyPriceCents: 0 },
    });
    typeIds.push(type.id);
    expect((await steps()).byKey.prices.done).toBe(false);
    await prisma.applianceType.update({ where: { id: type.id }, data: { monthlyPriceCents: 3500 } });
    expect((await steps()).byKey.prices).toMatchObject({ done: true, detail: "1 appliance has a monthly price." });
    await prisma.applianceType.update({ where: { id: type.id }, data: { isActive: false } });
    expect((await steps()).byKey.prices.done).toBe(false);
    const set = await prisma.rentalPackage.create({
      data: { name: "W7 Test Set " + tag, slug: "w7-test-set-" + tag, monthlyPriceCents: 6000 },
    });
    packageIds.push(set.id);
    expect((await steps()).byKey.prices).toMatchObject({ done: true, detail: "1 set has a monthly price." });
    await prisma.rentalPackage.update({ where: { id: set.id }, data: { monthlyPriceCents: 0 } });
    expect((await steps()).byKey.prices.done).toBe(false);
    await prisma.applianceType.update({ where: { id: type.id }, data: { isActive: true } });
    expect((await steps()).byKey.prices.done).toBe(true);
  });

  it("tax setup follows the saved accounts and address, and agrees with Taxes → Setup at every stage", async () => {
    const agree = async (expected: boolean, detail?: string) => {
      const tax = (await steps()).byKey.tax;
      expect(tax.done).toBe(expected);
      expect(await overviewTaxDone()).toBe(expected);
      if (detail !== undefined) expect(tax.detail).toBe(detail);
    };
    await agree(false, "Add your Colorado sales tax account. 2 more after that.");

    const sales = await prisma.taxFilingAccount.create({
      data: { name: "W7 sales " + tag, kind: "SALES_RETURN", frequency: "QUARTERLY", basis: "UNDECIDED" },
    });
    accountIds.push(sales.id);
    await agree(false, "Enter your sales tax account number, how you report sales tax (cash or accrual; ask your accountant if unsure), your first filing period, the website you file on. 2 more after that.");

    await prisma.taxFilingAccount.update({
      where: { id: sales.id },
      data: { accountNumber: "W7-" + tag, basis: "CASH", portalUrl: "https://tax.example.test", firstPeriodStart: new Date("2026-10-01T06:00:00Z") },
    });
    await agree(false, "Confirm your business address for tax.");

    const area = await prisma.taxJurisdiction.create({
      data: { id: "w7-area-" + tag, code: "W7-" + tag, name: "W7 Greeley test", level: "CITY", administration: "SELF_COLLECTED" },
    });
    jurisdictionIds.push(area.id);
    const location = await prisma.addressTaxLocation.create({
      data: { forBusinessLocation: true, status: "NEEDS_REVIEW", source: "MANUAL", lookedUpAt: new Date(), jurisdictions: { create: { jurisdictionId: area.id } } },
    });
    locationIds.push(location.id);
    await agree(false, "Confirm your business address for tax.");

    await prisma.addressTaxLocation.update({ where: { id: location.id }, data: { status: "VERIFIED" } });
    await agree(false, "Link a use-tax account for 1 tax area (Colorado and Greeley).");

    const use = await prisma.taxFilingAccount.create({
      data: { name: "W7 use " + tag, kind: "USE_TAX_RETURN", frequency: "MONTHLY", basis: "CASH" },
    });
    accountIds.push(use.id);
    await prisma.taxJurisdiction.update({ where: { id: area.id }, data: { useTaxFilingAccountId: use.id } });
    // The new use-tax account has no first filing period yet, so the calendar is still incomplete.
    await agree(false, "Set the first filing period for every filing account.");

    await prisma.taxFilingAccount.update({ where: { id: use.id }, data: { firstPeriodStart: new Date("2026-10-01T06:00:00Z") } });
    await agree(true, "Sales tax account on file, filed quarterly. Business address confirmed and use-tax accounts linked.");

    // Taking the address back out un-does the step again, in both places.
    await prisma.addressTaxLocation.update({ where: { id: location.id }, data: { status: "NEEDS_REVIEW" } });
    await agree(false, "Confirm your business address for tax.");
    await prisma.addressTaxLocation.update({ where: { id: location.id }, data: { status: "VERIFIED" } });
    await agree(true);
  });

  it("payments and email report what is truly connected, and never expose a secret", async () => {
    await saveSettings({ customerEmailEnabled: false });
    const off = await steps(TEST_ENV);
    expect(off.byKey.payments).toMatchObject({ done: true, detail: "Connected in test mode, so no real money moves yet." });
    expect(off.byKey.email).toMatchObject({ done: false, detail: "Customer emails are switched off. Turn them on in Settings → Notifications when you're ready." });

    await saveSettings({ customerEmailEnabled: true });
    const on = await steps(TEST_ENV);
    expect(on.byKey.email).toMatchObject({ done: true, detail: "Connected, and customer emails are on." });

    const noSync = await steps({ ...TEST_ENV, STRIPE_WEBHOOK_SECRET: undefined });
    expect(noSync.byKey.payments.done).toBe(false);
    const noSender = await steps({ ...TEST_ENV, RESEND_FROM_EMAIL: undefined });
    expect(noSender.byKey.email.done).toBe(false);

    const everything = JSON.stringify([off.result, on.result, noSync.result, noSender.result]);
    for (const secret of Object.values(TEST_ENV)) expect(everything).not.toContain(secret as string);
  });

  it("is complete only when all six steps are really done, and goes back when one is undone", async () => {
    const complete = await steps(TEST_ENV);
    expect(complete.result).toMatchObject({ doneCount: 6, total: 6, complete: true });
    await saveSettings({ publicPhone: "[Phone Number]" });
    const broken = await steps(TEST_ENV);
    expect(broken.result).toMatchObject({ doneCount: 5, complete: false });
    expect(broken.result.steps.filter(step => !step.done).map(step => step.key)).toEqual(["business"]);
    await saveSettings({ publicPhone: "(970) 555-0100" });
    expect((await steps(TEST_ENV)).result.complete).toBe(true);
  });

  it("only reads: it changes no setting and writes no audit entry", async () => {
    const before = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { updatedAt: true } });
    const auditsBefore = await prisma.auditLog.count({ where: { userId: ownerId } });
    await steps(TEST_ENV);
    await steps({});
    const after = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { updatedAt: true } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await prisma.auditLog.count({ where: { userId: ownerId } })).toBe(auditsBefore);
  });
});
