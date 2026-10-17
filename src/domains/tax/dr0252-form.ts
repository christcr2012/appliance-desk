import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { FilingPacket } from "@/domains/tax/filing-packet";

export const DR0252_FORMS_DIR = path.join(process.cwd(), "src/domains/tax/forms");

/** Years for which an official blank DR 0252 is bundled (files named DR0252_<year>.pdf). */
export function availableDr0252Years(dir = DR0252_FORMS_DIR): number[] {
  try {
    return fs.readdirSync(dir)
      .map((name) => /^DR0252_(\d{4})\.pdf$/.exec(name)?.[1])
      .filter((year): year is string => Boolean(year))
      .map(Number).sort((a, b) => a - b);
  } catch { return []; }
}

/** The form for a return is the one for the year its period ends in; never a different year's layout. */
export function dr0252YearFor(periodEnd: string, years: number[]): number | null {
  const year = Number(periodEnd.slice(0, 4));
  return years.includes(year) ? year : null;
}

/** Years whose form should already be loaded: this year, and next year once December starts. */
export function dr0252YearsNeeded(todayKey: string): number[] {
  const year = Number(todayKey.slice(0, 4));
  return todayKey.slice(5, 7) === "12" ? [year, year + 1] : [year];
}

export function missingDr0252Years(todayKey: string, years = availableDr0252Years()): number[] {
  return dr0252YearsNeeded(todayKey).filter((year) => !years.includes(year));
}

const dollars = (cents: number) => String(Math.round(cents / 100));
const mmddyy = (key: string) => `${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(2, 4)}`;

/** Field names on the 2026 form (page 1 lines, page 2 header and total). Checked before anything is filled. */
const F = {
  purchaser: "Purchaser", business: "Business Name", date: "Date MMDDYY", account: "Acct Number",
  from: "Period Covered from", to: "Period Covered to",
  line1State: "State00.0", line2aState: "State00.1", line2bState: "State00.2",
  line5State: "4. Less Tax Credit.3.1", line8State: "4. Less Tax Credit.3.5",
  total: "fill_57",
  p2Name: "Name", p2Account: "Account Number", p2Total: "Amount1b Total from attachments",
} as const;

export class Dr0252LayoutError extends Error {}

/**
 * Fills the official blank DR 0252 with the numbers in the saved filing packet and returns the PDF bytes.
 * Never signs, never submits: the owner reviews, signs and files it. The paper form is in whole dollars, so amounts are
 * rounded to the nearest dollar here (Revenue Online accepts cents; use its amounts if they differ).
 * Only the State column is filled; the CD, RTD and ECD columns, signature, tax ID numbers and address stay blank.
 */
export async function fillDr0252(packet: FilingPacket, todayKey: string, dir = DR0252_FORMS_DIR): Promise<{ bytes: Uint8Array; year: number; stateColumnFilled: boolean }> {
  const year = dr0252YearFor(packet.periodEnd, availableDr0252Years(dir));
  if (year === null) throw new Dr0252LayoutError("The official form for this tax year is not loaded.");
  const pdf = await PDFDocument.load(fs.readFileSync(path.join(dir, `DR0252_${year}.pdf`)));
  const form = pdf.getForm();
  const names = new Set(form.getFields().map((field) => field.getName()));
  const missing = Object.values(F).filter((name) => !names.has(name));
  if (missing.length > 0) throw new Dr0252LayoutError("The official form's layout changed; fields not found: " + missing.join(", "));

  const set = (name: string, value: string) => form.getTextField(name).setText(value);
  set(F.purchaser, packet.account.name);
  set(F.business, packet.account.name);
  set(F.date, mmddyy(todayKey));
  if (packet.account.accountNumber) set(F.account, packet.account.accountNumber);
  set(F.from, mmddyy(packet.periodStart));
  set(F.to, mmddyy(packet.periodEnd));
  set(F.p2Name, packet.account.name);
  if (packet.account.accountNumber) set(F.p2Account, packet.account.accountNumber);

  const totalPurchases = packet.useTax.reduce((sum, row) => sum + row.purchaseCents, 0);
  const stateRow = packet.useTax.find((row) => /^(state of )?colorado( state)?$/i.test(row.name.trim()));
  if (stateRow) {
    set(F.line1State, dollars(stateRow.purchaseCents));
    set(F.line2aState, "0");
    set(F.line2bState, dollars(stateRow.purchaseCents));
    set(F.line5State, dollars(stateRow.useTaxCents));
    set(F.line8State, dollars(stateRow.useTaxCents));
    set(F.total, dollars(stateRow.useTaxCents));
    set(F.p2Total, dollars(stateRow.purchaseCents));
  } else if (totalPurchases === 0) {
    set(F.total, "0");
  }
  form.updateFieldAppearances();
  return { bytes: await pdf.save(), year, stateColumnFilled: Boolean(stateRow) };
}
