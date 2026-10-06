import Link from "next/link";
import { requireRole } from "@/lib/session";
import {
  getAllEstimates,
  totalMonthlyCents,
  totalOneTimeCents,
} from "@/domains/estimates";
import { formatCents } from "@/domains/pricing";
import { estimateStatusLabel } from "@/lib/status-labels";
import {
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
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
export default async function EstimatesPage() {
  await requireRole("OWNER", "ADMIN");
  const estimates = await getAllEstimates();

  const columns: DataListColumn<EstimateRow>[] = [
    {
      key: "estimate",
      header: "Estimate",
      primary: true,
      cell: (estimate) => (
        <div>
          <Link
            href={`/desk/estimates/${estimate.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            #{estimate.estimateNumber} — {estimate.title}
          </Link>
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
      <PageHeader
        title="Estimates"
        description="Custom-priced proposals for deals that don't fit standard pricing, including property-manager and multi-unit work."
        primaryAction={{ href: "/desk/estimates/new", label: "New estimate" }}
      />

      <DataList
        rows={estimates}
        columns={columns}
        caption="Estimates"
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
