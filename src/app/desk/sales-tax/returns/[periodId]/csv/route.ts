import { requireRole } from "@/lib/session";
import { getPrivateReturn } from "@/domains/tax/returns-view";
import { toCsv } from "@/lib/csv";

type CsvRow = {
  kind: string; area: string; filingCode: string; grossCents: number;
  taxableCents: number; taxCents: number; remitCents: number; count: number;
};
const columns: Array<{ key: keyof CsvRow; header: string }> = [
  { key: "kind", header: "Return kind" }, { key: "area", header: "Tax area" },
  { key: "filingCode", header: "Filing code" }, { key: "grossCents", header: "Gross cents" },
  { key: "taxableCents", header: "Taxable cents" }, { key: "taxCents", header: "Tax cents" },
  { key: "remitCents", header: "Remit cents" }, { key: "count", header: "Count" },
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  await requireRole("OWNER", "ADMIN");
  const { periodId } = await params;
  const { period, result } = await getPrivateReturn(periodId);
  if (result.status !== "READY") {
    return new Response("Filing evidence not ready; export blocked.", {
      status: 409, headers: { "Cache-Control": "private, no-store" },
    });
  }
  const packet = result.packet;
  const rows: CsvRow[] = packet.rows.map(row => ({
    kind: "SALES_TAX", area: row.name, filingCode: row.filingCode ?? "",
    grossCents: row.grossSalesCents, taxableCents: row.netTaxableCents,
    taxCents: row.taxCents, remitCents: row.remitCents, count: 0,
  }));
  for (const row of packet.useTax) {
    rows.push({
      kind: "USE_TAX", area: row.name, filingCode: row.filingCode ?? "",
      grossCents: row.purchaseCents, taxableCents: row.purchaseCents,
      taxCents: row.useTaxCents, remitCents: row.useTaxCents, count: 0,
    });
  }
  for (const row of packet.rdf?.rows ?? []) {
    rows.push({
      kind: "RETAIL_DELIVERY_FEE", area: "Colorado", filingCode: "",
      grossCents: 0, taxableCents: 0,
      taxCents: row.totalCents, remitCents: row.totalCents, count: row.count,
    });
  }
  return new Response(toCsv(columns, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tax-return-' + period.id + '.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

