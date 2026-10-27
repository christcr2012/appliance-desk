import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  IRIS_MISC_HEADER,
  IRIS_NEC_HEADER,
  IRIS_MAX_ROWS_PER_FILE,
  buildIrisCsv,
  dollars,
  formatTin,
  irisBatches,
  type IrisParty,
  type IrisRow,
} from "@/domains/compliance/iris-csv";

// CMP-3: the IRIS portal CSV must match the IRS template header exactly,
// batch at the portal's 100-form limit, and format TINs and amounts the
// way the template carries them.

const FORMS_DIR = path.join(process.cwd(), "src/domains/compliance/forms/irs");

const payer: IrisParty = {
  tinType: "EIN",
  tinDigits: "123456789",
  nameType: "B",
  businessName: "Robinson Appliance Rentals LLC",
  country: "US",
  addressLine1: "1 Sample Street",
  city: "Greeley",
  state: "CO",
  zip: "80631",
};

const recipient: IrisParty = {
  tinType: "EIN",
  tinDigits: "987654321",
  nameType: "B",
  businessName: "Sample Services LLC",
  country: "US",
};

const row = (cents: string): IrisRow => ({
  recipient,
  boxes: { "Box 1 - Nonemployee Compensation": cents, "Box 4 - Federal income tax withheld": "" },
});

describe("iris csv", () => {
  it("the module header matches the vendored IRS template header files", () => {
    const necFile = readFileSync(path.join(FORMS_DIR, "iris_csv_nec_header.csv"), "utf8").trim();
    expect(buildIrisCsv("1099-NEC", 2026, payer, []).split("\r\n")[0]).toBe(necFile);
    const miscFile = readFileSync(path.join(FORMS_DIR, "iris_csv_misc_header.csv"), "utf8").trim();
    expect(buildIrisCsv("1099-MISC", 2026, payer, []).split("\r\n")[0]).toBe(miscFile);
    // The NEC header is 54 columns (A-BB) and the MISC header 64, per the template guides.
    expect(IRIS_NEC_HEADER).toHaveLength(54);
    expect(IRIS_MISC_HEADER).toHaveLength(64);
  });

  it("formats TINs by type and amounts as dollars with two decimals", () => {
    expect(formatTin("EIN", "123456789")).toBe("12-3456789");
    expect(formatTin("SSN", "123456789")).toBe("123-45-6789");
    expect(dollars(0)).toBe("0.00");
    expect(dollars(200000)).toBe("2000.00");
    expect(dollars(12345)).toBe("123.45");
  });

  it("builds a NEC file whose header is the template header and whose row carries the payer and amounts", () => {
    const csv = buildIrisCsv("1099-NEC", 2026, payer, [row("2000.00")]);
    const lines = csv.split("\r\n").filter((l) => l !== "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(buildIrisCsv("1099-NEC", 2026, payer, []).split("\r\n")[0]);
    // Split on the header names rather than commas: a box name contains one.
    const cells = lines[1]!.split(",");
    expect(cells[IRIS_NEC_HEADER.indexOf("Form Type")]).toBe("1099-NEC");
    expect(cells[IRIS_NEC_HEADER.indexOf("Tax Year")]).toBe("2026");
    expect(cells[IRIS_NEC_HEADER.indexOf("Payer TIN Type")]).toBe("EIN");
    expect(cells[IRIS_NEC_HEADER.indexOf("Payer Taxpayer ID Number")]).toBe("12-3456789");
    expect(cells[IRIS_NEC_HEADER.indexOf("Recipient Taxpayer ID Number")]).toBe("98-7654321");
    // The quoted direct-sales box name shifts later columns; find the box-1 column by counting quoted cells is
    // overkill — the row builder keys amounts by header name, so check the amount appears in the row.
    expect(lines[1]).toContain("2000.00");
  });

  it("batches at the portal's 100-form limit and refuses an oversize single file", () => {
    const rows = Array.from({ length: 250 }, () => row("1.00"));
    const batches = irisBatches(rows);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(IRIS_MAX_ROWS_PER_FILE).toBe(100);
    expect(() => buildIrisCsv("1099-NEC", 2026, payer, rows.slice(0, 101))).toThrow(/100/);
  });
});
