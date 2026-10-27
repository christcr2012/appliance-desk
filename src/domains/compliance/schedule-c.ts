import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import systemChart from "@/domains/books/system-chart.json";

/**
 * CMP-2 — Schedule C mapping and the year's totals.
 *
 * Every books account lands on exactly one Schedule C line. System
 * accounts carry their line in the system chart (and in the
 * LedgerAccount.scheduleCLine column the CMP-2 migration filled from
 * it); an account with no mapping — an owner-added account, or one the
 * owner has not classified yet — falls back to line 27a, Other expenses,
 * listed by name in the packet. Nothing is ever dropped or guessed into
 * a more specific line.
 *
 * Year totals come from the posted journal lines of the tax year — the
 * same books the year-end package reads (src/domains/books/closing.ts).
 * Income counts credit minus debit, expenses debit minus credit, and
 * contra-income (discounts, credits given, refunds) debit minus credit
 * as the returns-and-allowances reduction.
 */

export interface ScheduleCLineInfo {
  line: string;
  label: string;
  kind: "income" | "reduction" | "otherIncome" | "expense";
}

export const SCHEDULE_C_LINES: ScheduleCLineInfo[] = [
  { line: "1", label: "Gross receipts or sales", kind: "income" },
  { line: "2", label: "Returns and allowances", kind: "reduction" },
  { line: "6", label: "Other income", kind: "otherIncome" },
  { line: "8", label: "Advertising", kind: "expense" },
  { line: "9", label: "Car and truck expenses", kind: "expense" },
  { line: "13", label: "Depreciation and Section 179 expense", kind: "expense" },
  { line: "15", label: "Insurance (other than health)", kind: "expense" },
  { line: "17", label: "Legal and professional services", kind: "expense" },
  { line: "18", label: "Office expense", kind: "expense" },
  { line: "20b", label: "Rent or lease — other business property", kind: "expense" },
  { line: "21", label: "Repairs and maintenance", kind: "expense" },
  { line: "22", label: "Supplies", kind: "expense" },
  { line: "23", label: "Taxes and licenses", kind: "expense" },
  { line: "25", label: "Utilities", kind: "expense" },
  { line: "27a", label: "Other expenses", kind: "expense" },
];

export const SCHEDULE_C_LINE_LABEL: Record<string, string> = Object.fromEntries(
  SCHEDULE_C_LINES.map((l) => [l.line, l.label]),
);

const CHART_LINES: Record<string, string> = {};
for (const account of systemChart.accounts as Array<{ role: string; scheduleCLine?: string }>) {
  if (account.scheduleCLine) CHART_LINES[account.role] = account.scheduleCLine;
}

/** The chart's line for a system role, or undefined when the role has none. */
export function chartScheduleCLine(systemRole: string | null | undefined): string | undefined {
  return systemRole ? CHART_LINES[systemRole] : undefined;
}

/** The line an account's totals land on: its stored line, else the chart's, else 27a. */
export function scheduleCLineFor(account: {
  scheduleCLine?: string | null;
  systemRole?: string | null;
}): string {
  return account.scheduleCLine ?? chartScheduleCLine(account.systemRole) ?? "27a";
}

export interface ScheduleCAccountTotal {
  name: string;
  systemRole: string | null;
  cents: number;
}

export interface ScheduleCLineTotal {
  line: string;
  label: string;
  cents: number;
  accounts: ScheduleCAccountTotal[];
}

export interface ScheduleCYear {
  year: number;
  lines: ScheduleCLineTotal[];
  grossReceiptsCents: number; // line 1
  returnsCents: number; // line 2
  otherIncomeCents: number; // line 6
  totalIncomeCents: number; // line 1 − line 2 + line 6 (the form's line 7, with no cost of goods)
  totalExpensesCents: number; // the form's line 28
  netProfitCents: number; // line 7 − line 28, before any home-office deduction (line 30)
}

export async function computeScheduleCYear(year: number): Promise<ScheduleCYear> {
  const start = businessDateFromKey(`${year}-01-01`);
  const end = businessDateFromKey(`${year + 1}-01-01`);
  if (!start || !end) throw new Error("That tax year could not be read.");
  const entries = await prisma.journalEntry.findMany({
    where: { entryDate: { gte: start, lt: end } },
    select: {
      lines: {
        select: {
          debitCents: true,
          creditCents: true,
          ledgerAccount: { select: { name: true, systemRole: true, type: true, scheduleCLine: true } },
        },
      },
    },
  });
  const byAccount = new Map<string, ScheduleCAccountTotal & { type: string; line: string }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = line.ledgerAccount;
      if (!["INCOME", "CONTRA_INCOME", "EXPENSE"].includes(account.type)) continue;
      const signed =
        account.type === "INCOME"
          ? line.creditCents - line.debitCents
          : line.debitCents - line.creditCents;
      const key = `${account.systemRole ?? account.name}`;
      const existing = byAccount.get(key);
      if (existing) existing.cents += signed;
      else
        byAccount.set(key, {
          name: account.name,
          systemRole: account.systemRole,
          cents: signed,
          type: account.type,
          line: scheduleCLineFor(account),
        });
    }
  }
  const lines: ScheduleCLineTotal[] = SCHEDULE_C_LINES.map((info) => ({
    line: info.line,
    label: info.label,
    cents: 0,
    accounts: [],
  }));
  const byLine = new Map(lines.map((l) => [l.line, l]));
  for (const total of byAccount.values()) {
    const bucket = byLine.get(total.line) ?? byLine.get("27a")!;
    bucket.cents += total.cents;
    bucket.accounts.push({ name: total.name, systemRole: total.systemRole, cents: total.cents });
  }
  for (const line of lines) line.accounts.sort((a, b) => a.name.localeCompare(b.name));
  const centsOf = (line: string) => byLine.get(line)?.cents ?? 0;
  const grossReceiptsCents = centsOf("1");
  const returnsCents = centsOf("2");
  const otherIncomeCents = centsOf("6");
  const totalExpensesCents = SCHEDULE_C_LINES.filter((l) => l.kind === "expense").reduce(
    (n, l) => n + centsOf(l.line),
    0,
  );
  const totalIncomeCents = grossReceiptsCents - returnsCents + otherIncomeCents;
  return {
    year,
    lines,
    grossReceiptsCents,
    returnsCents,
    otherIncomeCents,
    totalIncomeCents,
    totalExpensesCents,
    netProfitCents: totalIncomeCents - totalExpensesCents,
  };
}

/** One section of the packet CSV: a title row, a header row, then the rows. */
function csvSection(title: string, header: string[], rows: Array<Array<string | number>>): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [`# ${title}`, header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

export interface PacketData {
  year: number;
  scheduleC: ScheduleCYear;
  tieOut: import("./k-reconciliation").KTieOut;
  worksheet4562: import("./worksheets").Worksheet4562;
  worksheet4797: import("./worksheets").Worksheet4797;
  homeOffice: boolean;
}

/** The accountant packet as a CSV: Schedule C, the 1099-K tie-out, and both worksheets. */
export function packetCsv(packet: PacketData): string {
  const sections: string[] = [];
  const sc = packet.scheduleC;
  const scRows: Array<Array<string | number>> = [];
  for (const line of sc.lines) {
    scRows.push([`Line ${line.line}`, line.label, line.cents]);
    if (line.line === "27a" || line.accounts.length > 1) {
      for (const account of line.accounts) scRows.push(["", `  ${account.name}`, account.cents]);
    }
  }
  scRows.push(["Line 3", "Gross profit before other income (line 1 − line 2)", sc.grossReceiptsCents - sc.returnsCents]);
  scRows.push(["Line 7", "Total income", sc.totalIncomeCents]);
  scRows.push(["Line 28", "Total expenses", sc.totalExpensesCents]);
  scRows.push(["Line 29", "Tentative profit (before any home-office deduction)", sc.netProfitCents]);
  sections.push(csvSection(`Schedule C — ${packet.year} (amounts in cents)`, ["Schedule C line", "Label", "Amount cents"], scRows));

  const t = packet.tieOut;
  const tRows: Array<Array<string | number>> = t.months.map((m) => [
    m.month, m.chargesCents, m.feesCents, m.refundsCents, m.disputesCents, m.otherCents, m.netCents,
  ]);
  tRows.push(["Year total", t.chargesCents, t.feesCents, t.refundsCents, t.disputesCents, t.otherCents, t.netCents]);
  tRows.push(["1099-K box 1a (typed from Stripe's form)", t.reportedGrossCents ?? "not entered"]);
  tRows.push(["Difference (books charges − 1099-K)", t.differenceCents ?? ""]);
  sections.push(
    csvSection(
      "1099-K tie-out (amounts in cents)",
      ["Month", "Charges cents", "Fees cents", "Refunds cents", "Disputes cents", "Other cents", "Net cents"],
      tRows,
    ),
  );

  const w = packet.worksheet4562;
  sections.push(
    csvSection(
      "Form 4562 worksheet — estimate, your CPA confirms (amounts in cents)",
      ["Asset", "Placed in service", "Cost cents", "Section 179 cents", "Bonus cents", "Depreciation allowed cents", "Tax evidence"],
      w.rows.map((r) => [
        r.assetNumber, r.placedInServiceOn, r.costCents,
        r.section179Cents ?? "not recorded", r.bonusCents ?? "not recorded", r.allowedDepreciationCents ?? "not recorded",
        r.needsReview ? "CPA review needed" : r.confidence,
      ]),
    ),
  );
  const s = packet.worksheet4797;
  sections.push(
    csvSection(
      "Form 4797 worksheet — estimate, your CPA confirms (amounts in cents)",
      ["Asset", "Sale date", "Price cents", "Selling costs cents", "Adjusted basis cents", "Depreciation cents", "Gain cents", "Section 1245 recapture cents", "Other gain cents", "Status"],
      s.rows.map((r) => [
        r.assetNumber, r.saleDate, r.priceCents, r.sellerCostsCents,
        r.adjustedBasisCents ?? "not recorded", r.totalDepreciationCents ?? "not recorded",
        r.taxGainCents ?? "", r.potentialRecaptureCents ?? "", r.otherGainCents ?? "", r.statusLabel,
      ]),
    ),
  );
  if (packet.homeOffice) {
    sections.push(csvSection("Home office", ["Note"], [["The business facts say a home office is used. The simplified or regular method, and the amount, are worked out with the CPA — no amount is claimed here."]]));
  }
  return sections.join("\r\n\r\n") + "\r\n";
}

/** The same packet as a simple, printable PDF (pdf-lib, text pages). */
export async function packetPdf(packet: PacketData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const money = (c: number) => formatMoney(c);
  const text: Array<{ s: string; b?: boolean }> = [];
  const push = (s: string, b = false) => text.push({ s, b });
  push(`Accountant packet — ${packet.year}`, true);
  push("Robinson Appliance Rentals — prepared from the posted books. Estimates: your CPA confirms.");
  push("");
  push("Schedule C totals", true);
  for (const line of packet.scheduleC.lines) {
    push(`Line ${line.line} — ${line.label}: ${money(line.cents)}`);
    if (line.line === "27a") for (const a of line.accounts) push(`    ${a.name}: ${money(a.cents)}`);
  }
  push(`Total income (line 7): ${money(packet.scheduleC.totalIncomeCents)}`);
  push(`Total expenses (line 28): ${money(packet.scheduleC.totalExpensesCents)}`);
  push(`Tentative profit (line 29): ${money(packet.scheduleC.netProfitCents)}`);
  push("");
  push("1099-K tie-out", true);
  push(`Card charges in the books: ${money(packet.tieOut.chargesCents)}; fees ${money(packet.tieOut.feesCents)}; refunds ${money(packet.tieOut.refundsCents)}; disputes ${money(packet.tieOut.disputesCents)}.`);
  push(
    packet.tieOut.reportedGrossCents === null
      ? "The 1099-K amount has not been typed in yet (Business facts), so there is nothing to tie out against."
      : `1099-K box 1a typed from Stripe's form: ${money(packet.tieOut.reportedGrossCents)}; difference ${money(packet.tieOut.differenceCents ?? 0)}.`,
  );
  push("");
  push("Form 4562 worksheet — estimate, your CPA confirms", true);
  if (packet.worksheet4562.rows.length === 0) push("No appliances or equipment were placed in service this year.");
  for (const r of packet.worksheet4562.rows) {
    push(
      `${r.assetNumber} — in service ${r.placedInServiceOn}, cost ${money(r.costCents)}, Section 179 ${r.section179Cents === null ? "not recorded" : money(r.section179Cents)}, bonus ${r.bonusCents === null ? "not recorded" : money(r.bonusCents)}${r.needsReview ? " — CPA review needed" : ""}`,
    );
  }
  if (packet.worksheet4562.section179LimitCents !== null) {
    push(`Section 179 limit for the year (rule book): ${money(packet.worksheet4562.section179LimitCents)}; phase-out starts at ${money(packet.worksheet4562.section179PhaseoutCents ?? 0)}.`);
  }
  if (packet.worksheet4562.bonusPercent !== null) {
    push(`Bonus depreciation for the year (rule book): ${packet.worksheet4562.bonusPercent}% for property acquired after ${packet.worksheet4562.bonusAcquiredAfter}.`);
  }
  push("");
  push("Form 4797 worksheet — estimate, your CPA confirms", true);
  if (packet.worksheet4797.rows.length === 0) push("No retired appliances were sold this year.");
  for (const r of packet.worksheet4797.rows) {
    push(
      `${r.assetNumber} — sold ${r.saleDate} for ${money(r.priceCents)}; gain ${r.taxGainCents === null ? "not worked out" : money(r.taxGainCents)} (Section 1245 recapture ${r.potentialRecaptureCents === null ? "—" : money(r.potentialRecaptureCents)}). ${r.statusLabel}.`,
    );
  }
  if (packet.homeOffice) {
    push("");
    push("Home office", true);
    push("The business facts say a home office is used. The method and amount are worked out with the CPA.");
  }
  push("");
  push(`Prepared ${businessDateKey(new Date())}. Amounts tie to the approved filing numbers.`);

  let page = pdf.addPage();
  let y = 720;
  for (const line of text) {
    if (y < 60) {
      page = pdf.addPage();
      y = 720;
    }
    page.drawText(line.s.slice(0, 110), { x: 48, y, size: line.b ? 13 : 10.5, font: line.b ? bold : font });
    y -= line.b ? 20 : 15;
  }
  return pdf.save();
}
