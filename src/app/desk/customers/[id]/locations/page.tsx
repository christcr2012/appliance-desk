import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { locationWorkspace } from "@/domains/customers/location-contacts";
import { LocationsPanel } from "@/components/locations/locations-panel";

export const metadata = { title: "Location contacts" };
export default async function CustomerLocationsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, archivedAt: null },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  if (!customer) notFound();
  const [sites, settings] = await Promise.all([
    locationWorkspace({ role: session.user.role, userId: session.user.id }, id),
    prisma.businessSettings.findUnique({ where: { id: "singleton" },
      select: { tenantContactRetentionMonths: true } }),
  ]);
  return <main className="max-w-4xl space-y-5 p-4">
    <Link className="text-primary underline" href={"/desk/customers/" + id + "?tab=properties"}>← Customer properties</Link>
    <h1 className="text-2xl font-semibold">Location contacts for {customer.user.name ?? customer.user.email}</h1>
    <LocationsPanel customerId={id} locations={sites} owner
      retentionMonths={session.user.role === "OWNER" ? (settings?.tenantContactRetentionMonths ?? 12) : null} />
  </main>;
}
