import Link from "next/link";
import { formatCents } from "@/domains/pricing";
import {
  DEPOSIT_BUCKET_LABEL,
  getDepositLiability,
  type DepositAgeBucket,
} from "@/domains/billing/deposit-liability";
import {
  ButtonLink,
  DataList,
  EmptyState,
  StatCard,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";

type DepositRow = Awaited<
  ReturnType<typeof getDepositLiability>
>["rows"][number];

export async function DepositsTab() {
  const liability = await getDepositLiability();
  const order: DepositAgeBucket[] = [
    "OVER_90",
    "DAYS_31_90",
    "DAYS_0_30",
    "STILL_RENTING",
  ];

  const columns: DataListColumn<DepositRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (row) => (
        <Link
          href={`/desk/customers/${row.customerId}`}
          className="font-semibold text-ink underline-offset-4 hover:underline"
        >
          {row.customerName}
        </Link>
      ),
    },
    {
      key: "standing",
      header: "Where it stands",
      cell: (row) => (
        <div className="space-y-2">
          <p>
            {DEPOSIT_BUCKET_LABEL[row.bucket]}
            {row.daysSinceEnd !== null
              ? ` (${row.daysSinceEnd} days)`
              : ""}
          </p>
          {row.overdue && (
            <StatusPill tone="attention" label="Over 90 days" />
          )}
        </div>
      ),
    },
    {
      key: "deposit",
      header: "Deposit",
      cell: (row) => formatCents(row.amountCents),
    },
    {
      key: "decision",
      header: "Decision",
      cell: (row) => (
        <ButtonLink
          href={`/desk/billing/deposits/${row.depositId}`}
          variant="secondary"
        >
          Decide
        </ButtonLink>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-soft">
        A deposit is money you are holding that belongs to the customer until
        you decide how much to give back. It is never counted as rent or
        income. A deposit leaves this list when you record a decision. Age
        counts days since the rental ended using Colorado dates.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {order.map((bucket) => {
          const value = liability.byBucket[bucket];
          const overdue = bucket === "OVER_90" && value.count > 0;
          return (
            <StatCard
              key={bucket}
              label={DEPOSIT_BUCKET_LABEL[bucket]}
              value={formatCents(value.cents)}
              detail={`${value.count} deposit(s)${
                overdue ? " · overdue decision" : ""
              }`}
            />
          );
        })}
      </div>

      <p className="font-semibold text-ink">
        Total waiting for a decision: {formatCents(liability.totalCents)}{" "}
        across {liability.count} deposit(s).
      </p>

      <DataList
        rows={liability.rows}
        columns={columns}
        caption="Deposits waiting for a decision"
        empty={
          <EmptyState
            title="No deposits are waiting for a decision"
            description="Held deposits will appear here until a refund or retention decision is recorded."
          />
        }
      />
    </div>
  );
}
