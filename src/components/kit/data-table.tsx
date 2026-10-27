// AR-0 kit 4.5: the list. Phones get one card per row; desktop gets a table whose rows open the side panel
// (?open=<key>). Rendered on the server: cells and cards are server-rendered; only the row click, sort links and bulk
// selection run in the browser.
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BulkAllCheckbox,
  BulkCheckbox,
  BulkSelection,
  PanelLink,
  PanelRow,
  SortHeaderLink,
} from "./data-table-client";
import { OverflowMenu } from "./overflow-menu";
import { MobileSwipeCard } from "./mobile-swipe-card";
import { RecordTitleTransition } from "./record-title-transition";
import type { ConfirmSpec, FormAction, MenuItem } from "./types";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  sortValue?: string; // a SortDef value; makes the header a sort link
  widthClass?: string;
  /** Hidden in the narrow desktop range (1024–1279 px) so the table still fits beside the side panel. */
  desktopOnly?: boolean;
};

export type DataTableProps<T> = {
  caption: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  mobileCard: (row: T) => ReactNode; // phone rendering of one row
  rowHref?: (row: T) => string; // full record page (phone tap, desktop "Open full page")
  panelParam?: string; // default "open": desktop row click sets ?open=<rowKey>
  selectedKey?: string; // row highlighted (the open panel row)
  rowActions?: (row: T) => MenuItem[]; // ⋯ menu per row
  bulkActions?: { label: string; action: FormAction; confirm?: ConfirmSpec }[];
  empty: ReactNode; // an EmptyState
  nextHref?: string | null; // cursor link for "Load more"
  /** The 500-row window cap was reached (KIT 5.1): show "Narrow your filters to see more" instead of Load more. */
  capReached?: boolean;
  /** Phone cards that hold their own buttons set this to false and link their own title (no link around the card). */
  mobileCardLink?: boolean;
  currentSort?: string;
};

export const LOAD_MORE_LABEL = "Load more";
export const CAP_REACHED_LABEL = "Narrow your filters to see more";

export function DataTable<T>({
  caption,
  rows,
  rowKey,
  columns,
  mobileCard,
  rowHref,
  panelParam = "open",
  selectedKey,
  rowActions,
  bulkActions,
  empty,
  nextHref,
  capReached = false,
  mobileCardLink = true,
  currentSort,
}: DataTableProps<T>) {
  if (rows.length === 0) return <>{empty}</>;
  const keys = rows.map(rowKey);
  const bulk = (bulkActions?.length ?? 0) > 0;
  const align = (column: Column<T>) => (column.align === "right" ? "text-right" : "text-left");
  const hideNarrow = (column: Column<T>) => (column.desktopOnly ? "hidden xl:table-cell" : "");

  const phone = (
    <ul className="flex flex-col gap-2.5 lg:hidden" aria-label={caption}>
      {rows.map((row, index) => {
        const key = keys[index];
        const card = <div className="min-w-0 flex-1">{mobileCard(row)}</div>;
        const href = rowHref?.(row);
        const menu = rowActions?.(row) ?? [];
        return (
          <MobileSwipeCard key={key} actions={menu} label={`row ${index + 1}`}>
            {bulk ? (
              <span className="flex min-h-11 items-center">
                <BulkCheckbox rowKey={key} label={`Select row ${index + 1}`} />
              </span>
            ) : null}
            {href && mobileCardLink ? (
              <Link href={href} className="block min-w-0 flex-1 text-ink">
                {card}
              </Link>
            ) : (
              card
            )}
            {menu.length > 0 ? (
              <OverflowMenu items={menu} label={`More for row ${index + 1}`} />
            ) : null}
          </MobileSwipeCard>
        );
      })}
    </ul>
  );

  const desktop = (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-surface lg:block">
      <table className="w-full border-collapse text-[15px] tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line text-xs font-bold text-ink-soft">
            {bulk ? (
              <th scope="col" className="w-10 px-4 py-2.5">
                <BulkAllCheckbox keys={keys} />
              </th>
            ) : null}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-2.5 ${align(column)} ${column.widthClass ?? ""} ${hideNarrow(column)}`}
              >
                {column.sortValue ? (
                  <SortHeaderLink value={column.sortValue} current={currentSort}>
                    {column.header}
                  </SortHeaderLink>
                ) : (
                  column.header
                )}
              </th>
            ))}
            {rowActions ? (
              <th scope="col" className="w-14 px-2 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = keys[index];
            const menu = rowActions?.(row) ?? [];
            return (
              <PanelRow key={key} rowKey={key} panelParam={panelParam} selected={key === selectedKey}>
                {bulk ? (
                  <td className="px-4 py-3">
                    <BulkCheckbox rowKey={key} label={`Select row ${index + 1}`} />
                  </td>
                ) : null}
                {columns.map((column, columnIndex) => (
                  <td key={column.key} className={`px-4 py-3 ${align(column)} ${column.widthClass ?? ""} ${hideNarrow(column)}`}>
                    {columnIndex === 0 ? (
                      <PanelLink rowKey={key} panelParam={panelParam}>
                        <RecordTitleTransition id={key}>{column.cell(row)}</RecordTitleTransition>
                      </PanelLink>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
                {rowActions ? (
                  <td className="px-2 py-1.5 text-right">
                    {menu.length > 0 ? <OverflowMenu items={menu} label={`More for row ${index + 1}`} /> : null}
                  </td>
                ) : null}
              </PanelRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const footer = capReached ? (
    <p className="py-4 text-center text-sm text-ink-soft">{CAP_REACHED_LABEL}</p>
  ) : nextHref ? (
    <div className="flex justify-center py-4">
      <Link
        href={nextHref}
        scroll={false}
        className="inline-flex min-h-11 items-center rounded-field border border-line-strong bg-surface px-5 text-[15px] font-bold text-ink hover:bg-tint lg:h-10 lg:min-h-0"
      >
        {LOAD_MORE_LABEL}
      </Link>
    </div>
  ) : null;

  const body = (
    <>
      {phone}
      {desktop}
      {footer}
    </>
  );
  return bulk ? <BulkSelection actions={bulkActions!}>{body}</BulkSelection> : body;
}
