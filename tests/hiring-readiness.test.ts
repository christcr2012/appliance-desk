import { describe, expect, it } from "vitest";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { newHirePeriods } from "@/domains/compliance/local-schedules";
import { hiringChecklist, type HiringChecklistInput } from "@/domains/compliance/hiring";
import {
  parsePayrollCsv,
  payrollMoneyToCents,
  payrollRowBalanceError,
  type PayrollCsvRow,
} from "@/domains/compliance/payroll-import";
import { obligationByKey, unscheduledObligations, type ComplianceContext } from "@/domains/compliance/registry";

// CMP-5 unit coverage: the new-hire schedule, the fact-driven hiring
// checklist, and the payroll CSV parser/balance rules. DB-backed import
// behavior lives in tests/payroll-import-integration.test.ts.

const day = (s: string) => businessDateFromKey(s)!;
const key = (d: Date) => businessDateKey(d);

const baseCtx: ComplianceContext = {
  entityType: "SINGLE_MEMBER_LLC",
  employees: 0,
  truckGvwrLbs: null,
  sosReportMonth: null,
  hasHomeOffice: false,
  hasEin: false,
  hasDepreciableAssets: false,
  hasAssetSales: false,
  tradeName: null,
  usdotNumber: null,
  truckRegistrationMonth: null,
  greeleyLicenseDate: null,
  firstHireDate: null,
};
const ctx = (patch: Partial<ComplianceContext>): ComplianceContext => ({ ...baseCtx, ...patch });

describe("new-hire report schedule (20 days)", () => {
  it("schedules one period in the hire year, due 20 days after the start", () => {
    const periods = newHirePeriods(2027, day("2027-03-02"));
    expect(periods).toHaveLength(1);
    expect(periods[0].periodKey).toBe("2027-03-02");
    expect(key(periods[0].opens)).toBe("2027-03-02");
    expect(key(periods[0].dueOn)).toBe("2027-03-22");
    expect(newHirePeriods(2026, day("2027-03-02"))).toEqual([]);
    expect(newHirePeriods(2028, day("2027-03-02"))).toEqual([]);
  });

  it("crosses month and leap-year boundaries on calendar days", () => {
    expect(key(newHirePeriods(2028, day("2028-02-20"))[0].dueOn)).toBe("2028-03-11");
    expect(key(newHirePeriods(2026, day("2026-12-25"))[0].dueOn)).toBe("2027-01-14");
  });

  it("invents no date without a recorded start", () => {
    expect(newHirePeriods(2027, null)).toEqual([]);
  });

  it("the registry obligation wakes with employees and stays unscheduled without the date", () => {
    const obligation = obligationByKey("co.payroll.new_hire")!;
    expect(obligation.applies(baseCtx).applies).toBe(false);
    expect(obligation.applies(ctx({ employees: 1 })).applies).toBe(true);
    const unscheduled = unscheduledObligations(ctx({ employees: 1 }), [2027]).map((e) => e.key);
    expect(unscheduled).toContain("co.payroll.new_hire");
    const scheduled = unscheduledObligations(ctx({ employees: 1, firstHireDate: day("2027-03-02") }), [2027]).map(
      (e) => e.key,
    );
    expect(scheduled).not.toContain("co.payroll.new_hire");
  });
});

const checklistInput = (patch: Partial<HiringChecklistInput>): HiringChecklistInput => ({
  employees: 1,
  hasEin: false,
  firstHireDate: day("2027-03-02"),
  newHireFiling: { state: "UPCOMING", dueOn: day("2027-03-22") },
  ...patch,
});

describe("hiring checklist", () => {
  it("stays hidden with no employees", () => {
    expect(hiringChecklist(checklistInput({ employees: 0 }))).toBeNull();
  });

  it("carries every spec item with links and the computed new-hire date", () => {
    const items = hiringChecklist(checklistInput({}))!;
    expect(items.map((i) => i.key)).toEqual([
      "ein",
      "w4",
      "i9",
      "new_hire",
      "co_withholding",
      "ui_account",
      "famli",
      "workers_comp",
      "posters",
      "sick_leave",
    ]);
    const newHire = items.find((i) => i.key === "new_hire")!;
    expect(newHire.state).toBe("todo");
    expect(newHire.dueText).toContain("Mar 22, 2027");
    expect(newHire.links[0].url).toBe("https://childsupport.state.co.us/new-hire-reporting");
    for (const item of items) {
      expect(item.what.length, item.key).toBeGreaterThan(30);
    }
  });

  it("derives done states from facts and filings, never from ticks", () => {
    const items = hiringChecklist(
      checklistInput({ hasEin: true, newHireFiling: { state: "SUBMITTED", dueOn: day("2027-03-22") } }),
    )!;
    expect(items.find((i) => i.key === "ein")!.state).toBe("done");
    expect(items.find((i) => i.key === "new_hire")!.state).toBe("done");
    const noDate = hiringChecklist(checklistInput({ firstHireDate: null, newHireFiling: null }))!;
    expect(noDate.find((i) => i.key === "new_hire")!.dueText).toContain("add the date in Business facts");
  });
});

describe("payroll CSV parsing", () => {
  it("parses dollars to cents strictly", () => {
    expect(payrollMoneyToCents("1234.56")).toBe(123456);
    expect(payrollMoneyToCents("1234.5")).toBe(123450);
    expect(payrollMoneyToCents("2000")).toBe(200000);
    expect(payrollMoneyToCents("$42.00")).toBe(4200);
    expect(payrollMoneyToCents("12.345")).toBeNull();
    expect(payrollMoneyToCents("-5.00")).toBeNull();
    expect(payrollMoneyToCents("abc")).toBeNull();
    expect(payrollMoneyToCents("")).toBeNull();
  });

  it("parses a full file with the optional columns", () => {
    const rows = parsePayrollCsv(
      [
        "pay_date,gross_wages,employer_taxes,employee_taxes,amount_withdrawn,provider",
        "2026-05-15,2000.00,153.00,300.00,1853.00,Test Payroll Co",
        "2026-05-29,2000.00,153.00,300.00,1853.00,Test Payroll Co",
      ].join("\n"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowIndex: 0,
      payDateKey: "2026-05-15",
      grossWagesCents: 200000,
      employerTaxesCents: 15300,
      employeeTaxesCents: 30000,
      withdrawnCents: 185300,
      providerName: "Test Payroll Co",
    });
  });

  it("refuses a missing column, a bad date, a bad amount and a quoted-comma file — by line", () => {
    expect(() => parsePayrollCsv("pay_date,gross_wages\n2026-05-15,2000.00")).toThrow(/missing the "employer_taxes" column/);
    expect(() =>
      parsePayrollCsv("pay_date,gross_wages,employer_taxes,amount_withdrawn\n2026-02-30,2000.00,153.00,2153.00"),
    ).toThrow(/Line 2/);
    expect(() =>
      parsePayrollCsv("pay_date,gross_wages,employer_taxes,amount_withdrawn\n2026-05-15,lots,153.00,2153.00"),
    ).toThrow(/Line 2: "lots" is not an amount/);
    expect(() =>
      parsePayrollCsv('pay_date,gross_wages,employer_taxes,amount_withdrawn\n2026-05-15,"2,000.00",153.00,2153.00'),
    ).toThrow(/quotes/);
    expect(() => parsePayrollCsv("pay_date,gross_wages,employer_taxes,amount_withdrawn")).toThrow(/no pay runs/);
    expect(() =>
      parsePayrollCsv("pay_date,gross_wages,employer_taxes,amount_withdrawn\n2026-05-15,0.00,0.00,0.00"),
    ).toThrow(/gross wages must be more than zero/);
  });
});

describe("payroll row balance", () => {
  const row = (patch: Partial<PayrollCsvRow>): PayrollCsvRow => ({
    rowIndex: 0,
    payDateKey: "2026-05-15",
    grossWagesCents: 200000,
    employerTaxesCents: 15300,
    employeeTaxesCents: null,
    withdrawnCents: 215300,
    providerName: null,
    ...patch,
  });

  it("balances on gross plus employer taxes; the employee share rides inside the gross", () => {
    expect(payrollRowBalanceError(row({}))).toBeNull();
    expect(payrollRowBalanceError(row({ employeeTaxesCents: 30000 }))).toBeNull();
    // Net pay plus employer taxes only (1853.00) would leave the employee
    // share unaccounted for — the provider's one withdrawal covers it.
    expect(payrollRowBalanceError(row({ employeeTaxesCents: 30000, withdrawnCents: 185300 }))).toMatch(
      /does not add up/,
    );
  });

  it("names the mismatch in plain words", () => {
    expect(payrollRowBalanceError(row({ withdrawnCents: 200000 }))).toMatch(/does not add up/);
    expect(payrollRowBalanceError(row({ employeeTaxesCents: 250000 }))).toMatch(/higher than the gross wages/);
  });
});
