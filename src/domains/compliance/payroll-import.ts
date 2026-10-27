import { createHash } from "node:crypto";
import type { PayrollImport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { writeJournal } from "@/domains/books/post";
import type { PostingLine } from "@/domains/books/posting-rules";

/**
 * CMP-5: import a payroll provider's summary CSV into the books. DQ-…:
 * payroll runs through a service (DQ-CMP-PAYROLL-HOW, starting value);
 * this import is how its totals land in the books so Schedule C and the
 * Form 941 numbers tie out. One journal per pay run, posted through the
 * books engine: wages (gross) and the business's payroll-tax share are
 * expenses; the credit is the bank withdrawal the provider took (net pay
 * plus every tax it remits). Provider totals only — a file containing
 * employee-level detail does not belong here and is never stored.
 *
 * Expected header (first row), columns in any order:
 *   pay_date, gross_wages, employer_taxes, amount_withdrawn
 *   [, employee_taxes] [, provider]
 * Amounts are dollars ("1234.56", "$1,234.56" both fine). A full-service
 * provider withdraws one amount covering the net pay plus every tax it
 * remits — the employees' share comes out of the gross, so each row
 * must balance exactly:
 *   gross + employer taxes = amount withdrawn.
 * (employee_taxes is informational: it is part of the gross, never an
 * extra amount on top. A provider that leaves the business to remit
 * the employee share itself does not fit this import.)
 */

export interface PayrollCsvRow {
  /** 0-based index among data rows; part of the duplicate guard. */
  rowIndex: number;
  payDateKey: string;
  grossWagesCents: number;
  employerTaxesCents: number;
  employeeTaxesCents: number | null;
  withdrawnCents: number;
  providerName: string | null;
}

const REQUIRED_COLUMNS = ["pay_date", "gross_wages", "employer_taxes", "amount_withdrawn"] as const;

/** Strict dollars-to-cents: optional $, thousands commas, at most 2 decimals, never negative. */
export function payrollMoneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function parsePayrollCsv(text: string): PayrollCsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    throw new Error("The file has no pay runs in it. Expected a header row and at least one pay run.");
  }
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(
        `The file is missing the "${column}" column. Expected columns: pay_date, gross_wages, employer_taxes, amount_withdrawn (plus optional employee_taxes and provider).`,
      );
    }
  }
  const at = (cells: string[], column: string) => cells[header.indexOf(column)]?.trim() ?? "";

  const rows: PayrollCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = lines[i].split(",");
    // Amounts may carry thousands commas inside quotes in real exports;
    // a naive split then yields the wrong cell count — refuse plainly
    // rather than mis-post a number.
    if (cells.length !== header.length) {
      throw new Error(
        `Line ${lineNo} has ${cells.length} values but the header has ${header.length}. If amounts use commas inside quotes, remove the quotes and commas and try again.`,
      );
    }
    const payDateKey = at(cells, "pay_date");
    if (!businessDateFromKey(payDateKey)) {
      throw new Error(`Line ${lineNo}: the pay date "${payDateKey}" is not a date like 2026-05-01.`);
    }
    const money = (column: string): number => {
      const value = payrollMoneyToCents(at(cells, column));
      if (value === null) {
        throw new Error(`Line ${lineNo}: "${at(cells, column)}" is not an amount like 1234.56.`);
      }
      return value;
    };
    const grossWagesCents = money("gross_wages");
    if (grossWagesCents <= 0) {
      throw new Error(`Line ${lineNo}: gross wages must be more than zero.`);
    }
    rows.push({
      rowIndex: i - 1,
      payDateKey,
      grossWagesCents,
      employerTaxesCents: money("employer_taxes"),
      employeeTaxesCents: header.includes("employee_taxes") ? money("employee_taxes") : null,
      withdrawnCents: money("amount_withdrawn"),
      providerName: header.includes("provider") ? at(cells, "provider") || null : null,
    });
  }
  return rows;
}

/** Why a row cannot post, or null when its numbers balance. */
export function payrollRowBalanceError(row: PayrollCsvRow): string | null {
  if (row.employeeTaxesCents !== null && row.employeeTaxesCents > row.grossWagesCents) {
    return `The ${row.payDateKey} pay run shows employee taxes higher than the gross wages, which cannot be right. Fix the file and try again — nothing was posted.`;
  }
  const expected = row.grossWagesCents + row.employerTaxesCents;
  if (expected === row.withdrawnCents) return null;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return `The ${row.payDateKey} pay run does not add up: gross ${dollars(row.grossWagesCents)} plus employer taxes ${dollars(row.employerTaxesCents)} is ${dollars(expected)}, but the amount withdrawn is ${dollars(row.withdrawnCents)}. The withdrawal should be the one amount the provider took to cover net pay and every tax it remits. Nothing was posted.`;
}

export async function importPayrollCsv(
  actorId: string,
  text: string,
  fileName: string | null,
): Promise<{ imported: number }> {
  const rows = parsePayrollCsv(text);
  for (const row of rows) {
    const error = payrollRowBalanceError(row);
    if (error) throw new Error(error);
  }
  const fileHash = createHash("sha256").update(text, "utf8").digest("hex");

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const settings = await tx.businessSettings.findFirst({ select: { booksStartDate: true } });
    if (!settings?.booksStartDate) {
      throw new Error("The books are not started yet. Finish the Books setup first, then import payroll.");
    }
    const booksStartKey = businessDateKey(settings.booksStartDate);
    for (const row of rows) {
      if (row.payDateKey < booksStartKey) {
        throw new Error(
          `The ${row.payDateKey} pay run is before the books start date (${booksStartKey}), so it cannot be posted. Remove it from the file and try again.`,
        );
      }
    }
    const already = await tx.payrollImport.findFirst({ where: { fileHash }, select: { id: true } });
    if (already) {
      throw new Error("This file was already imported — nothing was posted twice.");
    }
    for (const row of rows) {
      const record = await tx.payrollImport.create({
        data: {
          fileHash,
          rowIndex: row.rowIndex,
          payDate: businessDateFromKey(row.payDateKey)!,
          grossWagesCents: row.grossWagesCents,
          employerTaxesCents: row.employerTaxesCents,
          employeeTaxesCents: row.employeeTaxesCents,
          withdrawnCents: row.withdrawnCents,
          providerName: row.providerName,
          sourceFileName: fileName,
          importedById: actorId,
        },
      });
      const lines: PostingLine[] = [
        { role: "WAGES", debitCents: row.grossWagesCents, creditCents: 0 },
        ...(row.employerTaxesCents > 0
          ? [{ role: "EMPLOYER_PAYROLL_TAXES", debitCents: row.employerTaxesCents, creditCents: 0 } as PostingLine]
          : []),
        { role: "BANK", debitCents: 0, creditCents: row.withdrawnCents },
      ];
      await writeJournal(tx, "PAYROLL", record.id, "PAYROLL_POSTED", {
        entryDate: businessDateFromKey(row.payDateKey)!,
        memo: `Payroll ${row.payDateKey}${row.providerName ? ` via ${row.providerName}` : ""} (imported${fileName ? ` from ${fileName}` : ""})`,
        lines,
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.payroll_import",
        entityType: "PayrollImport",
        entityId: fileHash.slice(0, 16),
        newValue: { rows: rows.length, fileName },
      },
    });
    return { imported: rows.length };
  });
}

export async function listPayrollImports(limit = 12): Promise<PayrollImport[]> {
  return prisma.payrollImport.findMany({ orderBy: [{ payDate: "desc" }, { createdAt: "desc" }], take: limit });
}
