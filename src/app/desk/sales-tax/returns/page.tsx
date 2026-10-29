import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { DataTable, EmptyState, InfoTip, ScreenHeader } from "@/components/kit";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function FilingReturnsPage({
  searchParams,
}: { searchParams: Promise<{ cursor?: string }> }) {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const { cursor } = await searchParams;
  if (cursor && !/^[A-Za-z0-9_-]{5,128}$/.test(cursor)) notFound();
  const records = await prisma.taxFilingPeriod.findMany({
    take: 26,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    include: {
      filingAccount: { select: { name: true, kind: true, basis: true } },
      amendments: { select: { id: true, status: true }, where: { status: "OPEN" }, take: 1 },
    },
  });
  const rows = records.slice(0, 25);
  type Row = (typeof rows)[number];
  const status = (row: Row) =>
    `${row.status === "FILED" ? `Filed ${row.filedOn ? day(row.filedOn) : ""}` : "Not yet filed"}${row.amendments.length > 0 ? " · Amendment needs review" : ""}`;
  return <main className="space-y-5">
    <div className="flex items-start gap-1.5">
      <ScreenHeader
        title="Returns"
        primary={{ kind: "link", label: "Download calendar (ICS)", href: "/desk/sales-tax/returns/calendar.ics" }}
      />
      <span className="pt-1.5"><InfoTip term="tax-returns" /></span>
    </div>
    <DataTable<Row>
      caption="Tax filing returns"
      rows={rows}
      rowKey={(row) => row.id}
      rowHref={(row) => `/desk/sales-tax/returns/${row.id}`}
      rowActions={(row) => row.amendments.length > 0
        ? [{ kind: "link", label: "Review amendment", href: `/desk/sales-tax/returns/${row.id}/amend` }]
        : []}
      empty={<EmptyState title="No filing periods exist yet" />}
      nextHref={records.length > 25 && rows.length > 0
        ? `/desk/sales-tax/returns?cursor=${encodeURIComponent(rows.at(-1)!.id)}`
        : null}
      columns={[
        { key: "return", header: "Return", cell: (row) => `${row.filingAccount.name} — ${row.filingAccount.kind.replaceAll("_", " ")}` },
        { key: "period", header: "Period", cell: (row) => `${day(row.periodStart)} to ${day(row.periodEnd)}` },
        { key: "due", header: "Due", cell: (row) => day(row.dueOn) },
        { key: "status", header: "Status", cell: status },
      ]}
      mobileCard={(row) => (
        <div className="space-y-1">
          <p className="font-semibold">{row.filingAccount.name} — {row.filingAccount.kind.replaceAll("_", " ")}</p>
          <p className="text-sm text-muted-foreground">Period {day(row.periodStart)} to {day(row.periodEnd)} · Due {day(row.dueOn)}</p>
          <p className="text-sm">{status(row)}</p>
        </div>
      )}
    />
    {!rows.length && (
      <p className="text-sm text-muted-foreground">Configure an account in Setup before generating returns.</p>
    )}
  </main>;
}
