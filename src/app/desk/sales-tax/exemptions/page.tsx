import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getTaxExemptionsPage } from "@/domains/tax/workspace-queries";
export default async function TaxExemptionsPage({
  searchParams,
}: { searchParams: Promise<{ cursor?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const cursor = (await searchParams).cursor;
  const records = await getTaxExemptionsPage(session.user.id, { cursor, limit: 25 });
  return <main className="space-y-5">
    <h2 className="text-xl font-semibold">Exemption certificates</h2>
    <p className="text-sm text-muted-foreground">
      Certificates and verification history stay private. To add, replace, revoke or verify one,
      open the existing customer tax exemptions panel; this list never creates a second certificate record.
    </p>
    <ul className="divide-y divide-border rounded-lg border border-border">
      {records.rows.map(row => <li className="flex flex-wrap justify-between gap-3 p-3 text-sm" key={row.id}>
        <div>
          <p className="font-semibold">{row.customerName}</p>
          <p className="text-muted-foreground">{row.reason.replaceAll("_", " ")} ·
            Valid from {row.validFrom.toISOString().slice(0, 10)}
            {row.expiresOn ? ` through ${row.expiresOn.toISOString().slice(0, 10)}` : " · No expiry recorded"}
            {row.revokedAt && ` · Revoked ${row.revokedAt.toISOString().slice(0, 10)}`}
          </p>
          <p>{row.hasPrivateCertificate ? "Private evidence on file" : "No certificate document on file"}</p>
        </div>
        <Link className="self-start underline" href={`/desk/customers/${row.customerId}?tab=billing#tax-exemptions`}>
          Review certificate and customer ownership
        </Link>
      </li>)}
      {!records.rows.length && <li className="p-3 text-sm text-muted-foreground">No certificates recorded.</li>}
    </ul>
    {records.nextCursor && <Link className="text-sm underline"
      href={`/desk/sales-tax/exemptions?cursor=${encodeURIComponent(records.nextCursor)}`}>
      Next certificates
    </Link>}
  </main>;
}

