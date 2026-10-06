import Link from "next/link";
import { getAllPartRecords } from "@/domains/inventory";
import { getLowStockParts } from "@/domains/purchasing";
import {
  ButtonLink,
  Card,
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import { PartStockPanel } from "./part-stock-panel";

export const metadata = { title: "Parts" };

type PartRow = Awaited<ReturnType<typeof getAllPartRecords>>[number];

export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const showArchived = (await searchParams).archived === "1";
  const [partRecords, lowStockParts] = await Promise.all([
    getAllPartRecords({ includeArchived: showArchived }),
    getLowStockParts(),
  ]);
  const lowStockIds = new Set(lowStockParts.map((part) => part.id));

  const columns: DataListColumn<PartRow>[] = [
    {
      key: "part",
      header: "Part",
      primary: true,
      cell: (part) => (
        <div>
          <Link
            href={`/desk/parts/${part.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {part.modelNumber}
            {part.manufacturer ? ` (${part.manufacturer})` : ""}
            {part.applianceType ? ` — ${part.applianceType.name}` : ""}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            Part {part.partNumber}
            {part.partName ? ` — ${part.partName}` : ""}
          </p>
          {part.notes && (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {part.notes}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (part) =>
        part.archivedAt ? (
          <StatusPill tone="stopped" label="Archived" />
        ) : lowStockIds.has(part.id) ? (
          <StatusPill tone="attention" label="Low stock" />
        ) : (
          <StatusPill tone="success" label="In stock" />
        ),
    },
    {
      key: "stock",
      header: "Stock",
      cell: (part) => (
        <PartStockPanel
          partRecordId={part.id}
          quantityOnHand={part.quantityOnHand}
          reorderThreshold={part.reorderThreshold}
          lowStock={lowStockIds.has(part.id)}
          archived={part.archivedAt !== null}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Parts"
        description="Every part you've logged, grouped by model number. Add new parts from an appliance record for that model."
        secondaryActions={
          <ButtonLink
            href={showArchived ? "/desk/parts" : "/desk/parts?archived=1"}
            variant="secondary"
          >
            {showArchived ? "Hide archived parts" : "Show archived parts"}
          </ButtonLink>
        }
      />

      {lowStockParts.length > 0 && (
        <div className="mb-6">
          <Card
            title={`${lowStockParts.length} ${
              lowStockParts.length === 1 ? "part is" : "parts are"
            } running low`}
            description="Restock before these parts fall below their configured thresholds."
            actions={
              <ButtonLink href="/desk/purchase-orders/new" variant="secondary">
                Start purchase order
              </ButtonLink>
            }
          >
            <ul className="space-y-1 text-sm text-warning-ink">
              {lowStockParts.map((part) => (
                <li key={part.id}>
                  {part.modelNumber} — {part.partNumber} (
                  {part.quantityOnHand} on hand, flagged at{" "}
                  {part.reorderThreshold})
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <DataList
        rows={partRecords}
        columns={columns}
        caption="Parts"
        empty={
          <EmptyState
            title="No parts logged yet"
            description="Parts appear here after you save them from an appliance record."
          />
        }
      />
    </div>
  );
}
