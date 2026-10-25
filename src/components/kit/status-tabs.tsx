"use client";
// AR-0 kit 4.3: filter a list by status, with counts. Each tab is a link that sets ?{param}=value, drops `cursor` and
// keeps every other param. Pill chips on phones, a segmented control on desktop.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type StatusTabItem = { value: string; label: string; count?: number; hideWhenZero?: boolean };

export function statusTabHref(pathname: string, search: string, param: string, value: string): string {
  const params = new URLSearchParams(search);
  params.set(param, value);
  params.delete("cursor");
  return `${pathname}?${params.toString()}`;
}

export function StatusTabs({
  label,
  param = "status",
  current,
  items,
}: {
  label: string;
  param?: string;
  current: string;
  items: StatusTabItem[];
}) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const shown = items.filter((item) => !(item.hideWhenZero && item.count === 0 && item.value !== current));
  return (
    <nav aria-label={label} className="-mx-5 lg:mx-0">
      <ul className="flex gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] lg:inline-flex lg:gap-1 lg:overflow-visible lg:rounded-field lg:bg-tint lg:p-1 [&::-webkit-scrollbar]:hidden">
        {shown.map((item) => {
          const isCurrent = item.value === current;
          return (
            <li key={item.value} className="shrink-0">
              <Link
                href={statusTabHref(pathname, search, param, item.value)}
                scroll={false}
                aria-current={isCurrent ? "page" : undefined}
                // The 36 px chip gets a 44 px tall tap area from the invisible ::before.
                className={`relative inline-flex h-9 items-center before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] gap-1.5 rounded-full px-3.5 text-sm font-bold whitespace-nowrap lg:rounded-field ${
                  isCurrent
                    ? "bg-primary text-on-primary lg:bg-surface lg:text-ink lg:shadow-sm"
                    : "border border-line bg-surface text-ink hover:bg-tint lg:border-transparent lg:bg-transparent lg:text-ink-soft"
                }`}
              >
                {item.label}
                {item.count !== undefined ? <> <span className="tabular-nums">{item.count}</span></> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
