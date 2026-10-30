import Link from "next/link";
import { ScreenHeader, StatusTabs, StatusPill, EmptyState, type Tone } from "@/components/kit";
import { portalLanguage } from "@/domains/language/portal";
import { portalLabel, portalStatement } from "@/domains/language/portal-copy";
import { getServerSession } from "@/lib/session";
import {
  getPortalData,
  getPortalApplianceOptions,
  getPortalMaintenanceCounts,
  getPortalMaintenancePage,
  getPortalPickupRequests,
} from "@/domains/portal";
import { maintenanceStatusLabel } from "@/lib/status-labels";
import { NewRequestForm } from "./new-request-form";
import { RequestSheet } from "./request-sheet";
import { formatBusinessDate as originalBusinessDate, formatShortDate } from "@/lib/business-date";

export const metadata = { title: "Repairs" };

function positivePage(value?: string): number {
  const parsed = Number(value ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;
}

function statusTone(status: string): Tone {
  if (status === "RESOLVED") return "good";
  if (status === "IN_PROGRESS") return "attention";
  if (status === "CLOSED") return "neutral";
  return "info";
}

export default async function AccountMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{
    applianceId?: string;
    request?: string;
    page?: string;
    status?: string;
  }>;
}) {
  const { applianceId, request, page: rawPage, status } = await searchParams;
  const page = positivePage(rawPage);
  const tab = status === "done" ? "done" : "open";
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const formatBusinessDate = (date: Date) => originalBusinessDate(date, locale);
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  const [customer, applianceOptions, pickupRequests, counts, requestPage] = session
    ? await Promise.all([
        getPortalData(session.user.id),
        getPortalApplianceOptions(session.user.id),
        getPortalPickupRequests(session.user.id),
        getPortalMaintenanceCounts(session.user.id),
        getPortalMaintenancePage(session.user.id, page, tab),
      ])
    : [null, [], [], null, null];

  if (!customer || !session) {
    return (
      <div className="max-w-3xl">
        <h1 className="pb-4 text-xl font-bold text-ink">{t("Repairs")}</h1>
        <EmptyState title={t("No rental account found")} />
      </div>
    );
  }

  const initialApplianceId = applianceOptions.some(
    (appliance) => appliance.id === applianceId,
  )
    ? applianceId
    : "";
  const pageHref = (target: number) =>
    `/account/maintenance?page=${target}${tab === "done" ? "&status=done" : ""}`;

  return (
    <div className="max-w-4xl">
      <ScreenHeader title={t("Repairs")} />

      <div className="mb-6 flex flex-wrap gap-3">
        <RequestSheet
          buttonLabel={t("Ask for a repair")}
          title={t("Ask for a repair")}
          intro={t("Tell us what is happening and add photos if they help explain the problem.")}
          autoOpen={request === "repair"}
          primary
        >
          <NewRequestForm
            customerId={customer.id}
            appliances={applianceOptions}
            initialApplianceId={initialApplianceId}
            requestKind="maintenance"
            requestTitle={t("Ask for a repair")}
          />
        </RequestSheet>
        <RequestSheet
          buttonLabel={t("Ask for a pickup")}
          title={t("Ask for a pickup")}
          intro={t("Tell us which property and appliances you want picked up, and your preferred dates. This submits a request for review; it does not cancel your rental or change billing automatically.")}
          autoOpen={request === "pickup"}
        >
          <NewRequestForm
            customerId={customer.id}
            appliances={applianceOptions}
            initialApplianceId={initialApplianceId}
            requestKind="pickup"
            requestTitle={t("Ask for a pickup")}
          />
        </RequestSheet>
      </div>

      <StatusTabs
        label={t("Repairs")}
        param="status"
        current={tab}
        items={[
          { value: "open", label: t("Open"), count: counts?.open ?? 0 },
          { value: "done", label: t("Done"), count: counts?.done ?? 0 },
        ]}
      />

      <section aria-label={t("Repairs")} className="mt-4 rounded-card border border-line bg-surface px-4">
        {!requestPage || requestPage.items.length === 0 ? (
          <div className="py-4">
            <EmptyState
              title={t("No repair requests yet")}
              action={{ kind: "link", label: t("Ask for a repair"), href: "/account/maintenance?request=repair" }}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {requestPage.items.map((item) => (
              <li key={item.id} className="py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {item.appliance
                      ? `${item.appliance.applianceType.name} (${item.appliance.assetNumber})`
                      : t("General")}
                  </p>
                  <StatusPill label={maintenanceStatusLabel(item.status, locale)} tone={statusTone(item.status)} />
                </div>
                <p className="mt-2 text-ink-soft">{item.problem}</p>
                <p className="mt-2 text-xs text-ink-faint">
                  {t("Sent")} {formatShortDate(item.createdAt)}
                  {item._count.photos > 0
                    ? ` · ${portalStatement(locale, "photoCount", { count: item._count.photos, plural: item._count.photos === 1 ? "" : "s" })}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3 py-4">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-tint"
            >{t("Newer requests")}</Link>
          )}
          {requestPage?.hasMore && (
            <Link
              href={pageHref(page + 1)}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-tint"
            >{t("Older requests")}</Link>
          )}
        </div>
      </section>

      {pickupRequests.length > 0 && (
        <section aria-label={t("Pickup requests")} className="mt-6 rounded-card border border-line bg-surface px-4 py-3.5">
          <h2 className="text-base font-bold text-ink">{t("Pickup requests")}</h2>
          <ul className="divide-y divide-line">
            {pickupRequests.map((item) => (
              <li key={item.id} className="py-4 text-sm">
                <p className="font-medium text-ink">
                  {item.scheduledAt ? `${t("Pickup scheduled")} ${formatBusinessDate(item.scheduledAt)}` : t("Waiting for us to schedule it")}
                </p>
                <p className="mt-2 text-ink-soft">{item.text}</p>
                <p className="mt-2 text-xs text-ink-faint">{t("Submitted")} {formatBusinessDate(item.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
