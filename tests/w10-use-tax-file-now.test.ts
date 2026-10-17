import { describe, expect, it } from "vitest";
import { buildUseTaxFileNow, REVENUE_ONLINE_URL } from "../src/domains/tax/use-tax-file-now";
import type { FilingPacket } from "../src/domains/tax/filing-packet";

const packet = (overrides: Partial<FilingPacket> = {}): FilingPacket => ({
  account: { id: "a", name: "Robinson Appliance Rentals", kind: "USE_TAX_RETURN", accountNumber: "12345", portalUrl: null },
  periodStart: "2026-09-01", periodEnd: "2026-09-30", dueOn: "2026-10-20", legalDueOn: "2026-10-20",
  basis: "ACCRUAL", zeroReturn: false, rows: [],
  useTax: [
    { jurisdictionId: "co", name: "Colorado state", filingCode: null, purchaseCents: 100000, useTaxCents: 2900 },
    { jurisdictionId: "gr", name: "Greeley", filingCode: "GR1", purchaseCents: 100000, useTaxCents: 4600 },
  ],
  totals: { taxCents: 7500, serviceFeeCents: 0, remitIfOnTimeCents: 7500, remitIfLateCents: 7500, remitCents: 7500 },
  steps: [], warnings: [], ...overrides,
});
const flat = (steps: ReturnType<typeof buildUseTaxFileNow>) => steps.flatMap((s) => s.items);

describe("use-tax File now steps (W-10)", () => {
  it("lists the form lines in order with values taken only from the packet", () => {
    const steps = buildUseTaxFileNow(packet());
    expect(steps.map((s) => s.title)).toEqual(["Who and when", "Line 1: what you bought", "Lines 3 to 5: the tax for each area", "Lines 6 to 9: penalty, interest and the total"]);
    const items = flat(steps);
    expect(items.find((i) => i.label === "Account number")?.value).toBe("12345");
    expect(items.find((i) => i.label.startsWith("Period covered"))?.value).toBe("09/26-09/26");
    expect(items.find((i) => i.label.startsWith("Line 1,"))?.value).toBe("$2,000.00");
    expect(items.find((i) => i.label === "Colorado state: net tax due (line 5)")?.value).toBe("$29.00");
    expect(items.find((i) => i.label === "Colorado state: tax rate (line 3)")?.value).toBe("2.9%");
    expect(items.find((i) => i.label === "Greeley: tax rate (line 3)")?.value).toBe("4.6%");
    expect(items.find((i) => i.label.startsWith("Line 9"))?.value).toBe("$75.00");
  });
  it("says a period with nothing owed still gets filed", () => {
    const steps = buildUseTaxFileNow(packet({ useTax: [], totals: { taxCents: 0, serviceFeeCents: 0, remitIfOnTimeCents: 0, remitIfLateCents: 0, remitCents: 0 } }));
    expect(flat(steps).find((i) => i.label === "Nothing owed this period")?.hint).toContain("still wants a return");
    expect(flat(steps).find((i) => i.label.startsWith("Line 9"))?.value).toBe("$0.00");
  });
  it("omits the account number when none is saved and refuses other return kinds", () => {
    expect(flat(buildUseTaxFileNow(packet({ account: { ...packet().account, accountNumber: null } }))).some((i) => i.label === "Account number")).toBe(false);
    expect(() => buildUseTaxFileNow(packet({ account: { ...packet().account, kind: "SALES_RETURN" } }))).toThrow();
  });
  it("points at Colorado's own https website", () => {
    expect(REVENUE_ONLINE_URL.startsWith("https://www.colorado.gov/")).toBe(true);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { availableDr0252Years, dr0252YearFor, dr0252YearsNeeded, fillDr0252, missingDr0252Years, Dr0252LayoutError } from "../src/domains/tax/dr0252-form";

describe("the right year's official DR 0252 (W-10)", () => {
  it("picks the form by the year the period ends in and never another year's layout", () => {
    expect(dr0252YearFor("2026-12-31", [2026])).toBe(2026);
    expect(dr0252YearFor("2027-01-31", [2026])).toBeNull();
    expect(availableDr0252Years()).toContain(2026);
  });
  it("asks for next year's form from December on", () => {
    expect(dr0252YearsNeeded("2026-11-30")).toEqual([2026]);
    expect(dr0252YearsNeeded("2026-12-01")).toEqual([2026, 2027]);
    expect(missingDr0252Years("2026-12-01", [2026])).toEqual([2027]);
    expect(missingDr0252Years("2026-10-17", [2026])).toEqual([]);
  });
  it("fills the real 2026 form with the packet's numbers and leaves signature and tax IDs blank", async () => {
    const filled = await fillDr0252(packet(), "2026-10-17");
    expect(filled.year).toBe(2026);
    expect(filled.stateColumnFilled).toBe(true);
    const form = (await PDFDocument.load(filled.bytes)).getForm();
    const text = (name: string) => form.getTextField(name).getText();
    expect(text("Business Name")).toBe("Robinson Appliance Rentals");
    expect(text("Acct Number")).toBe("12345");
    expect(text("Period Covered from")).toBe("09/01/26");
    expect(text("Period Covered to")).toBe("09/30/26");
    expect(text("State00.0")).toBe("1000");
    expect(text("State00.1")).toBe("0");
    expect(text("State00.2")).toBe("1000");
    expect(text("4. Less Tax Credit.3.1")).toBe("29");
    expect(text("fill_57")).toBe("29");
    expect(text("FEIN")).toBeUndefined();
    expect(text("SSN")).toBeUndefined();
  });
  it("refuses a redesigned form instead of filling the wrong boxes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forms-"));
    const blank = await PDFDocument.create(); blank.addPage(); blank.getForm().createTextField("Something else");
    fs.writeFileSync(path.join(dir, "DR0252_2026.pdf"), await blank.save());
    await expect(fillDr0252(packet(), "2026-10-17", dir)).rejects.toThrow(Dr0252LayoutError);
  });
  it("says so when no form is loaded for the year", async () => {
    await expect(fillDr0252(packet({ periodEnd: "2031-01-31" }), "2031-02-01")).rejects.toThrow(/not loaded/);
  });
});
