import Link from "next/link";
import { getLeads, getLeadCountsByStatus } from "@/domains/leads";
import type { LeadStatus } from "@prisma/client";

export const metadata = { title: "Leads" };

const STATUS_TABS: { value: LeadStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "CONVERTED", label: "Converted" },
  { value: "LOST", label: "Lost" },
];

function isLeadStatus(value: string | undefined): value is LeadStatus {
  return value === "NEW" || value === "CONTACTED" || value === "CONVERTED" || value === "LOST";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = isLeadStatus(rawStatus) ? rawStatus : undefined;

  const [leads, counts] = await Promise.all([
    getLeads(status ? { status } : undefined),
    getLeadCountsByStatus(),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold">Leads</h1>
      <p className="mt-1 text-sm text-gray-600">
        Every inquiry from the website&apos;s contact form, ranked by value —
        highest first.
      </p>

      <nav aria-label="Filter leads by status" className="mt-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const count = tab.value === "ALL" ? undefined : counts[tab.value];
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={tab.value === "ALL" ? "/desk/leads" : `/desk/leads?status=${tab.value}`}
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

      {leads.length === 0 ? (
        <p className="mt-8 text-sm text-gray-600">No leads here yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/desk/leads/${lead.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {lead.contactName}
                    {lead.companyName ? ` — ${lead.companyName}` : ""}
                    {lead.isHighValue && (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        High value
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600">
                    {lead.applianceRequests
                      .map((r) => `${r.quantity}x ${r.applianceType.name}`)
                      .join(", ") || "No appliances specified"}
                    {" · "}
                    {lead.desiredTerm ?? "term not given"}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>{lead.phone}</p>
                  <p>
                    <StatusBadge status={lead.status} /> · score {lead.score}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const styles: Record<LeadStatus, string> = {
    NEW: "text-blue-700",
    CONTACTED: "text-amber-700",
    CONVERTED: "text-green-700",
    LOST: "text-gray-500",
  };
  return <span className={styles[status]}>{status}</span>;
}
