import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function FilingReturnsPage({
  searchParams,
}: { searchParams: Promise<{ cursor?: string }> }) {
  await requireRole("OWNER", "ADMIN");
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
  return <main className="space-y-5">
    <div className="space-y-1">
      <h2 className="text-xl font-semibold">Tax filing returns</h2>
      <p className="text-sm text-muted-foreground">Your official filing checklist and recorded return evidence. The application does not submit forms to SUTS or send payments on your behalf.</p>
    </div>
    <Link className="inline-block text-sm underline" href="/desk/sales-tax/returns/calendar.ics">Download private tax due-date calendar (ICS)</Link>
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
          <p className="font-semibold">{row.filingAccount.name} — {row.filingAccount.kind.replaceAll("_", " ")}</p>
          <p className="text-muted-foreground">Period {row.periodStart.toISOString().slice(0, 10)} to {row.periodEnd.toISOString().slice(0, 10)} · Due {row.dueOn.toISOString().slice(0, 10)}</p>
          <p>{row.status === "FILED" ? `Filed ${row.filedOn?.toISOString().slice(0, 10) ?? ""}` : "Not yet filed"}
            {row.amendments.length > 0 && " · Amendment needs review"}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="underline" href={`/desk/sales-tax/returns/${row.id}`}>Open guided return</Link>
          {row.amendments.length > 0 && <Link className="underline" href={`/desk/sales-tax/returns/${row.id}/amend`}>Review amendment</Link>}
        </div>
      </li>)}
      {!rows.length && <li className="p-4 text-sm text-muted-foreground">No filing periods exist yet. Configure an account in Setup before generating returns.</li>}
    </ul>
    {records.length > 25 && rows.length > 0 &&
      <Link className="inline-block text-sm underline"
        href={`/desk/sales-tax/returns?cursor=${encodeURIComponent(rows.at(-1)!.id)}`}>Next returns</Link>}
  </main>;
}

