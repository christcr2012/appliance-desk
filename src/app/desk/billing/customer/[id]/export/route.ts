import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getCustomerStatement } from "@/domains/billing";
import { formatCentsAsPlainDecimal } from "@/domains/pricing/money";
import { toCsv } from "@/lib/csv";

/** One customer's combined statement as a CSV — every property, every
 * invoice, one row each, for Chris to email a property manager directly
 * or hand to a bookkeeper. Same shape/spirit as
 * src/app/desk/reports/export's accounting export (Task #73), scoped to
 * one customer instead of the whole business. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const statement = await getCustomerStatement(id);

  if (!statement) {
    notFound();
  }

  const rows = statement.properties.flatMap((property) =>
    property.invoices.map((invoice) => ({
      property: property.addressLabel,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      billingPeriodStart: invoice.billingPeriodStart
        ? invoice.billingPeriodStart.toISOString().slice(0, 10)
        : "",
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "",
      amountDue: formatCentsAsPlainDecimal(invoice.amountDueCents),
      amountPaid: formatCentsAsPlainDecimal(invoice.amountPaidCents),
      balance: formatCentsAsPlainDecimal(invoice.balanceCents),
      lateFee: formatCentsAsPlainDecimal(invoice.lateFeeCents),
    })),
  );

  const csv = toCsv(
    [
      { key: "property", header: "Property" },
      { key: "invoiceNumber", header: "Invoice #" },
      { key: "status", header: "Status" },
      { key: "billingPeriodStart", header: "Billing period" },
      { key: "dueDate", header: "Due date" },
      { key: "amountDue", header: "Amount due" },
      { key: "amountPaid", header: "Amount paid" },
      { key: "balance", header: "Balance owed" },
      { key: "lateFee", header: "Late fee included" },
    ],
    rows,
  );

  const fileSafeName = statement.customerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="statement-${fileSafeName}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
