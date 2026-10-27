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

/**
 * The tax year of the vendored estimated-tax voucher booklets
 * (irs/f1040es_2026.pdf and co/dr0104ep_2026.pdf). CMP-2 review: a
 * filled voucher must never be produced for a different filing year —
 * callers refuse and point at the online payment routes instead. Bump
 * this when a new year's booklets are vendored.
 */
export const VOUCHER_BOOKLET_YEAR = 2026;

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

import { NEC_COPY_B_FIELDS } from "./forms/f1099nec.fields";
import { MISC_COPY_B_FIELDS } from "./forms/f1099msc.fields";
import { W9_FIELDS } from "./forms/fw9.fields";
import { F8300_FIELDS } from "./forms/f8300.fields";

/** Loads a vendored form after verifying its manifest hash; every mapped field name must exist. */
async function loadVerifiedForm(
  file: string,
  fieldNames: string[],
  dir = COMPLIANCE_FORMS_DIR,
): Promise<{ pdf: PDFDocument; form: ReturnType<PDFDocument["getForm"]> }> {
  const entry = formManifest().forms[file];
  if (!entry) throw new FormLayoutError(`The form ${file} is not in the manifest.`);
  const bytes = fs.readFileSync(path.join(dir, file));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.sha256) {
    throw new FormLayoutError(`The official form ${file} does not match its recorded hash.`);
  }
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const names = new Set(form.getFields().map((f) => f.getName()));
  for (const fieldName of fieldNames) {
    if (!names.has(fieldName)) {
      throw new FormLayoutError(
        `The official form ${file} no longer has the field ${fieldName} — the form was re-issued; update the field map.`,
      );
    }
  }
  return { pdf, form };
}

/** Shared fill: verify the vendored file's hash, check every mapped field exists, then set the given values. */
async function fillMappedForm(
  file: string,
  fieldMap: Record<string, string>,
  values: Record<string, string | undefined>,
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  const { pdf, form } = await loadVerifiedForm(file, Object.values(fieldMap), dir);
  for (const [key, fieldName] of Object.entries(fieldMap)) {
    const value = values[key];
    if (value !== undefined && value !== "") form.getTextField(fieldName).setText(value);
  }
  return pdf.save();
}

export interface PartyBlock {
  name: string;
  street?: string;
  suite?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  tin: string;
}

function partyValues(prefix: "payer" | "recipient", party: PartyBlock): Record<string, string | undefined> {
  return {
    [`${prefix}Name`]: party.name,
    [`${prefix}Street`]: party.street,
    [`${prefix}Suite`]: party.suite,
    [`${prefix}City`]: party.city,
    [`${prefix}State`]: party.state,
    [`${prefix}Country`]: party.country,
    [`${prefix}Zip`]: party.zip,
    [`${prefix}Tin`]: party.tin,
    ...(prefix === "payer" ? { payerPhone: party.phone } : {}),
  };
}

/** CMP-3: one recipient's filled 1099-NEC Copy B (the copy pages stay in the file; only Copy B is filled). */
export async function fill1099NecCopyB(
  input: { year: number; payer: PartyBlock; recipient: PartyBlock; box1aDollars: string; accountNumber?: string },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  return fillMappedForm(
    "irs/f1099nec_2026.pdf",
    NEC_COPY_B_FIELDS as unknown as Record<string, string>,
    {
      calendarYear: String(input.year),
      ...partyValues("payer", input.payer),
      ...partyValues("recipient", input.recipient),
      accountNumber: input.accountNumber,
      box1a: input.box1aDollars,
    },
    dir,
  );
}

/** CMP-3: one recipient's filled 1099-MISC Copy B (boxes 1 and 3). */
export async function fill1099MiscCopyB(
  input: { year: number; payer: PartyBlock; recipient: PartyBlock; box1Dollars?: string; box3Dollars?: string; accountNumber?: string },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  return fillMappedForm(
    "irs/f1099msc_2026.pdf",
    MISC_COPY_B_FIELDS as unknown as Record<string, string>,
    {
      calendarYear: String(input.year),
      ...partyValues("payer", input.payer),
      ...partyValues("recipient", input.recipient),
      accountNumber: input.accountNumber,
      box1: input.box1Dollars,
      box3: input.box3Dollars,
    },
    dir,
  );
}

/** CMP-3: the filled W-9 a supplier's typed answers produce (kept with their record). */
export async function fillW9(
  input: { legalName: string; businessName?: string; address?: string; cityStateZip?: string; tinType: "SSN" | "EIN"; tinDigits: string },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  const d = input.tinDigits;
  const split =
    input.tinType === "SSN"
      ? { ssn1: d.slice(0, 3), ssn2: d.slice(3, 5), ssn3: d.slice(5, 9) }
      : { ein1: d.slice(0, 2), ein2: d.slice(2, 9) };
  return fillMappedForm(
    "irs/fw9.pdf",
    W9_FIELDS as unknown as Record<string, string>,
    {
      legalName: input.legalName,
      businessName: input.businessName,
      address: input.address,
      cityStateZip: input.cityStateZip,
      ...split,
    },
    dir,
  );
}

/** CMP-3: a prefilled Form 8300 draft for the owner to check and file through BSA E-Filing. */
export async function fillForm8300(
  input: {
    lastName: string;
    firstName: string;
    middleInitial?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    dateReceived: string;
    totalCashDollars: string;
    businessName: string;
    businessEin?: string;
    businessAddress?: string;
    businessCity?: string;
    businessState?: string;
    businessZip?: string;
  },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  // The date-received field is an 8-box comb field: MMDDYYYY, no dashes.
  const digits = input.dateReceived.replace(/[^0-9]/g, "");
  const dateReceived =
    digits.length === 8 && input.dateReceived.includes("-")
      ? `${digits.slice(4, 6)}${digits.slice(6, 8)}${digits.slice(0, 4)}`
      : digits;
  return fillMappedForm(
    "irs/f8300.pdf",
    F8300_FIELDS as unknown as Record<string, string>,
    { ...input, dateReceived, totalCash: input.totalCashDollars },
    dir,
  );
}

import { DR0104EP_VOUCHER_FIELDS } from "./forms/dr0104ep.fields";

/**
 * CMP-2: fills the DR 0104EP payment voucher (page index 4 of the
 * vendored 2026 booklet). The identity values are the owner's, typed at
 * download time — nothing here stores them.
 */
export async function fillDr0104EpVoucher(
  values: VoucherValues & { middleInitial?: string },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  return fillMappedForm(
    "co/dr0104ep_2026.pdf",
    DR0104EP_VOUCHER_FIELDS as unknown as Record<string, string>,
    {
      lastName: values.lastName,
      firstName: values.firstName,
      middleInitial: values.middleInitial,
      ssn: values.ssn,
      address: values.address,
      city: values.city,
      state: values.state,
      zip: values.zip,
      amount: values.amountDollars,
    },
    dir,
  );
}

import { DS056_FIELDS, DS056_ROW_FIELDS } from "./forms/ds056.fields";
import { DS060_FIELDS, DS060_ROW_FIELDS } from "./forms/ds060.fields";

/** The business identity both Weld declaration schedules print. */
export interface DsIdentity {
  /** Legal name + mailing address, lines joined with \n. */
  mailing?: string;
  /** Business name + where the property sits. */
  propertyLocation?: string;
  productOrService?: string;
  county?: string;
  ownerName?: string;
  phone?: string;
}

export interface Ds056Row {
  itemId: string;
  quantity: string;
  description: string;
  yearAcquired: string;
  originalCost: string;
  placedInService: string;
}

/**
 * CMP-4: fills the DS 056 declaration schedule — the business identity,
 * the "new business" box for a first-time filer, and up to five item
 * rows (the form's Section D additions table). The FEIN/SSN field and
 * the signature are never filled: the owner writes and signs at filing.
 */
export async function fillDs056(
  input: { identity: DsIdentity; newBusiness: boolean; rows: Ds056Row[] },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  const rowFields = DS056_ROW_FIELDS.slice(0, input.rows.length);
  const names = [
    ...Object.values(DS056_FIELDS),
    ...rowFields.flatMap((row) => Object.values(row)),
  ];
  const { pdf, form } = await loadVerifiedForm("co/ds056.pdf", names, dir);
  const set = (fieldName: string, value: string | undefined) => {
    if (value !== undefined && value !== "") form.getTextField(fieldName).setText(value);
  };
  set(DS056_FIELDS.mailing, input.identity.mailing);
  set(DS056_FIELDS.propertyLocation, input.identity.propertyLocation);
  set(DS056_FIELDS.productOrService, input.identity.productOrService);
  set(DS056_FIELDS.county, input.identity.county);
  set(DS056_FIELDS.ownerName, input.identity.ownerName);
  set(DS056_FIELDS.phone, input.identity.phone);
  if (input.newBusiness) form.getCheckBox(DS056_FIELDS.newBusiness).check();
  input.rows.forEach((row, index) => {
    const fields = rowFields[index];
    set(fields.itemId, row.itemId);
    set(fields.quantity, row.quantity);
    set(fields.description, row.description);
    set(fields.yearAcquired, row.yearAcquired);
    set(fields.originalCost, row.originalCost);
    set(fields.placedInService, row.placedInService);
  });
  return pdf.save();
}

export interface Ds060Row {
  quantity: string;
  description: string;
  leaseTerm: string;
  monthlyRent: string;
  yearAcquired: string;
  originalCost: string;
  placedInService: string;
}

/**
 * CMP-4: fills the DS 060 lessor schedule — the business identity and
 * up to four rented-out rows. `singleRenter` fills the form's shared
 * user field only when every rented unit shares that one renter (see
 * the field map for why); the lease term column stays blank because the
 * rentals are month-to-month and the form asks for a from-to range.
 */
export async function fillDs060(
  input: { identity: DsIdentity; singleRenter?: string; rows: Ds060Row[] },
  dir = COMPLIANCE_FORMS_DIR,
): Promise<Uint8Array> {
  const rowFields = DS060_ROW_FIELDS.slice(0, input.rows.length);
  const names = [
    ...Object.values(DS060_FIELDS),
    ...rowFields.flatMap((row) => Object.values(row)),
  ];
  const { pdf, form } = await loadVerifiedForm("co/ds060.pdf", names, dir);
  const set = (fieldName: string, value: string | undefined) => {
    if (value !== undefined && value !== "") form.getTextField(fieldName).setText(value);
  };
  set(DS060_FIELDS.mailing, input.identity.mailing);
  set(DS060_FIELDS.propertyLocation, input.identity.propertyLocation);
  set(DS060_FIELDS.productOrService, input.identity.productOrService);
  set(DS060_FIELDS.county, input.identity.county);
  set(DS060_FIELDS.ownerName, input.identity.ownerName);
  set(DS060_FIELDS.phone, input.identity.phone);
  set(DS060_FIELDS.userShared, input.singleRenter);
  input.rows.forEach((row, index) => {
    const fields = rowFields[index];
    set(fields.quantity, row.quantity);
    set(fields.description, row.description);
    set(fields.leaseTerm, row.leaseTerm);
    set(fields.monthlyRent, row.monthlyRent);
    set(fields.yearAcquired, row.yearAcquired);
    set(fields.originalCost, row.originalCost);
    set(fields.placedInService, row.placedInService);
  });
  return pdf.save();
}
