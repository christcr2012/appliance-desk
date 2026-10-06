import { getServerSession } from "@/lib/session";
import {
  getPortalData,
  getPortalApplianceOptions,
  getPortalMaintenancePage,
} from "@/domains/portal";
import { maintenanceStatusLabel } from "@/lib/status-labels";
import { NewRequestForm } from "./new-request-form";
import { formatBusinessDate } from "@/lib/business-date";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";

export const metadata = { title: "Maintenance" };

function positivePage(value?: string): number {
  const parsed = Number(value ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;
}

export default async function AccountMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{
    applianceId?: string;
    request?: string;
    page?: string;
  }>;
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
    return (
      <div className="max-w-3xl">
        <PageHeader title="Maintenance" />
        <EmptyState
          title="No rental account found"
          description="Contact the business if you expected to see service requests here."
        />
      </div>
    );
  }

  const requestPage =
    page === 1
      ? {
          page: 1,
          items: customer.maintenanceRequests,
          hasMore: customer.maintenanceHasMore,
        }
      : await getPortalMaintenancePage(session.user.id, page);

  const initialApplianceId = applianceOptions.some(
    (appliance) => appliance.id === applianceId,
  )
    ? applianceId
    : "";

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Maintenance"
        description="Report a problem, request a pickup, and review your service requests."
      />

      {request === "pickup" && (
        <p
          role="status"
          className="mb-6 rounded-card border border-line bg-subtle p-4 text-sm text-ink"
        >
          Tell us which property and appliances you want picked up, and your
          preferred dates. This submits a request for review; it does not cancel
          your rental or change billing automatically.
        </p>
      )}

      <div className="mb-8">
        <Card
          title={request === "pickup" ? "Request pickup" : "Report a problem"}
          description={
            request === "pickup"
              ? "Give us the details and preferred timing. We will review the request and contact you."
              : "Tell us what is happening and add photos if they help explain the problem."
          }
        >
          <NewRequestForm
            customerId={customer.id}
            appliances={applianceOptions}
            initialApplianceId={initialApplianceId}
            requestKind={request === "pickup" ? "pickup" : "maintenance"}
            requestTitle={
              request === "pickup" ? "Request pickup" : "Report a problem"
            }
          />
        </Card>
      </div>

      <Card title="Your requests">
        {!requestPage || requestPage.items.length === 0 ? (
          <EmptyState
            title="No requests on this page"
            description="New service requests will appear here after you submit them."
          />
        ) : (
          <ul className="divide-y divide-line">
            {requestPage.items.map((item) => (
              <li key={item.id} className="py-4 text-sm">
                <p className="font-semibold text-ink">
                  {item.appliance
                    ? `${item.appliance.applianceType.name} (${item.appliance.assetNumber})`
                    : "General"}
                </p>
                <p className="mt-1 font-medium text-ink-soft">
                  {maintenanceStatusLabel(item.status)}
                </p>
                <p className="mt-2 text-ink-soft">{item.problem}</p>
                <p className="mt-2 text-xs text-ink-faint">
                  Submitted {formatBusinessDate(item.openedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          {page > 1 && (
            <ButtonLink
              href={`/account/maintenance?page=${page - 1}`}
              variant="secondary"
            >
              Newer requests
            </ButtonLink>
          )}
          {requestPage?.hasMore && (
            <ButtonLink
              href={`/account/maintenance?page=${page + 1}`}
              variant="secondary"
            >
              Older requests
            </ButtonLink>
          )}
        </div>
      </Card>
    </div>
  );
}
