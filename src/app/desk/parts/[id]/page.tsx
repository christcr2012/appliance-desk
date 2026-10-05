import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartMovementHistory } from "@/domains/inventory/part-history";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

export const metadata = { title: "Part history" };

function positivePage(value?: string): number {
  const parsed = Number(value ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;
}

function movementLabel(kind: string): string {
  return kind.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export default async function PartHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const page = positivePage(query.page);
  const history = await getPartMovementHistory(id, page);
  if (!history) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/desk/parts" className="text-sm text-primary underline">← Parts</Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">
          {history.part.partNumber}{history.part.partName ? ` — ${history.part.partName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Model {history.part.modelNumber}
          {history.part.manufacturer ? ` · ${history.part.manufacturer}` : ""}
          {history.part.applianceType ? ` · ${history.part.applianceType.name}` : ""}
          {history.part.archivedAt ? " · archived" : ""}
        </p>
        <p className="mt-2 text-sm font-medium text-ink">Current on hand: {history.part.quantityOnHand}</p>
      </div>

      <section aria-labelledby="movement-history-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="movement-history-heading" className="text-lg font-semibold text-ink">Stock movement history</h2>
            <p className="mt-1 text-sm text-ink-soft">Newest first. The ledger is append-only; corrections appear as reversal/new movement rows.</p>
          </div>
          <span className="text-sm text-ink-faint">Page {history.page}</span>
        </div>

        {history.movements.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-soft">No stock movements on this page.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {history.movements.map((movement) => (
              <li key={movement.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">
                      {movementLabel(movement.kind)} · {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">Balance after: {movement.balanceAfter}</p>
                    {movement.reason && <p className="mt-1 text-sm text-ink-soft">Reason: {movement.reason}</p>}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {movement.job && (
                        <Link href={`/desk/jobs/${movement.job.id}`} className="text-primary underline">
                          {movement.job.type.replaceAll("_", " ")} job
                        </Link>
                      )}
                      {movement.purchaseOrderLineItem && (
                        <Link href={`/desk/purchase-orders/${movement.purchaseOrderLineItem.purchaseOrder.id}`} className="text-primary underline">
                          Purchase order · {movement.purchaseOrderLineItem.description}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-ink-faint">
                    <p>{formatBusinessDate(movement.createdAt)} · {formatBusinessTime(movement.createdAt)}</p>
                    <p className="mt-1">By {movement.actorLabel}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <nav aria-label="Part movement history pages" className="mt-4 flex gap-4 text-sm">
          {history.page > 1 && (
            <Link href={`/desk/parts/${history.part.id}?page=${history.page - 1}`} className="text-primary underline">Newer movements</Link>
          )}
          {history.hasMore && (
            <Link href={`/desk/parts/${history.part.id}?page=${history.page + 1}`} className="text-primary underline">Older movements</Link>
          )}
        </nav>
      </section>
    </div>
  );
}
