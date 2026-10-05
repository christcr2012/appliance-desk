import Link from "next/link";
import { getServerSession } from "@/lib/session";
import {
  getPortalData,
  getPortalApplianceOptions,
  getPortalMaintenancePage,
} from "@/domains/portal";
import { maintenanceStatusLabel } from "@/lib/status-labels";
import { NewRequestForm } from "./new-request-form";
import { formatBusinessDate } from "@/lib/business-date";

export const metadata = { title: "Maintenance" };

function positivePage(value?: string): number {
  const parsed = Number(value ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;
}

export default async function AccountMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ applianceId?: string; request?: string; page?: string }>;
}) {
  const { applianceId, request, page: rawPage } = await searchParams;
  const page = positivePage(rawPage);
  const session = await getServerSession();
  const [customer, applianceOptions] = session
    ? await Promise.all([
        getPortalData(session.user.id),
        getPortalApplianceOptions(session.user.id),
      ])
    : [null, []];

  if (!customer || !session) {
    return <p className="text-ink-soft">No rental account found.</p>;
  }

  const requestPage = page === 1
    ? { page: 1, items: customer.maintenanceRequests, hasMore: customer.maintenanceHasMore }
    : await getPortalMaintenancePage(session.user.id, page);

  const initialApplianceId = applianceOptions.some((a) => a.id === applianceId)
    ? applianceId
    : "";

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-ink">Maintenance</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Something not working right? Let us know and we&apos;ll follow up.
      </p>

      {request === "pickup" && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-subtle p-4 text-sm text-ink">
          Tell us which property and appliances you want picked up, and your preferred dates. This submits a request for review; it does not cancel your rental or change billing automatically.
        </p>
      )}
      <div className="mt-6">
        <NewRequestForm
          customerId={customer.id}
          appliances={applianceOptions}
          initialApplianceId={initialApplianceId}
          requestKind={request === "pickup" ? "pickup" : "maintenance"}
          requestTitle={request === "pickup" ? "Request pickup" : "Report a problem"}
        />
      </div>

      <div className="mt-8">
        <h2 className="font-medium text-ink">Your requests</h2>
        {!requestPage || requestPage.items.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No requests on this page.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {requestPage.items.map((item) => (
              <li key={item.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-ink">
                  {item.appliance
                    ? `${item.appliance.applianceType.name} (${item.appliance.assetNumber})`
                    : "General"}{" "}
                  — {maintenanceStatusLabel(item.status)}
                </p>
                <p className="text-ink-soft">{item.problem}</p>
                <p className="mt-1 text-xs text-ink-faint">Submitted {formatBusinessDate(item.openedAt)}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-4 text-sm">
          {page > 1 && (
            <Link className="text-primary underline" href={`/account/maintenance?page=${page - 1}`}>Newer requests</Link>
          )}
          {requestPage?.hasMore && (
            <Link className="text-primary underline" href={`/account/maintenance?page=${page + 1}`}>Older requests</Link>
          )}
        </div>
      </div>
    </div>
  );
}
