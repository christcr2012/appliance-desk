import { requireRole } from "@/lib/session";
import { getAccountingTransactions } from "@/domains/reports";
import { formatCentsAsPlainDecimal } from "@/domains/pricing/money";
import { businessDateKey } from "@/lib/business-date";
import { toCsv } from "@/lib/csv";

/** One row per real cash movement, oldest first, on the Batch-B ledger basis. */
export async function GET() {
  await requireRole("OWNER", "ADMIN");

  const transactions = await getAccountingTransactions();

  const csv = toCsv(
    [
      { key: "date", header: "Business date" },
      { key: "type", header: "Type" },
      { key: "receiptId", header: "Receipt ID" },
      { key: "source", header: "Source" },
      { key: "receivedOn", header: "Received business date" },
      { key: "customerName", header: "Customer" },
      { key: "companyName", header: "Company" },
      { key: "invoiceNumber", header: "Invoice #" },
      { key: "amount", header: "Amount" },
      { key: "methodOrReason", header: "Method / reason" },
      { key: "notes", header: "Notes" },
    ],
    transactions.map((transaction) => ({
      date: businessDateKey(transaction.date),
      type: transaction.type,
      receiptId: transaction.receiptId ?? "",
      source: transaction.source,
      receivedOn: businessDateKey(transaction.receivedOn),
      customerName: transaction.customerName,
      companyName: transaction.companyName,
      invoiceNumber: transaction.invoiceNumber ?? "",
      amount: formatCentsAsPlainDecimal(transaction.amountCents),
      methodOrReason: transaction.methodOrReason,
      notes: transaction.notes,
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${businessDateKey(new Date())}.csv"`,
    },
  });
}
