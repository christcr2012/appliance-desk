import Link from "next/link";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import {
  ButtonLink,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";
import { loadBillingReconciliationPageData } from "./data";

export const metadata = { title: "Billing reconciliation" };

type ReconciliationRow = Awaited<
  ReturnType<typeof loadBillingReconciliationPageData>
>["rows"][number];

export default async function BillingReconciliationPage() {
  const { checkedAt, rows } =
    await loadBillingReconciliationPageData();

  const columns: DataListColumn<ReconciliationRow>[] = [
    {
      key: "kind",
      header: "Kind",
      primary: true,
      cell: (row) => row.kind.replaceAll("_", " "),
    },
    {
      key: "subject",
      header: "Subject",
      cell: (row) => (
        <div>
          <p>{row.subjectType}</p>
          <p className="font-mono text-xs text-ink-faint">
            {row.subjectId}
          </p>
        </div>
      ),
    },
    {
      key: "detail",
      header: "Detail",
      cell: (row) => (
        <div>
          <span>{row.detail}</span>
          {row.kind === "HELD_PAYMENT" && (
            <>
              {" "}
              <Link
                href="/desk/billing/held-payments"
                className="font-medium text-ink underline-offset-4 hover:underline"
              >
                Decide what to do with it
              </Link>
            </>
          )}
        </div>
      ),
    },
    {
      key: "since",
      header: "Since",
      cell: (row) =>
        `${formatBusinessDate(row.since)} ${formatBusinessTime(
          row.since,
        )}`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Billing reconciliation"
        description="Read-only provider and ledger mismatches that may need investigation. This page never repairs or retries anything."
        secondaryActions={
          <ButtonLink href="/desk/billing" variant="secondary">
            Back to billing
          </ButtonLink>
        }
      />

      <p className="mb-4 text-sm text-ink-soft">
        Last checked {formatBusinessDate(checkedAt)} at{" "}
        {formatBusinessTime(checkedAt)}
      </p>

      <DataList
        rows={rows}
        columns={columns}
        caption="Billing reconciliation mismatches"
        empty={
          <EmptyState
            title="No billing/provider drift detected"
            description="The bounded reconciliation scan did not find any mismatches that need investigation."
          />
        }
      />
    </div>
  );
}
