import Link from "next/link";
import { getLeadsPage, getLeadsCount, getLeadCountsByStatus } from "@/domains/leads";
import type { LeadStatus } from "@prisma/client";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { PlusIcon } from "@/components/icons/status-icons";

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
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = isLeadStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

  const [totalCount, counts] = await Promise.all([
    getLeadsCount(filter),
    getLeadCountsByStatus(),
  ]);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const leads = await getLeadsPage(filter, meta.skip, meta.pageSize);

  function leadsHref(page: number, forStatus: LeadStatus | "ALL" = status ?? "ALL") {
    const params = new URLSearchParams();
    if (forStatus !== "ALL") params.set("status", forStatus);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/leads?${qs}` : "/desk/leads";
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Leads</h1>
        <Link
          href="/desk/leads/new"
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <PlusIcon className="h-4 w-4" />
          Add a lead
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Every inquiry — from the website&apos;s contact form, or added
        directly for a call-in or walk-in — ranked by value, highest first.
      </p>

      <nav aria-label="Filter leads by status" className="mt-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const count = tab.value === "ALL" ? undefined : counts[tab.value];
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={leadsHref(1, tab.value)}
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
                    <LeadStatusBadge status={lead.status} /> · score {lead.score}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(p) => leadsHref(p)}
      />
    </div>
  );
}

const LEAD_STATUS_TONE: Record<LeadStatus, StatusTone> = {
  NEW: "pending",
  CONTACTED: "progress",
  CONVERTED: "success",
  LOST: "stopped",
};

function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <StatusBadge tone={LEAD_STATUS_TONE[status]} label={status} />;
}
