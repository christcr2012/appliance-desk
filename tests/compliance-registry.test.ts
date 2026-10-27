import { describe, expect, it } from "vitest";
import {
  OBLIGATIONS,
  notNeededObligations,
  obligationByKey,
  type ComplianceContext,
} from "@/domains/compliance/registry";
import { businessDateKey } from "@/lib/business-date";

// CMP-1: the registry is seeded from the 2026-10-25 research file. Every
// obligation carries a source; periods are right for 2026-2028; applies()
// covers the owner-fact branches (entity type, employees, truck weight,
// report month, asset facts).

const base: ComplianceContext = {
  entityType: "SINGLE_MEMBER_LLC",
  employees: 0,
  truckGvwrLbs: 14000,
  sosReportMonth: null,
  hasHomeOffice: false,
  hasEin: true,
  hasDepreciableAssets: false,
  hasAssetSales: false,
};
const ctx = (patch: Partial<ComplianceContext>): ComplianceContext => ({ ...base, ...patch });
const key = (d: Date) => businessDateKey(d);
const dueKeys = (k: string, year: number, c: ComplianceContext = base) =>
  obligationByKey(k)!.periods(year, c).map((p) => key(p.dueOn));

describe("compliance registry completeness", () => {
  it("every obligation has a source, an explanation and a handling channel", () => {
    const keys = new Set<string>();
    for (const o of OBLIGATIONS) {
      expect(keys.has(o.key), `duplicate key ${o.key}`).toBe(false);
      keys.add(o.key);
      expect(o.title.length).toBeGreaterThan(3);
      expect(o.agency.length).toBeGreaterThan(1);
      expect(o.explain.length).toBeGreaterThan(30);
      expect(o.sourceUrl).toMatch(/^https:\/\//);
      expect(["DIRECT", "UPLOAD_FILE", "FILLED_FORM", "GUIDED_WEB", "ACCOUNTANT_PACKET"]).toContain(o.channel);
      expect(o.unit).toMatch(/^CMP-[1-5]$/);
    }
  });

  it("seeds exactly the researched obligations", () => {
    const keys = OBLIGATIONS.map((o) => o.key).sort();
    expect(keys).toEqual(
      [
        "co.bpp.weld_declaration",
        "co.income.dr0104ep",
        "co.payroll.famli",
        "co.payroll.ui",
        "co.payroll.withholding",
        "co.sos.periodic_report",
        "co.sos.trade_name",
        "co.vehicle_registration",
        "fed.1099_misc",
        "fed.1099_nec",
        "fed.1099k_reconcile",
        "fed.4562",
        "fed.4797",
        "fed.8300",
        "fed.estimated_tax",
        "fed.income.schedule_c",
        "fed.payroll.940",
        "fed.payroll.941",
        "fed.payroll.w2",
        "fed.usdot",
        "greeley.business_license",
      ].sort(),
    );
  });

  it("every period in 2026-2028 opens on or before its due date", () => {
    const rich = ctx({ employees: 2, sosReportMonth: 6, hasDepreciableAssets: true, hasAssetSales: true, truckGvwrLbs: 17000 });
    for (const o of OBLIGATIONS) {
      for (const year of [2026, 2027, 2028]) {
        for (const p of o.periods(year, rich)) {
          expect(p.opens.getTime(), `${o.key} ${p.periodKey}`).toBeLessThanOrEqual(p.dueOn.getTime());
          expect(p.periodKey.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("period dates", () => {
  it("estimated tax falls on the four federal dates", () => {
    expect(dueKeys("fed.estimated_tax", 2026)).toEqual([
      "2026-04-15",
      "2026-06-15",
      "2026-09-15",
      "2027-01-15",
    ]);
    expect(dueKeys("co.income.dr0104ep", 2027)).toEqual([
      "2027-04-15",
      "2027-06-15",
      "2027-09-15",
      "2028-01-15",
    ]);
  });

  it("the income tax return is due Apr 15 for an LLC owner and Mar 15 for a partnership or S-corp", () => {
    expect(dueKeys("fed.income.schedule_c", 2026)).toEqual(["2027-04-15"]);
    expect(dueKeys("fed.income.schedule_c", 2026, ctx({ entityType: "MULTI_MEMBER_LLC" }))).toEqual(["2027-03-15"]);
    expect(dueKeys("fed.income.schedule_c", 2026, ctx({ entityType: "S_CORP" }))).toEqual(["2027-03-15"]);
  });

  it("1099s are due the January after the payment year (NEC) and March 31 (MISC)", () => {
    expect(dueKeys("fed.1099_nec", 2026)).toEqual(["2027-01-31"]);
    expect(dueKeys("fed.1099_misc", 2026)).toEqual(["2027-03-31"]);
    expect(dueKeys("fed.1099k_reconcile", 2026)).toEqual(["2027-01-31"]);
  });

  it("the Weld declaration starts with the 2027 assessment, due April 15", () => {
    expect(obligationByKey("co.bpp.weld_declaration")!.periods(2026, base)).toEqual([]);
    const [p] = obligationByKey("co.bpp.weld_declaration")!.periods(2027, base);
    expect(key(p!.opens)).toBe("2027-01-02");
    expect(key(p!.dueOn)).toBe("2027-04-15");
  });

  it("the SOS window runs two months either side of the report month", () => {
    const may = obligationByKey("co.sos.periodic_report")!.periods(2027, ctx({ sosReportMonth: 5 }));
    expect(may).toHaveLength(1);
    expect(key(may[0]!.opens)).toBe("2027-03-01");
    expect(key(may[0]!.dueOn)).toBe("2027-07-31");
    const january = obligationByKey("co.sos.periodic_report")!.periods(2027, ctx({ sosReportMonth: 1 }));
    expect(key(january[0]!.opens)).toBe("2026-11-01");
    expect(key(january[0]!.dueOn)).toBe("2027-03-31");
    expect(obligationByKey("co.sos.periodic_report")!.periods(2027, base)).toEqual([]);
  });

  it("payroll 941 quarters end the month after each quarter", () => {
    expect(dueKeys("fed.payroll.941", 2026, ctx({ employees: 1 }))).toEqual([
      "2026-04-30",
      "2026-07-31",
      "2026-10-31",
      "2027-01-31",
    ]);
  });
});

describe("applies branches", () => {
  it("payroll stays dormant with no employees and wakes up with them", () => {
    for (const k of ["fed.payroll.941", "fed.payroll.940", "fed.payroll.w2", "co.payroll.withholding", "co.payroll.ui", "co.payroll.famli"]) {
      expect(obligationByKey(k)!.applies(base).applies, k).toBe(false);
      expect(obligationByKey(k)!.applies(ctx({ employees: 2 })).applies, k).toBe(true);
    }
  });

  it("USDOT follows the 16,001 lb line", () => {
    expect(obligationByKey("fed.usdot")!.applies(ctx({ truckGvwrLbs: 14000 })).applies).toBe(false);
    expect(obligationByKey("fed.usdot")!.applies(ctx({ truckGvwrLbs: 16001 })).applies).toBe(true);
    expect(obligationByKey("fed.usdot")!.applies(ctx({ truckGvwrLbs: null })).applies).toBe(false);
  });

  it("depreciation and sale forms follow the books facts", () => {
    expect(obligationByKey("fed.4562")!.applies(base).applies).toBe(false);
    expect(obligationByKey("fed.4562")!.applies(ctx({ hasDepreciableAssets: true })).applies).toBe(true);
    expect(obligationByKey("fed.4797")!.applies(base).applies).toBe(false);
    expect(obligationByKey("fed.4797")!.applies(ctx({ hasAssetSales: true })).applies).toBe(true);
  });

  it("Colorado estimates stop for an S-corp", () => {
    expect(obligationByKey("co.income.dr0104ep")!.applies(ctx({ entityType: "S_CORP" })).applies).toBe(false);
    expect(obligationByKey("co.income.dr0104ep")!.applies(base).applies).toBe(true);
  });

  it("Form 8300 is event-driven: it applies but has no calendar periods", () => {
    expect(obligationByKey("fed.8300")!.applies(base).applies).toBe(true);
    expect(obligationByKey("fed.8300")!.periods(2027, base)).toEqual([]);
  });
});

describe("checked and not needed", () => {
  it("lists BOI, rent-to-own and Form 2290 with reasons and sources", () => {
    const entries = notNeededObligations(base);
    const byKey = new Map(entries.map((e) => [e.key, e]));
    expect(byKey.get("fed.boi")!.reason).toMatch(/exempt/);
    expect(byKey.get("co.rent_to_own_license")!.reason).toMatch(/ownership option/);
    expect(byKey.get("fed.2290")!.reason).toMatch(/55,000/);
    for (const e of entries) expect(e.sourceUrl).toMatch(/^https:\/\//);
  });

  it("Form 2290 leaves the not-needed list for a truly heavy truck", () => {
    const entries = notNeededObligations(ctx({ truckGvwrLbs: 56000 }));
    expect(entries.map((e) => e.key)).not.toContain("fed.2290");
  });
});
