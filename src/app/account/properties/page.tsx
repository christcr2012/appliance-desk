import { portalLanguage } from "@/domains/language/portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { locationWorkspace } from "@/domains/customers/location-contacts";
import { LocationsPanel } from "@/components/locations/locations-panel";
import Link from "next/link";

export const metadata = { title: "My properties and tenants" };
export default async function AccountPropertiesPage() {
  const session = await requireRole("CUSTOMER");
  const language = await portalLanguage(session.user.id);
  const t = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language, word);
  const row = await prisma.customer.findFirst({
    where: { userId: session.user.id, archivedAt: null }, select: { id: true },
  });
  const data = row
    ? await locationWorkspace({ role: "CUSTOMER", userId: session.user.id, customerId: row.id }, row.id)
    : null;
  return <main lang={language} className="max-w-4xl space-y-5">
    <Link href="/account" className="text-primary underline">← {t("My account")}</Link>
    <h1 className="text-2xl font-semibold">{t("My properties and on-site contacts")}</h1>
    <p className="text-sm text-ink-soft">{t("Manage the people at your properties without giving tenants access to your billing or account.")}</p>
    {data ? <LocationsPanel customerId={data.id} locations={data} owner={false} retentionMonths={null} />
      : <p>{t("No rental account found")}</p>}
  </main>;
}
