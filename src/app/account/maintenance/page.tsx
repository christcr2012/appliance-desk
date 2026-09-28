import { getServerSession } from "@/lib/session";
import { getPortalData, getPortalApplianceOptions } from "@/domains/portal";
import { maintenanceStatusLabel } from "@/lib/status-labels";
import { NewRequestForm } from "./new-request-form";

export const metadata = { title: "Maintenance" };

export default async function AccountMaintenancePage() {
  const session = await getServerSession();
  const [customer, applianceOptions] = session
    ? await Promise.all([
        getPortalData(session.user.id),
        getPortalApplianceOptions(session.user.id),
      ])
    : [null, []];

  if (!customer) {
    return <p className="text-gray-600">No rental account found.</p>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Maintenance</h1>
      <p className="mt-1 text-sm text-gray-600">
        Something not working right? Let us know and we&apos;ll follow up.
      </p>

      <div className="mt-6">
        <NewRequestForm appliances={applianceOptions} />
      </div>

      <div className="mt-8">
        <h2 className="font-medium text-gray-900">Your requests</h2>
        {customer.maintenanceRequests.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No requests yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {customer.maintenanceRequests.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">
                  {r.appliance
                    ? `${r.appliance.applianceType.name} (${r.appliance.assetNumber})`
                    : "General"}{" "}
                  — {maintenanceStatusLabel(r.status)}
                </p>
                <p className="text-gray-600">{r.problem}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Submitted {new Date(r.openedAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
