import Link from "next/link";
import { getAppliances, getApplianceCountsByStatus } from "@/domains/inventory";
import { getAllApplianceTypes } from "@/domains/settings";
import { NewApplianceForm } from "./new-appliance-form";
import type { ApplianceStatus } from "@prisma/client";

export const metadata = { title: "Inventory" };

const STATUS_TABS: { value: ApplianceStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "AVAILABLE", label: "Available" },
  { value: "RESERVED", label: "Reserved" },
  { value: "RENTED", label: "Rented" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "RETIRED", label: "Retired" },
];

function isApplianceStatus(value: string | undefined): value is ApplianceStatus {
  return (
    value === "AVAILABLE" ||
    value === "RESERVED" ||
    value === "RENTED" ||
    value === "MAINTENANCE" ||
    value === "RETIRED"
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = isApplianceStatus(rawStatus) ? rawStatus : undefined;

  const [appliances, counts, applianceTypes] = await Promise.all([
    getAppliances(status ? { status } : undefined),
    getApplianceCountsByStatus(),
    getAllApplianceTypes(),
  ]);

  const activeTypes = applianceTypes.filter((t) => t.isActive);

  return (
    <div>
      <h1 className="text-xl font-semibold">Inventory</h1>
      <p className="mt-1 text-sm text-gray-600">
        Every individual appliance unit you own — separate from the
        categories and pricing managed in Settings.
      </p>

      <div className="mt-6">
        <NewApplianceForm
          applianceTypes={activeTypes.map((t) => ({ id: t.id, name: t.name }))}
        />
      </div>

      <nav aria-label="Filter inventory by status" className="mt-8 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const count = tab.value === "ALL" ? undefined : counts[tab.value];
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={tab.value === "ALL" ? "/desk/inventory" : `/desk/inventory?status=${tab.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {tab.label}
              {count !== undefined ? ` (${count})` : ""}
            </Link>
          );
        })}
      </nav>

      {appliances.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          {status
            ? "No appliances with this status."
            : "No appliances yet — add your first one above as you obtain it."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {appliances.map((appliance) => (
            <li key={appliance.id}>
              <Link
                href={`/desk/inventory/${appliance.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {appliance.assetNumber} — {appliance.applianceType.name}
                  </p>
                  <p className="text-sm text-gray-600">
                    {[appliance.manufacturer, appliance.model, appliance.color]
                      .filter(Boolean)
                      .join(" ") || "No manufacturer/model on file"}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>
                    <StatusBadge status={appliance.status} />
                  </p>
                  <p>{appliance.currentLocation ?? "No location on file"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApplianceStatus }) {
  const styles: Record<ApplianceStatus, string> = {
    AVAILABLE: "text-green-700",
    RESERVED: "text-blue-700",
    RENTED: "text-amber-700",
    MAINTENANCE: "text-red-700",
    RETIRED: "text-gray-500",
  };
  return <span className={styles[status]}>{status}</span>;
}
