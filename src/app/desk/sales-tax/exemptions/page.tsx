import { requireRole } from "@/lib/session";
import { redirect } from "next/navigation";
import { getTaxExemptionsPage } from "@/domains/tax/workspace-queries";
import { DataTable, EmptyState, ScreenHeader } from "@/components/kit";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function TaxExemptionsPage({
  searchParams,
}: { searchParams: Promise<{ cursor?: string; open?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const { cursor, open } = await searchParams;
  // The kit table's desktop row click sets ?open=<id> (its side-panel convention).
  // Certificates have no side panel — the certificate page IS the destination, as
  // it was before the redesign — so an ?open= link goes straight there.
  if (open) redirect(`/desk/sales-tax/exemptions/${encodeURIComponent(open)}`);
  const records = await getTaxExemptionsPage(session.user.id, { cursor, limit: 25 });
  type Row = (typeof records.rows)[number];
  const validity = (row: Row) =>
    `Valid from ${day(row.validFrom)}${row.expiresOn ? ` through ${day(row.expiresOn)}` : " · No expiry recorded"}${row.revokedAt ? ` · Revoked ${day(row.revokedAt)}` : ""}`;
  return <main className="space-y-5">
    <ScreenHeader title="Exemptions" />
    <p className="text-sm text-muted-foreground">
      Certificates and verification history stay private — manage them from each customer&apos;s tax exemptions panel.
    </p>
    <DataTable<Row>
      caption="Customers who don't pay tax"
      rows={records.rows}
      rowKey={(row) => row.id}
      rowHref={(row) => `/desk/customers/${row.customerId}?tab=billing#tax-exemptions`}
      empty={<EmptyState title="No certificates recorded" />}
      nextHref={records.nextCursor
        ? `/desk/sales-tax/exemptions?cursor=${encodeURIComponent(records.nextCursor)}`
        : null}
      columns={[
        { key: "customer", header: "Customer", cell: (row) => row.customerName },
        { key: "reason", header: "Reason", cell: (row) => row.reason.replaceAll("_", " ") },
        { key: "valid", header: "Validity", cell: validity },
        { key: "evidence", header: "Evidence", cell: (row) => row.hasPrivateCertificate ? "Private evidence on file" : "No certificate document on file" },
      ]}
      mobileCard={(row) => (
        <div className="space-y-1">
          <p className="font-semibold">{row.customerName}</p>
          <p className="text-sm text-muted-foreground">{row.reason.replaceAll("_", " ")} · {validity(row)}</p>
          <p className="text-sm">{row.hasPrivateCertificate ? "Private evidence on file" : "No certificate document on file"}</p>
        </div>
      )}
    />
  </main>;
}
