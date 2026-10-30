import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import {
  getAllEstimates,
  totalMonthlyCents,
  totalOneTimeCents,
} from "@/domains/estimates";
import { formatCents } from "@/domains/pricing";
import { estimateStatusLabel } from "@/lib/status-labels";
import {
  EmptyState,
  StatusPill,
} from "@/components/ui";
import { DataTable, ScreenHeader, type Column } from "@/components/kit";
import type { StatusTone } from "@/components/status-badge";

export const metadata = { title: "Estimates" };

const STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "pending",
  SENT: "progress",
  VIEWED: "progress",
  APPROVED: "success",
  CHANGES_REQUESTED: "attention",
  DECLINED: "stopped",
  EXPIRED: "stopped",
  CONVERTED: "success",
};

type EstimateRow = Awaited<ReturnType<typeof getAllEstimates>>[number];

/** Custom-priced estimates for deals that don't fit standard self-serve
 * pricing — a property manager ordering for several units, an entire
 * building, and similar (2026-09-29, see docs/DECISIONS.md). Always
 * OWNER/ADMIN: an estimate is where custom pricing gets decided, same
 * access level as Billing/Settings. */
export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { open } = await searchParams;
  // The kit table's row click sets ?open=<id> (its side-panel convention).
  // Estimates have no side panel — the record page IS the destination, as
  // it was before the redesign — so an ?open= link goes straight there.
  if (open) redirect(`/desk/estimates/${encodeURIComponent(open)}`);
  const estimates = await getAllEstimates();

  const columns: Column<EstimateRow>[] = [
    {
      key: "estimate",
      header: "Estimate",
      cell: (estimate) => (
        <div>
          <span className="font-semibold text-ink">
            #{estimate.estimateNumber} — {estimate.title}
          </span>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {estimate.customer ? (
              <>
                {estimate.customer.user.name ?? estimate.customer.user.email}
                {estimate.customer.companyName
                  ? ` · ${estimate.customer.companyName}`
                  : ""}
              </>
            ) : estimate.lead ? (
              <>
                {estimate.lead.contactName}
                {estimate.lead.companyName
                  ? ` · ${estimate.lead.companyName}`
                  : ""}
                {" · lead"}
              </>
            ) : (
              "No customer or lead linked"
            )}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (estimate) => (
        <StatusPill
          tone={STATUS_TONE[estimate.status] ?? "pending"}
          label={estimateStatusLabel(estimate.status)}
        />
      ),
    },
    {
      key: "pricing",
      header: "Pricing",
      cell: (estimate) => {
        const monthly = totalMonthlyCents(estimate.lineItems);
        const oneTime = totalOneTimeCents(estimate.lineItems);
        return (
          <span>
            {monthly > 0 && `${formatCents(monthly)}/mo`}
            {monthly > 0 && oneTime > 0 && " + "}
            {oneTime > 0 && `${formatCents(oneTime)} one-time`}
            {monthly === 0 && oneTime === 0 && "No line items yet"}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <ScreenHeader
        title="Quotes"
        list
        primary={{ kind: "link", href: "/desk/estimates/new", label: "New quote" }}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Quotes (also called estimates) are custom-priced proposals for deals that don&apos;t fit standard pricing,
        including property-manager and multi-unit work.
      </p>

      <p className="mb-4 text-sm">
        Entering an order while talking to a customer?{" "}
        <Link href="/desk/phone-orders" className="font-semibold underline">
          Phone orders — start, prepare, then send customer link
        </Link>
      </p>
      <DataTable
        rows={estimates}
        rowKey={(estimate) => estimate.id}
        columns={columns}
        caption="Estimates"
        rowHref={(estimate) => `/desk/estimates/${estimate.id}`}
        mobileCard={(estimate) => (
          <div>
            {columns[0].cell(estimate)}
            <p className="mt-1 text-sm text-ink-soft">{columns[2].cell(estimate)}</p>
          </div>
        )}
        empty={
          <EmptyState
            title="No estimates yet"
            description="Create the first custom-priced proposal when a deal falls outside standard pricing."
          />
        }
      />
    </div>
  );
}
