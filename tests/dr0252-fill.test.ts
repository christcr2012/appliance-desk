import { describe, expect, it } from "vitest";
import { buildUseTaxWorksheet } from "@/domains/tax/dr0252-worksheet";
import type { FilingPacket } from "@/domains/tax/filing-packet";

const packet = {
  account: { id: "account", name: "Colorado Consumer Use Tax", kind: "USE_TAX_RETURN", accountNumber: null, portalUrl: null },
  periodStart: "2026-01-01", periodEnd: "2026-12-31", dueOn: "2027-01-20", legalDueOn: "2027-01-20",
  basis: "ACCRUAL", zeroReturn: false, rows: [],
  useTax: [{ jurisdictionId: "state", name: "Colorado", filingCode: "CO", purchaseCents: 10001, useTaxCents: 275 }],
  totals: { taxCents: 275, serviceFeeCents: 0, remitIfOnTimeCents: 275, remitIfLateCents: 275, remitCents: 275 },
  steps: [], warnings: [],
} satisfies FilingPacket;

describe("DR 0252 safe worksheet", () => {
  it("labels the figures and never claims to be a completed return", () => {
    const result = buildUseTaxWorksheet(packet);
    expect(result.rows).toContainEqual({ label: "Taxable purchases 1 ($)", value: "100.01" });
    expect(result.rows).toContainEqual({ label: "Use tax due 1 ($)", value: "2.75" });
    expect(result.warning).toMatch(/not a completed official return/i);
  });
  it("never exports account credentials or private portal tokens", () => {
    const result = buildUseTaxWorksheet({ ...packet, account: { ...packet.account, accountNumber: "private-account", portalUrl: "https://private.example/token" } });
    expect(JSON.stringify(result)).not.toContain("private-account");
    expect(JSON.stringify(result)).not.toContain("private.example");
  });
  it("rejects sales-return packets", () => {
    expect(() => buildUseTaxWorksheet({ ...packet, account: { ...packet.account, kind: "SALES_RETURN" } })).toThrow(/use-tax filing account/);
  });
});
