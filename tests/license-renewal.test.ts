import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { licenseDefaultExpiry, nextLicenseExpiry } from "@/domains/tax/license-dates";
import { markLicenseRenewed, saveTaxFilingAccount, type FilingAccountInput } from "@/domains/tax/setup";
import { listTaxFilingAttention } from "@/domains/tax/filing-attention";
import { getRuleTimingSettings } from "@/domains/rules/reads";
import { whenToAct } from "@/domains/rules/timing";

function databaseUri(): URL | null {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
}
const uri = databaseUri();
const enabled = process.env.CI === "true" && uri !== null &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;

describe("TFA-2 §10 license date helpers", () => {
  it("the default expiry is Dec 31 of the odd year in force", () => {
    expect(businessDateKey(licenseDefaultExpiry(day("2026-10-26")))).toBe("2027-12-31");
    expect(businessDateKey(licenseDefaultExpiry(day("2027-06-15")))).toBe("2027-12-31");
    expect(businessDateKey(licenseDefaultExpiry(day("2027-12-31")))).toBe("2027-12-31");
    expect(businessDateKey(licenseDefaultExpiry(day("2028-01-01")))).toBe("2029-12-31");
  });

  it("a renewal rolls to the next odd year's Dec 31", () => {
    expect(businessDateKey(nextLicenseExpiry(day("2027-12-31")))).toBe("2029-12-31");
    expect(businessDateKey(nextLicenseExpiry(day("2029-12-31")))).toBe("2031-12-31");
    expect(businessDateKey(nextLicenseExpiry(day("2027-07-01")))).toBe("2027-12-31");
  });
});

async function ownerFixture(run: (id: string) => Promise<void>) {
  const key = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.create({
    data: {
      email: key + "@license.example.test", name: "License fixture", role: "OWNER",
      passwordHash: "test-only",
    },
  });
  try {
    await run(owner.id);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

function accountInput(name: string, overrides: Partial<FilingAccountInput> = {}): FilingAccountInput {
  return {
    id: null, name, kind: "SALES_RETURN", frequency: "MONTHLY", basis: "CASH",
    accountNumber: "TEST-10", portalUrl: null,
    dueDayOfFollowingMonth: 20, firstPeriodStart: day("2026-01-01"),
    emailReminders: true, reminderDaysBefore: [7], active: true, filingNotes: null,
    licenseExpiresOn: null, screenLabels: {}, deductionLabels: {},
    excelUploadAvailable: null, bulkXmlAvailable: null, setupCheckedOn: null,
    ...overrides,
  };
}

describe.skipIf(!enabled)("TFA-2 §10 license renewal on real Postgres", () => {
  it("defaults the sales license date from the rule, keeps explicit dates, and leaves use tax alone", async () =>
    ownerFixture(async (ownerId) => {
      const tag = randomUUID().slice(0, 8);
      const created: string[] = [];
      try {
        const defaulted = await saveTaxFilingAccount(ownerId, accountInput("License default " + tag), null);
        created.push(defaulted.id);
        const stored = await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: defaulted.id } });
        expect(stored.licenseExpiresOn).not.toBeNull();
        expect(businessDateKey(stored.licenseExpiresOn!))
          .toBe(businessDateKey(licenseDefaultExpiry(new Date())));

        const explicit = await saveTaxFilingAccount(
          ownerId, accountInput("License explicit " + tag, { licenseExpiresOn: day("2027-07-01") }), null);
        created.push(explicit.id);
        expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: explicit.id } }))
          .licenseExpiresOn?.getTime()).toBe(day("2027-07-01").getTime());

        const useTax = await saveTaxFilingAccount(
          ownerId, accountInput("License use tax " + tag, { kind: "USE_TAX_RETURN" }), null);
        created.push(useTax.id);
        expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: useTax.id } }))
          .licenseExpiresOn).toBeNull();

        // Update path: a sales account whose stored date was cleared gets
        // the default back when the form saves an empty date.
        await prisma.taxFilingAccount.update({
          where: { id: defaulted.id }, data: { licenseExpiresOn: null },
        });
        const fresh = await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: defaulted.id } });
        const resaved = await saveTaxFilingAccount(
          ownerId, accountInput("License default " + tag, { id: defaulted.id }), fresh.updatedAt);
        const after = await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: resaved.id } });
        expect(after.licenseExpiresOn).not.toBeNull();
        expect(businessDateKey(after.licenseExpiresOn!))
          .toBe(businessDateKey(licenseDefaultExpiry(new Date())));
      } finally {
        await prisma.taxFilingAccount.deleteMany({ where: { id: { in: created } } });
      }
    }));

  it("the Today reminder appears inside the spec's renewal window, not months early (review case)", async () =>
    ownerFixture(async (ownerId) => {
      const tag = randomUUID().slice(0, 8);
      const name = "License window " + tag;
      const account = await saveTaxFilingAccount(
        ownerId, accountInput(name, { licenseExpiresOn: day("2027-12-31") }), null);
      try {
        const shown = async (now: Date) =>
          (await listTaxFilingAttention(now)).licenses.rows.some((row) => row.title.includes(name));
        // Section 3: the window opens November 1 of the expiry year, and
        // at the default 90 percent timing the act-on day lands in late
        // December. October, and even mid-December, are too early.
        expect(await shown(day("2027-10-19"))).toBe(false);
        expect(await shown(day("2027-12-20"))).toBe(false);
        expect(await shown(day("2027-12-30"))).toBe(true);
      } finally {
        await prisma.taxFilingAccount.deleteMany({ where: { id: account.id } });
      }
    }));

  it("marking renewed rolls the date to the next odd year and audits it", async () =>
    ownerFixture(async (ownerId) => {
      const tag = randomUUID().slice(0, 8);
      const created: string[] = [];
      try {
        const account = await saveTaxFilingAccount(
          ownerId, accountInput("License renew " + tag, { licenseExpiresOn: day("2027-12-31") }), null);
        created.push(account.id);
        const renewed = await markLicenseRenewed(ownerId, account.id);
        expect(businessDateKey(renewed.licenseExpiresOn)).toBe("2029-12-31");
        expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: account.id } }))
          .licenseExpiresOn?.getTime()).toBe(day("2029-12-31").getTime());
        expect(await prisma.auditLog.count({
          where: { action: "tax.license.renewed", entityId: account.id },
        })).toBe(1);

        const blank = await saveTaxFilingAccount(
          ownerId, accountInput("License blank " + tag, { kind: "USE_TAX_RETURN" }), null);
        created.push(blank.id);
        await expect(markLicenseRenewed(ownerId, blank.id))
          .rejects.toThrow(/current license expiration first/);
      } finally {
        await prisma.taxFilingAccount.deleteMany({ where: { id: { in: created } } });
      }
    }));

  it("the Today license reminder waits for the timing point", async () =>
    ownerFixture(async (ownerId) => {
      const tag = randomUUID().slice(0, 8);
      const name = "License timing " + tag;
      const account = await saveTaxFilingAccount(
        ownerId, accountInput(name, { licenseExpiresOn: day("2027-12-31") }), null);
      try {
        const timing = await getRuleTimingSettings();
        const actOn = whenToAct({
          opens: day("2027-11-01"), closes: day("2027-12-31"), effect: "COSTS",
          now: day("2027-11-01"), percent: timing.percent,
          marginBusinessDays: timing.marginBusinessDays,
        }).actOn;
        const actOnKey = businessDateKey(actOn);
        const dayBefore = new Date(actOn.getTime() - 24 * 3600 * 1000);
        const mine = (items: { title: string }[]) =>
          items.filter((item) => item.title.includes(name));
        const before = await listTaxFilingAttention(dayBefore);
        expect(mine(before.licenses.rows)).toHaveLength(0);
        const onDay = await listTaxFilingAttention(actOn);
        expect(mine(onDay.licenses.rows)).toHaveLength(1);
        expect(mine(onDay.licenses.rows)[0]!.title).toContain("Tax license renewal");
        expect(actOnKey > "2026-01-01").toBe(true);
      } finally {
        await prisma.taxFilingAccount.deleteMany({ where: { id: account.id } });
      }
    }));
});
