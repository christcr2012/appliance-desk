import { requireRole } from "@/lib/session";
import { getAccountingTransactions } from "@/domains/reports";
import { formatCentsAsPlainDecimal } from "@/domains/pricing/money";
import { toCsv } from "@/lib/csv";

/** Accounting export (Task #73) — every real payment, refund, and
 * security deposit movement, oldest first, as a generic CSV any
 * bookkeeping tool can import. See
 * src/domains/reports/accounting-export.ts for what "real money
 * movement" covers and why amounts are signed the way they are. */
export async function GET() {
  await requireRole("OWNER", "ADMIN");

  const transactions = await getAccountingTransactions();

  const csv = toCsv(
    [
      { key: "date", header: "Date" },
      { key: "type", header: "Type" },
      { key: "customerName", header: "Customer" },
      { key: "companyName", header: "Company" },
      { key: "invoiceNumber", header: "Invoice #" },
      { key: "amount", header: "Amount" },
      { key: "methodOrReason", header: "Method / reason" },
      { key: "notes", header: "Notes" },
    ],
    transactions.map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      type: t.type,
      customerName: t.customerName,
      companyName: t.companyName,
      invoiceNumber: t.invoiceNumber ?? "",
      amount: formatCentsAsPlainDecimal(t.amountCents),
      methodOrReason: t.methodOrReason,
      notes: t.notes,
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
