import type { ReactNode } from "react";

export type DataListColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  primary?: boolean;
  hideOnPhone?: boolean;
};

function rowKey<T>(row: T, index: number): string | number {
  if (
    typeof row === "object" &&
    row !== null &&
    "id" in row &&
    (typeof row.id === "string" || typeof row.id === "number")
  ) {
    return row.id;
  }
  return index;
}

export function DataList<T>({
  rows,
  columns,
  caption,
  empty,
}: {
  rows: T[];
  columns: DataListColumn<T>[];
  caption: string;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="px-3 py-3 font-semibold text-ink"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-4 align-top ${
                      column.primary ? "font-semibold text-ink" : "text-ink-soft"
                    }`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row, index) => (
          <li
            key={rowKey(row, index)}
            className="rounded-card border border-line bg-surface p-4"
          >
            <dl className="space-y-3">
              {columns
                .filter((column) => !column.hideOnPhone)
                .map((column) => (
                  <div key={column.key}>
                    <dt className="text-xs font-semibold text-ink-faint">
                      {column.header}
                    </dt>
                    <dd
                      className={`mt-1 ${
                        column.primary
                          ? "font-semibold text-ink"
                          : "text-sm text-ink-soft"
                      }`}
                    >
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
