import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  fill1099MiscCopyB,
  fill1099NecCopyB,
  fillDr0104EpVoucher,
  fillEstimatedTaxVoucher,
  fillForm8300,
  fillW9,
  formManifest,
  verifyFormManifest,
} from "@/domains/compliance/pdf-forms";
import { F1040ES_VOUCHER_FIELDS } from "@/domains/compliance/forms/f1040es.fields";
import { NEC_COPY_B_FIELDS } from "@/domains/compliance/forms/f1099nec.fields";
import { MISC_COPY_B_FIELDS } from "@/domains/compliance/forms/f1099msc.fields";
import { W9_FIELDS } from "@/domains/compliance/forms/fw9.fields";
import { F8300_FIELDS } from "@/domains/compliance/forms/f8300.fields";

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

  it("the manifest covers the CMP-3 forms (1099-NEC, 1099-MISC, W-9, 8300, IRIS headers)", () => {
    const forms = formManifest().forms;
    for (const name of ["irs/f1099nec_2026.pdf", "irs/f1099msc_2026.pdf", "irs/fw9.pdf", "irs/f8300.pdf", "irs/iris_csv_nec_header.csv", "irs/iris_csv_misc_header.csv"]) {
      expect(forms[name], name).toBeTruthy();
      expect(forms[name]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("fills a 1099-NEC Copy B with the payer, recipient and box 1a", async () => {
    const bytes = await fill1099NecCopyB({
      year: 2026,
      payer: { name: "Robinson Appliance Rentals LLC", street: "1 Sample Street", city: "Greeley", state: "CO", zip: "80631", country: "US", tin: "12-3456789" },
      recipient: { name: "NEC Services LLC", tin: "98-7654321" },
      box1aDollars: "2500.00",
    });
    const form = (await PDFDocument.load(bytes)).getForm();
    const read = (name: string) => form.getTextField(name).getText() ?? "";
    expect(read(NEC_COPY_B_FIELDS.payerName)).toContain("Robinson");
    expect(read(NEC_COPY_B_FIELDS.recipientTin)).toBe("98-7654321");
    expect(read(NEC_COPY_B_FIELDS.box1a)).toBe("2500.00");
  });

  it("fills a 1099-MISC Copy B boxes 1 and 3", async () => {
    const bytes = await fill1099MiscCopyB({
      year: 2026,
      payer: { name: "Robinson Appliance Rentals LLC", tin: "12-3456789" },
      recipient: { name: "Rent Holdings LLC", tin: "98-7654321" },
      box1Dollars: "2100.00",
      box3Dollars: "300.00",
    });
    const form = (await PDFDocument.load(bytes)).getForm();
    const read = (name: string) => form.getTextField(name).getText() ?? "";
    expect(read(MISC_COPY_B_FIELDS.box1)).toBe("2100.00");
    expect(read(MISC_COPY_B_FIELDS.box3)).toBe("300.00");
  });

  it("fills a W-9 with the split EIN fields", async () => {
    const bytes = await fillW9({ legalName: "Sample Services LLC", tinType: "EIN", tinDigits: "123456789" });
    const form = (await PDFDocument.load(bytes)).getForm();
    const read = (name: string) => form.getTextField(name).getText() ?? "";
    expect(read(W9_FIELDS.legalName)).toBe("Sample Services LLC");
    expect(read(W9_FIELDS.ein1)).toBe("12");
    expect(read(W9_FIELDS.ein2)).toBe("3456789");
  });

  it("fills a Form 8300 draft with the cash total and the business block", async () => {
    const bytes = await fillForm8300({
      lastName: "Buyer",
      firstName: "Casey",
      dateReceived: "2026-06-01",
      totalCashDollars: "10500.00",
      businessName: "Robinson Appliance Rentals LLC",
      businessEin: "123456789",
    });
    const form = (await PDFDocument.load(bytes)).getForm();
    const read = (name: string) => form.getTextField(name).getText() ?? "";
    expect(read(F8300_FIELDS.lastName)).toBe("Buyer");
    expect(read(F8300_FIELDS.totalCash)).toBe("10500.00");
    expect(read(F8300_FIELDS.businessName)).toBe("Robinson Appliance Rentals LLC");
  });
});

describe("DR 0104EP voucher (CMP-2)", () => {
  it("the manifest lists the vendored DR 0104EP 2026 with its Colorado source", () => {
    const entry = formManifest().forms["co/dr0104ep_2026.pdf"];
    expect(entry).toBeTruthy();
    expect(entry!.source).toBe("https://tax.colorado.gov/sites/tax/files/documents/DR_0104EP_2026.pdf");
    expect(entry!.sha256).toBe("2b4e33fe2bdc4f5e3b324687f11ef7a0b22698673341a7a8b07764203946b12c");
  });

  it("fills the voucher identity and amount, readable back from the official fields", async () => {
    const bytes = await fillDr0104EpVoucher({ ...SAMPLE, middleInitial: "Q" });
    const pdf = await PDFDocument.load(bytes);
    const form = pdf.getForm();
    expect(form.getTextField("Last Name").getText()).toBe("Example");
    expect(form.getTextField("First Name").getText()).toBe("Casey");
    expect(form.getTextField("SSN or ITIN").getText()).toBe("000-00-1234");
    expect(form.getTextField("Amount of Payment").getText()).toBe("1250");
    expect(form.getTextField("ZIP Code").getText()).toBe("80631");
  });
});
