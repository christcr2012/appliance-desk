import { requireRole } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatBusinessDate } from "@/lib/business-date";
import { DataTable, EmptyState, InfoTip, ScreenHeader } from "@/components/kit";

export const metadata = { title: "Use-tax worksheets", robots: { index: false, follow: false } };

export default async function UseTaxWorksheetsPage({
  searchParams,
}: { searchParams: Promise<{ open?: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { open } = await searchParams;
  // The kit table's desktop row click sets ?open=<id> (its side-panel convention).
  // Worksheets have no side panel — the worksheet page IS the destination, as it
  // was before the redesign — so an ?open= link goes straight there.
  if (open) redirect(`/desk/sales-tax/use-tax/${encodeURIComponent(open)}`);
  const periods = await prisma.taxFilingPeriod.findMany({
    where: { filingAccount: { kind: "USE_TAX_RETURN" } },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      filingAccount: { select: { name: true } },
    },
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    take: 100,
  });
  type Row = (typeof periods)[number];
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-1.5">
        <ScreenHeader title="Use tax" />
        <span className="pt-1.5"><InfoTip term="use-tax" /></span>
      </div>
      <p className="text-sm text-ink-soft">
        What you owe on purchases when a seller did not charge Colorado tax.
      </p>
      <DataTable<Row>
        caption="Use-tax worksheets"
        rows={periods}
        rowKey={(period) => period.id}
        rowHref={(period) => `/desk/sales-tax/use-tax/${period.id}`}
        empty={<EmptyState title="No use-tax filing periods have been created yet" />}
        columns={[
          { key: "worksheet", header: "Worksheet", cell: (period) => period.filingAccount.name },
          { key: "period", header: "Period", cell: (period) => `${formatBusinessDate(period.periodStart)} – ${formatBusinessDate(period.periodEnd)}` },
          { key: "status", header: "Status", cell: (period) => period.status },
        ]}
        mobileCard={(period) => (
          <div className="space-y-1">
            <p className="font-semibold">{period.filingAccount.name}</p>
            <p className="text-sm text-muted-foreground">{formatBusinessDate(period.periodStart)} – {formatBusinessDate(period.periodEnd)} · {period.status}</p>
          </div>
        )}
      />
    </div>
  );
}
