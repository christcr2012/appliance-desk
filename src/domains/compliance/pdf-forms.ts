import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import manifest from "./forms/manifest.json";
import { F1040ES_VOUCHER_FIELDS, type VoucherFieldKey } from "./forms/f1040es.fields";

/**
 * CMP-1: the filled-official-form engine. Official PDFs are vendored under
 * forms/ and verified against the SHA-256 in forms/manifest.json before
 * anything is filled — if the IRS re-issues a form, the hash or the field
 * names stop the fill loudly instead of printing a wrong form. Filling
 * never signs and never submits: the owner reviews the filled form, prints
 * or uploads it, and approves in the app.
 */

export const COMPLIANCE_FORMS_DIR = path.join(process.cwd(), "src/domains/compliance/forms");

export class FormLayoutError extends Error {}

type Manifest = {
  forms: Record<string, { sha256: string; source: string; title: string; retrievedOn: string }>;
};

export function formManifest(): Manifest {
  return manifest as Manifest;
}

/** Verifies every vendored form against the manifest. Throws FormLayoutError. */
export function verifyFormManifest(dir = COMPLIANCE_FORMS_DIR): void {
  for (const [file, entry] of Object.entries(formManifest().forms)) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new FormLayoutError(`The official form file is missing: ${file}`);
    const hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (hash !== entry.sha256) {
      throw new FormLayoutError(
        `The official form ${file} does not match its recorded hash — it may have been re-issued. Re-vendor it and update the manifest.`,
      );
    }
  }
}

export interface VoucherValues {
  amountDollars: string;
  firstName: string;
  lastName: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Fills one 1040-ES payment voucher (quarter 1-4) in the official booklet.
 * Every mapped field is checked against the vendored PDF before anything
 * is written.
 */
export async function fillEstimatedTaxVoucher(
  quarter: 1 | 2 | 3 | 4,
  values: VoucherValues,
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  const file = "irs/f1040es_2026.pdf";
  const entry = formManifest().forms[file];
  if (!entry) throw new FormLayoutError("The 1040-ES form is not in the manifest.");
  const bytes = fs.readFileSync(path.join(dir, file));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.sha256) {
    throw new FormLayoutError("The official 1040-ES file does not match its recorded hash.");
  }
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const names = new Set(form.getFields().map((f) => f.getName()));
  const map = F1040ES_VOUCHER_FIELDS[quarter];
  for (const fieldName of Object.values(map)) {
    if (!names.has(fieldName)) {
      throw new FormLayoutError(
        `The official 1040-ES no longer has the field ${fieldName} — the form was re-issued; update the field map.`,
      );
    }
  }
  const byKey: Record<VoucherFieldKey, string> = {
    amount: values.amountDollars,
    firstName: values.firstName,
    lastName: values.lastName,
    ssn: values.ssn,
    address: values.address,
    city: values.city,
    state: values.state,
    zip: values.zip,
  };
  for (const [key, fieldName] of Object.entries(map) as Array<[VoucherFieldKey, string]>) {
    form.getTextField(fieldName).setText(byKey[key]);
  }
  return pdf.save();
}
