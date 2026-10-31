import { describe, expect, it } from "vitest";
import { businessDateFromKey } from "@/lib/business-date";
import { buildFilingPacket, type FilingPacketRow } from "@/domains/tax/filing-packet";
import {
  CPA_PENDING_LABEL, RESEARCHED_DEDUCTION_DEFAULTS,
  parseDeductionLabels, recommendedDeductionLabels, resolveDeductionLabels,
} from "@/domains/tax/deduction-labels";

/**
 * W-12 / IN-44 (owner decision 2026-10-31): researched deduction-reporting
 * defaults. The packet's four buckets resolve to the researched Schedule A
 * wording when the owner has saved none, carry the pending-CPA provenance,
 * and never change tax due. Evidence: docs/research/2026-10-31-in-44-deduction-reporting.md.
 */
const date = (key: string) => businessDateFromKey(key)!;
const row = (parts: Partial<FilingPacketRow> = {}): FilingPacketRow => ({
  jurisdictionId: "co", name: "Colorado", filingCode: "CO",
  administration: "STATE_COLLECTED",
  grossSalesCents: 10000, deductions: [],
  netTaxableCents: 10000, rateMilliPercent: 2900,
  taxCents: 290, serviceFeeCents: 10, remitCents: 280,
  ...parts,
});
const input = (deductionLabels: unknown, rows: FilingPacketRow[]) => ({
  account: {
    id: "account", name: "Colorado State", kind: "SALES_RETURN" as const,
    accountNumber: "1234", portalUrl: "https://example.gov", deductionLabels,
  },
  period: {
    start: date("2026-09-01"), end: date("2026-09-30"),
    dueOn: date("2026-10-20"), legalDueOn: date("2026-10-20"),
  },
  basis: "ACCRUAL" as const, rows, useTax: [], viewedOn: date("2026-10-15"),
});
const taxedRow = (key: string) => row({
  deductions: [{ key, label: key, cents: 5000 }],
  grossSalesCents: 15000, netTaxableCents: 10000, taxCents: 290,
});

describe("W-12 researched deduction defaults (IN-44)", () => {
  it("gives every packet bucket a researched default, all reported as deductions", () => {
    const resolved = resolveDeductionLabels({});
    for (const key of [
      "EXEMPT_SHORT_TERM_RENTAL", "NOT_TAXED_CATEGORY", "EXEMPT_CUSTOMER_OTHER", "OUTSIDE_AREA",
    ]) {
      expect(resolved[key], key).toBeDefined();
      expect(resolved[key]!.reportAs).toBe("DEDUCTION");
      expect(resolved[key]!.source).toBe("RESEARCHED_DEFAULT");
      expect(resolved[key]!.label).toContain(RESEARCHED_DEDUCTION_DEFAULTS[key]!.scheduleLine);
    }
    expect(resolved.EXEMPT_SHORT_TERM_RENTAL!.label).toContain("Other exempt sales");
    expect(resolved.NOT_TAXED_CATEGORY!.label).toContain("nontaxable services");
    expect(resolved.EXEMPT_CUSTOMER_OTHER!.label).toContain("exempt entities");
    expect(resolved.OUTSIDE_AREA!.label).toContain("outside of Colorado");
  });

  it("keeps the owner's saved wording ahead of any default, marked as theirs", () => {
    const resolved = resolveDeductionLabels({
      NOT_TAXED_CATEGORY: { label: "My CPA's wording", reportAs: "DEDUCTION" },
    });
    expect(resolved.NOT_TAXED_CATEGORY).toEqual({
      label: "My CPA's wording", reportAs: "DEDUCTION", source: "OWNER",
    });
    // An untouched bucket still falls back to its researched default.
    expect(resolved.OUTSIDE_AREA!.source).toBe("RESEARCHED_DEFAULT");
  });

  it("reads stored provenance and skips unusable stored entries", () => {
    const parsed = parseDeductionLabels({
      OUTSIDE_AREA: { label: "A2-1 ...", reportAs: "DEDUCTION", source: "RESEARCHED_DEFAULT" },
      BROKEN: { label: "", reportAs: "DEDUCTION" },
      ALSO_BROKEN: { label: "x", reportAs: "SIDEWAYS" },
      NOT_AN_OBJECT: 42,
    });
    expect(parsed.OUTSIDE_AREA!.source).toBe("RESEARCHED_DEFAULT");
    expect(Object.keys(parsed)).toEqual(["OUTSIDE_AREA"]);
    expect(parseDeductionLabels(null)).toEqual({});
    expect(parseDeductionLabels([1, 2])).toEqual({});
  });

  it("prints the researched default on the packet with pending provenance, tax unchanged", () => {
    const p = buildFilingPacket(input({}, [taxedRow("EXEMPT_SHORT_TERM_RENTAL")]));
    const line = p.rows[0]!.deductions[0]!;
    expect(line.label).toBe(RESEARCHED_DEDUCTION_DEFAULTS.EXEMPT_SHORT_TERM_RENTAL!.label);
    expect(line.source).toBe("RESEARCHED_DEFAULT");
    expect(p.steps.join(" ")).toContain(CPA_PENDING_LABEL);
    expect(p.warnings.join(" ")).toContain("researched defaults");
    expect(p.warnings.join(" ")).not.toContain("EXEMPT_SHORT_TERM_RENTAL not decided");
    expect(p.totals.taxCents).toBe(290);
    expect(p.rows[0]!.grossSalesCents).toBe(15000);
  });

  it("prints owner wording without the pending marker", () => {
    const p = buildFilingPacket(input({
      EXEMPT_SHORT_TERM_RENTAL: { label: "CPA wording", reportAs: "DEDUCTION" },
    }, [taxedRow("EXEMPT_SHORT_TERM_RENTAL")]));
    const line = p.rows[0]!.deductions[0]!;
    expect(line.label).toBe("CPA wording");
    expect(line.source).toBe("OWNER");
    expect(p.steps.join(" ")).not.toContain(CPA_PENDING_LABEL);
    expect(p.warnings.join(" ")).not.toContain("researched defaults");
  });

  it("prints accountant-set wording as CPA-set, with no pending marker", () => {
    // Chris's amendment (2026-10-31): an accountant's save is the CPA
    // answering IN-44 in the app — provenance ACCOUNTANT, pending clears.
    const parsed = parseDeductionLabels({
      NOT_TAXED_CATEGORY: { label: "CPA wording", reportAs: "DEDUCTION", source: "ACCOUNTANT" },
    });
    expect(parsed.NOT_TAXED_CATEGORY!.source).toBe("ACCOUNTANT");
    const p = buildFilingPacket(input({
      NOT_TAXED_CATEGORY: { label: "CPA wording", reportAs: "DEDUCTION", source: "ACCOUNTANT" },
    }, [taxedRow("NOT_TAXED_CATEGORY")]));
    const line = p.rows[0]!.deductions[0]!;
    expect(line.label).toBe("CPA wording");
    expect(line.source).toBe("ACCOUNTANT");
    expect(p.steps.join(" ")).not.toContain(CPA_PENDING_LABEL);
    expect(p.warnings.join(" ")).not.toContain("researched defaults");
  });

  it("recommended starting values cover exactly the researched buckets", () => {
    const recommended = recommendedDeductionLabels();
    expect(Object.keys(recommended).sort()).toEqual(
      Object.keys(RESEARCHED_DEDUCTION_DEFAULTS).sort(),
    );
    for (const entry of Object.values(recommended)) {
      expect(entry.source).toBe("RESEARCHED_DEFAULT");
      expect(entry.label.length).toBeLessThanOrEqual(120);
    }
  });
});
