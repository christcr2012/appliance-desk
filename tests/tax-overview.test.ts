import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { getTaxWorkspaceOverview, sortTaxAttention, type TaxAttentionDTO } from "@/domains/tax/workspace-overview";
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

