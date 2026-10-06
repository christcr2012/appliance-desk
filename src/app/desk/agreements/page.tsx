import Link from "next/link";
import type { RentalAgreementStatus } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { getDeskAgreementsPage } from "@/domains/desk-access";
import { getAgreementsCount, isReservationStale } from "@/domains/agreements";
import { formatCents } from "@/domains/pricing";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { FilterBar } from "@/components/desk/workspace";
import {
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import {
  rentalAgreementStatusLabel,
  rentalAgreementStatusTone,
} from "@/lib/status-labels";

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

function isAgreementStatus(
  value: string | undefined,
): value is RentalAgreementStatus {
  return (
    value === "DRAFT" ||
    value === "AWAITING_SIGNATURE" ||
    value === "SCHEDULED" ||
    value === "ACTIVE" ||
    value === "ENDED" ||
    value === "CANCELLED"
  );
}

type AgreementRow = Awaited<
  ReturnType<typeof getDeskAgreementsPage>
>[number];

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canViewFinance =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = isAgreementStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

  const totalCount = await getAgreementsCount(filter);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const agreements = await getDeskAgreementsPage(
    filter,
    meta.skip,
    meta.pageSize,
  );

  function agreementsHref(
    page: number,
    forStatus: RentalAgreementStatus | "ALL" = status ?? "ALL",
  ) {
    const params = new URLSearchParams();
    if (forStatus !== "ALL") params.set("status", forStatus);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/agreements?${qs}` : "/desk/agreements";
  }

  const columns: DataListColumn<AgreementRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (agreement) => (
        <div>
          <Link
            href={`/desk/agreements/${agreement.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {agreement.customer.user.name ?? agreement.customer.user.email}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {agreement.serviceAddress.line1}, {agreement.serviceAddress.city}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (agreement) => (
        <div className="flex flex-wrap gap-2">
          <StatusPill
            tone={rentalAgreementStatusTone(agreement.status)}
            label={rentalAgreementStatusLabel(agreement.status)}
          />
          {isReservationStale(
            agreement.status,
            agreement.reservationExpiresAt,
          ) && <StatusPill tone="attention" label="Stale hold" />}
        </div>
      ),
    },
    {
      key: "rental",
      header: canViewFinance ? "Rental value" : "Appliances",
      cell: (agreement) =>
        canViewFinance && agreement.applianceCount > 0
          ? `${formatCents(agreement.monthlyCents ?? 0)}/mo`
          : `${agreement.applianceCount} appliance line(s)`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Rental agreements"
        description="Review active rentals, upcoming starts, signatures, ended agreements, and cancelled agreements."
        primaryAction={
          canViewFinance
            ? { href: "/desk/agreements/new", label: "New agreement" }
            : undefined
        }
      />

      <FilterBar
        label="Filter agreements by status"
        items={STATUS_TABS.map((tab) => ({
          href: agreementsHref(1, tab.value),
          label: tab.label,
          active: (status ?? "ALL") === tab.value,
        }))}
      />

      <DataList
        rows={agreements}
        columns={columns}
        caption="Rental agreements"
        empty={
          <EmptyState
            title={
              status
                ? "No agreements with this status"
                : "No agreements yet"
            }
            description={
              status
                ? "Choose another status to review different agreements."
                : "New rental agreements will appear here."
            }
          />
        }
      />

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(page) => agreementsHref(page)}
      />
    </div>
  );
}
