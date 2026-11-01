"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionMenu, Sheet, StatusPill } from "@/components/kit";
import { formatMoney } from "@/lib/money-ui";
import type { PartListRow } from "@/domains/purchasing/parts-list";
import { setPartArchivedAction } from "../purchasing-actions";
import { PartStockPanel } from "./part-stock-panel";
import { PartSaleSettings } from "./part-sale-settings";

/**
 * AR-6b section 6: the Parts list. Rows are role-shaped by the domain —
 * staff rows carry no money keys and `canManage` is false, so staff see
 * the stock count and the low-stock pill only: no Selling column, no
 * reorder column, no menu, no edit controls. OWNER/ADMIN get the extra
 * columns and the ⋯ menu whose items open the existing stock/selling
 * panels in Sheets (the kit ActionMenu exists for sheet-opening items).
 */
export function PartsList({
  rows,
  canManage,
  nextHref,
}: {
  rows: PartListRow[];
  canManage: boolean;
  nextHref: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sheet, setSheet] = useState<{ part: PartListRow; kind: "stock" | "selling" } | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

  function toggleArchived(part: PartListRow) {
    setMenuError(null);
    startTransition(async () => {
      const result = await setPartArchivedAction(part.id, !part.archived);
      if (result.status === "error") {
        setMenuError(result.message);
        return;
      }
      router.refresh();
    });
  }

  const sheetPart = sheet?.part;

  return (
    <div className="space-y-3">
      {menuError && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {menuError}
        </p>
      )}
      <ul
        aria-label="Parts"
        className="divide-y divide-line rounded-card border border-line bg-surface"
      >
        {rows.map((part) => (
          <li key={part.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Link
                href={`/desk/parts/${part.id}`}
                className="font-semibold text-ink underline-offset-4 hover:underline"
              >
                {part.partName || `Part ${part.partNumber}`}
              </Link>
              <p className="mt-1 text-sm text-ink-soft">
                Fits {part.modelNumber}
                {part.applianceTypeName ? ` — ${part.applianceTypeName}` : ""}
                {" · "}Part {part.partNumber}
                {part.manufacturer ? ` · ${part.manufacturer}` : ""}
              </p>
              {part.notes && <p className="mt-1 text-sm text-ink-soft">{part.notes}</p>}
            </div>

            <div className="flex items-center gap-2 sm:w-40 sm:shrink-0">
              <span className={part.lowStock ? "font-semibold text-warning-ink" : "text-ink-soft"}>
                {part.quantityOnHand} on hand
              </span>
              {part.archived ? (
                <StatusPill tone="neutral" label="Archived" />
              ) : part.lowStock ? (
                <StatusPill tone="attention" label="Low stock" />
              ) : null}
            </div>

            {canManage && (
              <div className="hidden text-sm text-ink-soft md:block md:w-28 md:shrink-0">
                <span className="text-ink-faint">Reorder at </span>
                {part.reorderThreshold !== null ? part.reorderThreshold : "—"}
              </div>
            )}
            {canManage && (
              <div className="hidden text-sm text-ink-soft lg:block lg:w-44 lg:shrink-0">
                <span className="text-ink-faint">Selling: </span>
                {part.sellable && part.retailPriceCents != null
                  ? formatMoney(part.retailPriceCents)
                  : "Not for sale"}
              </div>
            )}

            {canManage && (
              <div className="shrink-0">
                <ActionMenu
                  label={`More for ${part.partName || `Part ${part.partNumber}`}`}
                  items={[
                    { label: "Adjust stock…", onSelect: () => setSheet({ part, kind: "stock" }) },
                    { label: "Selling…", onSelect: () => setSheet({ part, kind: "selling" }) },
                    {
                      label: part.archived ? "Restore" : "Archive",
                      onSelect: () => toggleArchived(part),
                    },
                  ]}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {nextHref && (
        <div className="flex justify-center">
          <Link
            href={nextHref}
            className="rounded-control border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
          >
            Load more
          </Link>
        </div>
      )}

      <Sheet
        open={sheet?.kind === "stock"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title="Adjust stock"
      >
        {sheetPart && (
          <PartStockPanel
            key={sheetPart.id}
            partRecordId={sheetPart.id}
            quantityOnHand={sheetPart.quantityOnHand}
            reorderThreshold={sheetPart.reorderThreshold}
            lowStock={sheetPart.lowStock}
            archived={sheetPart.archived}
            initialMode="settings"
          />
        )}
      </Sheet>

      <Sheet
        open={sheet?.kind === "selling"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title="Selling"
      >
        {sheetPart && (
          <PartSaleSettings
            key={sheetPart.id}
            partRecordId={sheetPart.id}
            sellable={sheetPart.sellable}
            retailPriceCents={sheetPart.retailPriceCents ?? null}
            defaultForResale={sheetPart.defaultForResale ?? false}
            averageCostCents={sheetPart.averageResaleCostCents ?? null}
            archived={sheetPart.archived}
            initialEditing
          />
        )}
      </Sheet>
    </div>
  );
}
