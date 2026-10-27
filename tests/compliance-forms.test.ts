import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fillEstimatedTaxVoucher, formManifest, verifyFormManifest } from "@/domains/compliance/pdf-forms";
import { F1040ES_VOUCHER_FIELDS } from "@/domains/compliance/forms/f1040es.fields";

// CMP-1: the filled-form engine — vendored official PDFs are hash-checked
// against the manifest, every mapped field must exist in the PDF, and a
// filled voucher reads back the values in the right quarter's block only.

const SAMPLE = {
  amountDollars: "1250",
  firstName: "Casey",
  lastName: "Example",
  ssn: "000-00-1234",
  address: "1 Sample Street",
  city: "Greeley",
  state: "CO",
  zip: "80631",
};

describe("compliance forms", () => {
  it("the manifest lists the vendored 1040-ES with its source", () => {
    const entry = formManifest().forms["irs/f1040es_2026.pdf"];
    expect(entry).toBeTruthy();
    expect(entry!.source).toBe("https://www.irs.gov/pub/irs-pdf/f1040es.pdf");
    expect(entry!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => verifyFormManifest()).not.toThrow();
  });

  it("every mapped voucher field exists in the official PDF", async () => {
    const bytes = await fillEstimatedTaxVoucher(1, SAMPLE);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("fills the requested quarter's voucher and no other", async () => {
    const bytes = await fillEstimatedTaxVoucher(1, SAMPLE);
    const pdf = await PDFDocument.load(bytes);
    const form = pdf.getForm();
    const read = (name: string) => form.getTextField(name).getText() ?? "";
    expect(read(F1040ES_VOUCHER_FIELDS[1].ssn)).toBe("000-00-1234");
    expect(read(F1040ES_VOUCHER_FIELDS[1].amount)).toBe("1250");
    expect(read(F1040ES_VOUCHER_FIELDS[1].city)).toBe("Greeley");
    // The other quarters stay blank.
    expect(read(F1040ES_VOUCHER_FIELDS[2].ssn)).toBe("");
    expect(read(F1040ES_VOUCHER_FIELDS[3].ssn)).toBe("");
    expect(read(F1040ES_VOUCHER_FIELDS[4].ssn)).toBe("");

    const q4 = await fillEstimatedTaxVoucher(4, { ...SAMPLE, amountDollars: "900" });
    const form4 = (await PDFDocument.load(q4)).getForm();
    expect(form4.getTextField(F1040ES_VOUCHER_FIELDS[4].amount).getText()).toBe("900");
    expect(form4.getTextField(F1040ES_VOUCHER_FIELDS[1].amount).getText() ?? "").toBe("");
  });
});
