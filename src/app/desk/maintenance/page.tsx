import Link from "next/link";
import { getMaintenanceRequests } from "@/domains/maintenance";
import type { MaintenanceStatus } from "@prisma/client";

export const metadata = { title: "Maintenance" };

const STATUS_TABS: { value: MaintenanceStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "REVIEWING", label: "Reviewing" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

function isMaintenanceStatus(value: string | undefined): value is MaintenanceStatus {
  return (
    value === "SUBMITTED" ||
    value === "REVIEWING" ||
    value === "SCHEDULED" ||
    value === "IN_PROGRESS" ||
    value === "RESOLVED" ||
    value === "CLOSED"
  );
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = isMaintenanceStatus(rawStatus) ? rawStatus : undefined;

  const requests = await getMaintenanceRequests(status ? { status } : undefined);

  return (
    <div>
      <h1 className="text-xl font-semibold">Maintenance requests</h1>
      <p className="mt-1 text-sm text-gray-600">
        Submitted by customers from their account portal.
      </p>

      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={tab.value === "ALL" ? "/desk/maintenance" : `/desk/maintenance?status=${tab.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {requests.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          {status ? "No requests with this status." : "No maintenance requests yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {requests.map((r) => (
            <li key={r.id}>
              <Link
                href={`/desk/maintenance/${r.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {r.customer.user.name ?? r.customer.user.email}
                  </p>
                  <p className="text-sm text-gray-600">
                    {r.appliance
                      ? `${r.appliance.applianceType.name} (${r.appliance.assetNumber})`
                      : "General"}{" "}
                    · {r.problem.slice(0, 80)}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>
                    {r.status} · {r.priority}
                  </p>
                  <p>{new Date(r.openedAt).toLocaleDateString()}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
