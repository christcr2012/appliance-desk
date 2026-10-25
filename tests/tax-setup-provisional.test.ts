import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => (calls.push(strings.join("?").includes('"User"')
      ? "lock:user" : "lock:cell"), [])),
    user: { findUnique: vi.fn(async () => ({ id: "owner", role: "OWNER", archivedAt: null })) },
    taxJurisdiction: { findUniqueOrThrow: vi.fn(async () =>
      ({ level: "CITY", administration: "SELF_COLLECTED", name: "Greeley" })) },
    decisionScheduledChange: {
      findMany: vi.fn(async () => [] as Array<{ id: string; subjectId: string; effectiveFrom: Date }>),
      update: vi.fn(async () => (calls.push("pending:cancel"), {})),
    },
    taxabilityRule: {
      findFirst: vi.fn(async () => ({ id: "rule-1", taxability: "UNDECIDED", provisional: false, cpaConfirmedOn: null,
        reason: null })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (calls.push("rule:update"),
        { id: "rule-1", category: "DELIVERY", ...data })),
      create: vi.fn(),
    },
    taxabilityRuleVersion: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (calls.push(
        `version:${String(data.taxability)}:${(data.effectiveFrom as Date).toISOString().slice(0, 10)}`), {})),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: { action: string } }) => (calls.push(`audit:${data.action}`), {})) },
  };
  return { calls, tx, transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)) };
});
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));

import { saveProvisionalTaxabilityCell, saveTaxabilityCellInTx } from "@/domains/tax/setup";

const sources = [{ title: "Colorado DOR leases", url: "https://tax.colorado.gov/sales-use-tax-topics-leases",
  checkedOn: "2026-10-25" }];

beforeEach(() => {
  m.calls.length = 0;
  vi.clearAllMocks();
});

describe("provisional taxability starting values (DEC-1a section 5)", () => {
  it("refuses 'not decided' and missing evidence before touching anything", async () => {
    await expect(saveProvisionalTaxabilityCell("owner", { jurisdictionId: null, category: "DELIVERY",
      taxability: "UNDECIDED", reason: "x", sources })).rejects.toThrow(/taxable or exempt/);
    await expect(saveProvisionalTaxabilityCell("owner", { jurisdictionId: null, category: "DELIVERY",
      taxability: "TAXABLE", reason: " ", sources })).rejects.toThrow(/Explain why/);
    await expect(saveProvisionalTaxabilityCell("owner", { jurisdictionId: null, category: "DELIVERY",
      taxability: "TAXABLE", reason: "Researched", sources: [{ ...sources[0]!, url: "http://example.com" }] }))
      .rejects.toThrow(/https link/);
    expect(m.calls).toEqual([]);
  });

  it("saves the value as provisional with no CPA date, after the owner check and the cell lock", async () => {
    await saveProvisionalTaxabilityCell("owner", { jurisdictionId: "greeley", category: "DELIVERY",
      taxability: "TAXABLE", reason: "Greeley code unread; careful choice", sources });
    expect(m.calls.slice(0, 2)).toEqual(["lock:user", "lock:cell"]);
    expect(m.tx.taxabilityRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      taxability: "TAXABLE", provisional: true, cpaConfirmedOn: null, provisionalSources: sources }) }));
    // First dated save of a cell that already existed keeps what it was, from before history existed.
    expect(m.calls.filter((call) => call.startsWith("version:"))).toEqual(
      ["version:UNDECIDED:1970-01-01", expect.stringMatching(/^version:TAXABLE:/)]);
  });

  it("refuses staff and admins", async () => {
    for (const role of ["ADMIN", "STAFF"]) {
      m.tx.user.findUnique.mockResolvedValueOnce({ id: "x", role, archivedAt: null });
      await expect(saveProvisionalTaxabilityCell("x", { jurisdictionId: null, category: "DELIVERY",
        taxability: "TAXABLE", reason: "Researched", sources })).rejects.toThrow(/no longer has access/);
    }
    expect(m.tx.taxabilityRule.update).not.toHaveBeenCalled();
  });

  it("a rule saved for a cell that had none starts history as 'not decided', so it never reaches back", async () => {
    m.tx.taxabilityRule.findFirst.mockResolvedValueOnce(null as never);
    m.tx.taxabilityRule.create.mockResolvedValueOnce({ id: "rule-2", category: "DELIVERY" } as never);
    await saveProvisionalTaxabilityCell("owner", { jurisdictionId: null, category: "DELIVERY",
      taxability: "TAXABLE", reason: "Researched", sources });
    expect(m.calls.filter((call) => call.startsWith("version:"))).toEqual(
      ["version:UNDECIDED:1970-01-01", expect.stringMatching(/^version:TAXABLE:/)]);
  });

  it("cancels a Decisions & reviews change still waiting for the same cell (audited), in the same transaction", async () => {
    m.tx.decisionScheduledChange.findMany.mockResolvedValueOnce([
      { id: "wait-1", subjectId: "IN-34-DELIVERY-GREELEY", effectiveFrom: new Date("2026-12-01T07:00:00Z") }]);
    await saveTaxabilityCellInTx(m.tx as never, "owner", { jurisdictionId: "greeley", category: "DELIVERY",
      taxability: "TAXABLE", cpaConfirmedOn: new Date("2026-10-20T12:00:00Z"), reason: "CPA letter" });
    expect(m.tx.decisionScheduledChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ subjectId: { in: ["IN-34-DELIVERY-GREELEY"] }, appliedAt: null, cancelledAt: null }) }));
    expect(m.calls).toContain("pending:cancel");
    expect(m.calls).toContain("audit:decision.scheduled_cancelled");
    expect(m.calls.indexOf("pending:cancel")).toBeLessThan(m.calls.indexOf("rule:update"));
  });

  it("a confirmed save clears the provisional flag and dates its history from the given start", async () => {
    m.tx.taxabilityRuleVersion.count.mockResolvedValueOnce(2);
    await saveTaxabilityCellInTx(m.tx as never, "owner", { jurisdictionId: null, category: "DELIVERY",
      taxability: "EXEMPT", cpaConfirmedOn: new Date("2026-10-20T12:00:00Z"), reason: "CPA letter" },
    { effectiveFrom: new Date("2026-11-01T06:00:00Z") });
    expect(m.tx.taxabilityRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      taxability: "EXEMPT", provisional: false, provisionalReason: null }) }));
    expect(m.calls.filter((call) => call.startsWith("version:"))).toEqual(["version:EXEMPT:2026-11-01"]);
  });
});
