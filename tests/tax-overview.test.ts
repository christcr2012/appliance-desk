import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { TAX_CHARGE_CATEGORIES } from "@/domains/tax/categories";
import { getTaxWorkspaceOverview, sortTaxAttention, includeTodayTaxAttention, hasCompleteTaxabilityMatrix, type TaxAttentionDTO } from "@/domains/tax/workspace-overview";
const connection = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && connection.pathname === "/appliance_desk_test"
  && ["localhost", "127.0.0.1"].includes(connection.hostname);
const date = (value: string) => businessDateFromKey(value)!;
async function withPeriods(run: (ids: { ownerId: string; staffId: string;
  first: string; second: string; amendment: string }) => Promise<void>) {
  const token = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.findFirstOrThrow({
    where: { role: "OWNER", archivedAt: null }, select: { id: true },
  });
  const staff = await prisma.user.create({ data: {
    email: "tax-overview-" + token + "@example.test", name: "test staff",
    role: "STAFF", passwordHash: "test-only",
  } });
  const account = await prisma.taxFilingAccount.create({ data: {
    name: "Overview fixture " + token.slice(0, 8), kind: "SALES_RETURN",
    active: true, frequency: "MONTHLY", basis: "ACCRUAL",
    firstPeriodStart: date("2026-01-01"),
  } });
  const first = await prisma.taxFilingPeriod.create({ data: {
    filingAccountId: account.id, periodStart: date("2026-01-01"),
    periodEnd: date("2026-01-31"), dueOn: date("2026-02-20"),
  } });
  const second = await prisma.taxFilingPeriod.create({ data: {
    filingAccountId: account.id, periodStart: date("2026-02-01"),
    periodEnd: date("2026-02-28"), dueOn: date("2026-03-20"),
  } });
  const amendment = await prisma.taxFilingAmendment.create({ data: {
    periodId: first.id, sequence: 1, status: "OPEN",
    additionalTaxCents: 0, packet: { synthetic: true },
  } });
  try {
    await run({ ownerId: owner.id, staffId: staff.id,
      first: first.id, second: second.id, amendment: amendment.id });
  } finally {
    await prisma.taxFilingAmendment.deleteMany({ where: { periodId: { in: [first.id, second.id] } } });
    await prisma.taxFilingPeriod.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    await prisma.taxFilingAccount.delete({ where: { id: account.id } });
    await prisma.user.delete({ where: { id: staff.id } });
  }
}
describe("T-7D decision-completeness projection", () => {
  it("requires every charge and refuses unresolved local overrides", () => {
    const confirmedOn = date("2026-10-01");
    const defaults = TAX_CHARGE_CATEGORIES.map(category => ({
      jurisdictionId: null, category, taxability: "TAXABLE", cpaConfirmedOn: confirmedOn,
    }));
    const stateArea = [{ jurisdictionId: "county", jurisdiction: { administration: "STATE_COLLECTED" } }];
    expect(hasCompleteTaxabilityMatrix(defaults, stateArea)).toBe(true);
    expect(hasCompleteTaxabilityMatrix(defaults.slice(1), stateArea)).toBe(false);
    expect(hasCompleteTaxabilityMatrix([
      ...defaults, { jurisdictionId: "county", category: "RENTAL",
        taxability: "UNDECIDED", cpaConfirmedOn: null },
    ], stateArea)).toBe(false);
    expect(hasCompleteTaxabilityMatrix(defaults, [{
      jurisdictionId: "home-rule", jurisdiction: { administration: "HOME_RULE" },
    }])).toBe(false);
  });
});

describe.skipIf(!enabled)("T-7D tax workspace overview (isolated PostgreSQL)", () => {
  it("filing setup checklist is a read-only attention projection, never a billing activation gate", async () =>
    withPeriods(async f => {
      const before = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: f.first } });
      const overview = await getTaxWorkspaceOverview(f.ownerId, date("2026-04-05"));
      expect(overview.setup.some(s => s.key === "accounts")).toBe(true);
      expect(overview.setup.every(s => s.href.startsWith("/desk/sales-tax/"))).toBe(true);
      expect((await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: f.first } })).status).toBe(before.status);
      await expect(getTaxWorkspaceOverview(f.staffId, date("2026-04-05"))).rejects.toThrow();
    }));
  it("all attention choices lead to implemented work routes", async () => withPeriods(async f => {
    const page = await getTaxWorkspaceOverview(f.ownerId, date("2026-04-05"));
    expect(page.attention.find(a => a.id === "amend:" + f.amendment)?.href)
      .toBe("/desk/sales-tax/returns/" + f.first + "/amend");
    expect(page.attention.find(a => a.id === "period:" + f.first)?.href)
      .toBe("/desk/sales-tax/returns/" + f.first);
    const allowed = /^\/(desk\/sales-tax\/(setup|taxability|returns(?:\/[A-Za-z0-9_-]+(?:\/amend)?)?|areas#sources)|desk\/inventory\?taxStatus=UNKNOWN)$/;
    for (const item of page.attention) {
      expect(item.href).toMatch(allowed);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  }));
  it("filters more than 25 obsolete periods before limiting valid return dates", async () =>
    withPeriods(async f => {
      const { filingAccountId } = await prisma.taxFilingPeriod.findUniqueOrThrow({
        where: { id: f.first }, select: { filingAccountId: true },
      });
      const obsolete = Array.from({ length: 26 }, (_, i) => ({
        filingAccountId, periodStart: new Date(Date.UTC(2000, 0, i + 1)),
        periodEnd: new Date(Date.UTC(2000, 1, i + 1)), dueOn: new Date(Date.UTC(2000, 2, i + 1)),
      }));
      await prisma.taxFilingPeriod.createMany({ data: obsolete });
      try {
        const projection = await getTaxWorkspaceOverview(f.ownerId, date("2026-04-05"));
        expect(projection.nextDue.map(p => p.id)).toEqual([f.first, f.second]);
        expect(projection.attention.some(item => item.id === "period:" + f.first)).toBe(true);
      } finally {
        await prisma.taxFilingPeriod.deleteMany({
          where: { filingAccountId, periodStart: { lt: date("2026-01-01") } },
        });
      }
    }));
  it("includes license, exemption, refund, rate, billing and purchase tax from Today", async () => {
    const categories = ["SALES_TAX", "TAX_LICENSE_RENEWAL", "TAX_AMENDMENT_DUE",
      "TAX_FILING_NOT_READY", "ACQUISITION_TAX_REVIEW",
      "PURCHASE_USE_TAX_DUE", "RETAIL_DELIVERY_FEE", "TAX_RETURN_DUE"] as const;
    const base = { setup: [], nextReturn: null, nextDue: [], attention: [] };
    const projected = includeTodayTaxAttention(base, categories.map((category, index) => ({
      category, severity: "medium" as const, title: category,
      detail: "Action still pending", href: "/desk/today?tax=" + index,
      since: date("2026-04-05"),
    })));
    expect(projected.attention).toHaveLength(categories.length);
    expect(new Set(projected.attention.map(item => item.href)).size).toBe(categories.length);
    expect(projected.attention.every(item => item.detail === "Action still pending")).toBe(true);
  });
  it("next due is deterministic and priority sort remains stable on date ties", async () =>
    withPeriods(async f => {
      const a = await getTaxWorkspaceOverview(f.ownerId, date("2026-04-05"));
      const b = await getTaxWorkspaceOverview(f.ownerId, date("2026-04-05"));
      expect(a.nextDue.map(row => row.id)).toEqual([f.first, f.second]);
      expect(b.nextDue.map(row => row.id)).toEqual(a.nextDue.map(row => row.id));
      const common: TaxAttentionDTO = {
        id: "z", kind: "DUE", title: "due", detail: "due",
        href: "/desk/sales-tax/setup", sortAt: date("2026-05-01"),
      };
      expect(sortTaxAttention([
        common, { ...common, id: "a" },
        { ...common, kind: "OVERDUE", id: "b" },
      ]).map(x => x.id)).toEqual(["b", "a", "z"]);
    }));
});

