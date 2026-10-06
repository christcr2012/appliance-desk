import Link from "next/link";
import { getAllPartRecords } from "@/domains/inventory";
import { getLowStockParts } from "@/domains/purchasing";
import { PartStockPanel } from "./part-stock-panel";

export const metadata = { title: "Parts" };

/**
 * A searchable-by-eye list of every part Chris has ever logged, across all
 * models — useful when he's fixing a DIFFERENT unit of a model he's already
 * looked up a part for, without having to find that original unit first.
 * See the per-model version on an appliance's own detail page for adding
 * new parts. Stock tracking (2026-09-29, "Purchasing & supplies" — see
 * docs/BUSINESS-RULES.md) is shown right here too, since this is where
 * Chris already looks a part up.
 */
export default async function PartsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === "1";
  const [partRecords, lowStockParts] = await Promise.all([getAllPartRecords({ includeArchived: showArchived }), getLowStockParts()]);
  const lowStockIds = new Set(lowStockParts.map((p) => p.id));

  return (
    <div>
      <h1 className="text-xl font-semibold">Parts</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Every part you&apos;ve logged, by model number. To add a new one, go
        to an appliance of that model and use the &ldquo;Parts for this
        model&rdquo; section on its page.
      </p>

      <p className="mt-3 text-sm">
        {showArchived ? (
          <Link href="/desk/parts" className="text-primary underline">
            Hide archived parts
          </Link>
        ) : (
          <Link href="/desk/parts?archived=1" className="text-primary underline">
            Show archived parts
          </Link>
        )}
      </p>

      {lowStockParts.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            {lowStockParts.length} {lowStockParts.length === 1 ? "part is" : "parts are"} running low:
          </p>
          <ul className="mt-1 list-inside list-disc">
            {lowStockParts.map((p) => (
              <li key={p.id}>
                {p.modelNumber} — {p.partNumber} ({p.quantityOnHand} on hand, flagged at {p.reorderThreshold})
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            Start a{" "}
            <Link href="/desk/purchase-orders/new" className="underline">
              purchase order
            </Link>{" "}
            to restock.
          </p>
        </div>
      )}

      {partRecords.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          No parts logged yet — they&apos;ll show up here once you save one
          from an appliance&apos;s page.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
          {partRecords.map((p) => (
            <li key={p.id} className="px-4 py-4">
              <p className="font-medium text-ink">
                {p.modelNumber}
                {p.manufacturer ? ` (${p.manufacturer})` : ""}
                {p.applianceType ? ` — ${p.applianceType.name}` : ""}
                {p.archivedAt ? " — archived" : ""}
              </p>
              <p className="text-sm text-ink-soft">
                Part {p.partNumber}
                {p.partName ? ` — ${p.partName}` : ""}
              </p>
              {p.notes && <p className="text-sm text-ink-soft">{p.notes}</p>}
              <p className="mt-2 text-sm">
                <Link href={`/desk/parts/${p.id}`} className="text-primary underline">
                  View stock movement history
                </Link>
              </p>
              <PartStockPanel
                partRecordId={p.id}
                quantityOnHand={p.quantityOnHand}
                reorderThreshold={p.reorderThreshold}
                lowStock={lowStockIds.has(p.id)}
                archived={p.archivedAt !== null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
