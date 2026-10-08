import { describe, expect, it } from "vitest";
import { businessDateFromKey } from "@/lib/business-date";
import { buildFilingPacket, type FilingPacketRow } from "@/domains/tax/filing-packet";
const date = (key: string) => businessDateFromKey(key)!;
const row = (parts: Partial<FilingPacketRow> = {}): FilingPacketRow => ({
  jurisdictionId: "co", name: "Colorado", filingCode: "CO",
  administration: "STATE_COLLECTED",
  grossSalesCents: 10000, deductions: [],
  netTaxableCents: 10000, rateMilliPercent: 2900,
  taxCents: 290, serviceFeeCents: 10, remitCents: 280,
  ...parts,
});
const input = (parts: Partial<Parameters<typeof buildFilingPacket>[0]> = {}) => ({
  account: {
    id: "account", name: "Colorado State", kind: "SALES_RETURN" as const,
    accountNumber: "1234", portalUrl: "https://example.gov",
    deductionLabels: {},
  },
  period: {
    start: date("2026-09-01"), end: date("2026-09-30"),
    dueOn: date("2026-10-20"), legalDueOn: date("2026-10-20"),
  },
  basis: "ACCRUAL" as const, rows: [row()], useTax: [],
  viewedOn: date("2026-10-15"), ...parts,
});

describe("T-6b1 filing packet from persisted integer-cent evidence", () => {
  it("reports stored per-invoice tax, on-time fee and late full tax without recomputation", () => {
    const onTime = buildFilingPacket(input());
    expect(onTime.totals).toEqual({
      taxCents: 290, serviceFeeCents: 10, remitIfOnTimeCents: 280,
      remitIfLateCents: 290, remitCents: 280,
    });
    const late = buildFilingPacket(input({ viewedOn: date("2026-10-21") }));
    expect(late.totals.remitCents).toBe(290);
    expect(late.warnings.some(w => /penalty/i.test(w))).toBe(true);
    expect(late.rows[0].remitCents).toBe(290);
  });

  it("keeps per-invoice rounding and mid-period rates rather than combining versions", () => {
    const p = buildFilingPacket(input({
      rows: [
        row({ taxableCents: 1001, grossSalesCents: 1001, taxCents: 30, serviceFeeCents: 0 }),
        row({ taxableCents: 1000, grossSalesCents: 1000, rateMilliPercent: 3000, taxCents: 30, serviceFeeCents: 0 }),
      ],
    }));
    expect(p.rows.map(x => x.rateMilliPercent)).toEqual([2900, 3000]);
    expect(p.totals.taxCents).toBe(60);
    expect(p.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/rounding/)]));
  });

  it("shows undecided deduction mappings without secretly adjusting tax", () => {
    const p = buildFilingPacket(input({
      rows: [row({
        deductions: [{ key: "EXEMPT_SHORT_TERM_RENTAL", label: "old", cents: 5000 }],
        grossSalesCents: 15000, netTaxableCents: 10000, taxCents: 290,
      })],
    }));
    expect(p.rows[0].deductions[0].label).toContain("ask your CPA");
    expect(p.totals.taxCents).toBe(290);
    expect(p.warnings.join(" ")).toContain("EXEMPT_SHORT_TERM_RENTAL");
  });

  it("accepts a configured label and builds a use-tax-only return", () => {
    const p = buildFilingPacket(input({
      account: {
        id: "use", name: "Colorado use", kind: "USE_TAX_RETURN",
        accountNumber: null, portalUrl: null, deductionLabels: {
          EXEMPT_SHORT_TERM_RENTAL: { label: "Short-term rental", reportAs: "DEDUCTION" },
        },
      },
      rows: [],
      useTax: [{ jurisdictionId: "co", name: "Colorado", filingCode: "CO", purchaseCents: 10000, useTaxCents: 290 }],
    }));
    expect(p.zeroReturn).toBe(false);
    expect(p.totals.taxCents).toBe(290);
    expect(p.steps.join(" ")).toContain("use tax");
  });

  it("recognizes genuinely zero-return periods", () => {
    const p = buildFilingPacket(input({ rows: [], useTax: [] }));
    expect(p.zeroReturn).toBe(true);
    expect(p.totals.remitCents).toBe(0);
    expect(p.steps.join(" ")).toContain("zero return");
  });
});
