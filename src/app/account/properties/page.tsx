import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { locationWorkspace } from "@/domains/customers/location-contacts";
import { LocationsPanel } from "@/components/locations/locations-panel";
import Link from "next/link";

export const metadata = { title: "My properties and tenants" };
export default async function AccountPropertiesPage() {
  const session = await requireRole("CUSTOMER");
  const row = await prisma.customer.findFirst({
    where: { userId: session.user.id, archivedAt: null }, select: { id: true },
  });
  const data = row
    ? await locationWorkspace({ role: "CUSTOMER", userId: session.user.id, customerId: row.id }, row.id)
    : null;
  return <main className="max-w-4xl space-y-5">
    <Link href="/account" className="text-primary underline">← My account</Link>
    <h1 className="text-2xl font-semibold">My properties and on-site contacts</h1>
    <p className="text-sm text-ink-soft">Manage the people at your properties without giving tenants access to your billing or account.</p>
    {data ? <LocationsPanel customerId={data.id} locations={data} owner={false} retentionMonths={null} />
      : <p>No rental account found.</p>}
  </main>;
}
