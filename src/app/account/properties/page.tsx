import { portalLanguage } from "@/domains/language/portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { locationWorkspace } from "@/domains/customers/location-contacts";
import { LocationsPanel } from "@/components/locations/locations-panel";
import { RecordHeader } from "@/components/kit/record-header";
import { EmptyState } from "@/components/kit/empty-state";
import { InfoNote } from "@/components/portal/info-note";

export const metadata = { title: "My properties" };

/** PORTAL-1 section 5.5: header "My properties" with a back link to
 * Home, the explainer as an InfoNote, and the locations panel with
 * every action unchanged — shell spacing only. */
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
  const note = t("Add the people at each property so we can reach them about visits. They never see your bills or account.");
  return (
    <div lang={language} className="max-w-4xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RecordHeader title={t("My properties")} back={{ href: "/account", label: t("Home") }} />
        </div>
        <span className="pt-1">
          <InfoNote label={note} text={note} />
        </span>
      </div>
      {data ? (
        <LocationsPanel customerId={data.id} locations={data} owner={false} retentionMonths={null} />
      ) : (
        <EmptyState title={t("No rental account found")} />
      )}
    </div>
  );
}
