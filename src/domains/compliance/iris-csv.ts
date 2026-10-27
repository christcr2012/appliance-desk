/**
 * CMP-3 — the IRIS Taxpayer Portal CSV for 1099-NEC and 1099-MISC.
 *
 * The column order and names are the IRS template's, taken from the IRS
 * "1099-NEC Template Formatting" guide for the IRIS CSV templates (the
 * shared payer/recipient spine A–AK, the form's money boxes, then the
 * combined federal/state and state sections). The vendored header files
 * under forms/irs/ carry the same header row, and the test diffs this
 * module's header against them, so the two can never drift apart quietly.
 * One file holds one form type for one tax year, at most 100 rows (the
 * portal's batch limit from the compliance research file).
 *
 * Amounts are dollars with exactly two decimals. TINs are written in the
 * template's formats: EIN as XX-XXXXXXX, SSN as XXX-XX-XXXX. This file is
 * a filing output — it is produced only inside an approved filing's
 * preparation, never as a general export.
 */

export const IRIS_MAX_ROWS_PER_FILE = 100;

const SPINE = [
  "Form Type",
  "Tax Year",
  "Payer TIN Type",
  "Payer Taxpayer ID Number",
  "Payer Name Type",
  "Payer Business or Entity Name Line 1",
  "Payer Business or Entity Name Line 2",
  "Payer First Name",
  "Payer Middle Name",
  "Payer Last Name",
  "Payer Suffix",
  "Payer Country",
  "Payer Address Line 1",
  "Payer Address Line 2",
  "Payer City/Town",
  "Payer State/Province/Territory",
  "Payer ZIP/Postal Code",
  "Payer Phone Type",
  "Payer Phone",
  "Recipient TIN Type",
  "Recipient Taxpayer ID Number",
  "Recipient Name Type",
  "Recipient Business or Entity Name Line 1",
  "Recipient Business or Entity Name Line 2",
  "Recipient First Name",
  "Recipient Middle Name",
  "Recipient Last Name",
  "Recipient Suffix",
  "Recipient Country",
  "Recipient Address Line 1",
  "Recipient Address Line 2",
  "Recipient City/Town",
  "Recipient State/Province/Territory",
  "Recipient ZIP/Postal Code",
  "Office Code",
  "Form Account Number",
  "2nd TIN Notice",
] as const;

const STATE_TAIL = [
  "Combined Federal/State Filing (CF/SF)",
  "State 1",
  "State 1 - State Tax Withheld",
  "State 1 - State/Payer state number",
  "State 1 - State income",
  "State 1 - Local income tax withheld",
  "State 1 - Special Data Entries",
  "State 2",
  "State 2 - State Tax Withheld",
  "State 2 - State/Payer state number",
  "State 2 - State income",
  "State 2 - Local income tax withheld",
  "State 2 - Special Data Entries",
] as const;

export const IRIS_NEC_HEADER: string[] = [
  ...SPINE,
  "Box 1 - Nonemployee Compensation",
  "Box 2 - Payer made direct sales totaling $5,000 or more of consumer products to a recipient for resale",
  "Box 3 - Excess golden parachute payments",
  "Box 4 - Federal income tax withheld",
  ...STATE_TAIL,
];

export const IRIS_MISC_HEADER: string[] = [
  ...SPINE,
  "Box 1 - Rents",
  "Box 2 - Royalties",
  "Box 3 - Other income",
  "Box 4 - Federal income tax withheld",
  "Box 5 - Fishing boat proceeds",
  "Box 6 - Medical and health care payments",
  "Box 7 - Payer made direct sales totaling $5,000 or more of consumer products to a recipient for resale",
  "Box 8 - Substitute payments in lieu of dividends or interest",
  "Box 9 - Crop insurance proceeds",
  "Box 10 - Gross proceeds paid to an attorney",
  "Box 11 - Fish purchased for resale",
  "Box 12 - Section 409A deferrals",
  "Box 14 - Excess golden parachute payments",
  "Box 15 - Nonqualified deferred compensation",
  ...STATE_TAIL,
];

export interface IrisParty {
  tinType: "SSN" | "EIN";
  tinDigits: string;
  nameType: "B" | "I";
  businessName?: string;
  firstName?: string;
  lastName?: string;
  country: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

export interface IrisRow {
  recipient: IrisParty;
  accountNumber?: string;
  boxes: Record<string, string>;
}

export function formatTin(tinType: "SSN" | "EIN", digits: string): string {
  const d = digits.replace(/[^0-9]/g, "");
  if (tinType === "EIN") return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function partyCells(prefix: "Payer" | "Recipient", party: IrisParty, isPayer: boolean): Record<string, string> {
  const cells: Record<string, string> = {
    [`${prefix} TIN Type`]: party.tinType,
    [`${prefix} Taxpayer ID Number`]: formatTin(party.tinType, party.tinDigits),
    [`${prefix} Name Type`]: party.nameType,
    [`${prefix} Business or Entity Name Line 1`]: party.nameType === "B" ? (party.businessName ?? "") : "",
    [`${prefix} Business or Entity Name Line 2`]: "",
    [`${prefix} First Name`]: party.nameType === "I" ? (party.firstName ?? "") : "",
    [`${prefix} Middle Name`]: "",
    [`${prefix} Last Name`]: party.nameType === "I" ? (party.lastName ?? "") : "",
    [`${prefix} Suffix`]: "",
    [`${prefix} Country`]: party.country,
    [`${prefix} Address Line 1`]: party.addressLine1 ?? "",
    [`${prefix} Address Line 2`]: party.addressLine2 ?? "",
    [`${prefix} City/Town`]: party.city ?? "",
    [`${prefix} State/Province/Territory`]: party.state ?? "",
    [`${prefix} ZIP/Postal Code`]: party.zip ?? "",
  };
  if (isPayer) {
    cells["Payer Phone Type"] = party.phone ? "D" : "";
    cells["Payer Phone"] = party.phone ?? "";
  }
  return cells;
}

/** Builds one portal CSV (one form type, one year, at most 100 recipients). */
export function buildIrisCsv(form: "1099-NEC" | "1099-MISC", year: number, payer: IrisParty, rows: IrisRow[]): string {
  if (rows.length > IRIS_MAX_ROWS_PER_FILE) {
    throw new Error(`The IRIS portal takes at most ${IRIS_MAX_ROWS_PER_FILE} forms per file — split the batch.`);
  }
  const header = form === "1099-NEC" ? IRIS_NEC_HEADER : IRIS_MISC_HEADER;
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const cells: Record<string, string> = {
      "Form Type": form,
      "Tax Year": String(year),
      ...partyCells("Payer", payer, true),
      ...partyCells("Recipient", row.recipient, false),
      "Office Code": "",
      "Form Account Number": row.accountNumber ?? "",
      "2nd TIN Notice": "N",
      ...row.boxes,
    };
    lines.push(header.map((h) => csvCell(cells[h] ?? "")).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Splits recipients into portal-sized batches of at most 100. */
export function irisBatches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += IRIS_MAX_ROWS_PER_FILE) out.push(rows.slice(i, i + IRIS_MAX_ROWS_PER_FILE));
  return out;
}
