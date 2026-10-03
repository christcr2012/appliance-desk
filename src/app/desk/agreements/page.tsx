import { requireRole } from "@/lib/session";
import { getDeskAgreementsPage } from "@/domains/desk-access";
import Link from "next/link";
import { getAgreementsCount, isReservationStale } from "@/domains/agreements";
import { formatCents } from "@/domains/pricing";
import type { RentalAgreementStatus } from "@prisma/client";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { PlusIcon } from "@/components/icons/status-icons";
import { StatusBadge } from "@/components/status-badge";
import { rentalAgreementStatusTone } from "@/lib/status-labels";

export const metadata = { title: "Agreements" };

const STATUS_TABS: { value: RentalAgreementStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "AWAITING_SIGNATURE", label: "Awaiting signature" },
  { value: "SCHEDULED", label: "Signed, starts later" },
  { value: "ACTIVE", label: "Active" },
  { value: "ENDED", label: "Ended" },
  { value: "CANCELLED", label: "Cancelled" },
];

function isAgreementStatus(value: string | undefined): value is RentalAgreementStatus {
  return (
    value === "DRAFT" ||
    value === "AWAITING_SIGNATURE" ||
    value === "SCHEDULED" ||
    value === "ACTIVE" ||
    value === "ENDED" ||
    value === "CANCELLED"
  );
}

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canViewFinance = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = isAgreementStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

  const totalCount = await getAgreementsCount(filter);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const agreements = await getDeskAgreementsPage(filter, meta.skip, meta.pageSize);

  function agreementsHref(page: number, forStatus: RentalAgreementStatus | "ALL" = status ?? "ALL") {
    const params = new URLSearchParams();
    if (forStatus !== "ALL") params.set("status", forStatus);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/agreements?${qs}` : "/desk/agreements";
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Rental agreements</h1>
        {canViewFinance && <Link
          href="/desk/agreements/new"
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <PlusIcon className="h-4 w-4" />
          New agreement
        </Link>}
      </div>

      <nav aria-label="Filter agreements by status" className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={agreementsHref(1, tab.value)}
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

      {agreements.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          {status ? "No agreements with this status." : "No agreements yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {agreements.map((a) => (
            <li key={a.id}>
              <Link
                href={`/desk/agreements/${a.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {a.customer.user.name ?? a.customer.user.email}
                  </p>
                  <p className="text-sm text-gray-600">
                    {a.serviceAddress.line1}, {a.serviceAddress.city}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>
                    <StatusBadge tone={rentalAgreementStatusTone(a.status)} label={a.status} />
                    {isReservationStale(a.status, a.reservationExpiresAt) && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Stale hold
                      </span>
                    )}
                  </p>
                  <p>
                    {canViewFinance && a.applianceCount > 0
                      ? `${formatCents(
                          a.monthlyCents ?? 0,
                        )}/mo`
                      : `${a.applianceCount} appliance line(s)`}
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
        buildHref={(p) => agreementsHref(p)}
      />
    </div>
  );
}

