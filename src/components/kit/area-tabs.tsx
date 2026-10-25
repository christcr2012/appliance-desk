"use client";
// AR-0 kit 4.2: an area's sections as a row of links. The caller passes only the items this role may see (filtered on
// the server); `hidden` items are skipped. Current = exact path match, otherwise the longest matching prefix.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export type AreaTabItem = { href: string; label: string; count?: number; hidden?: boolean };

function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

/**
 * Index of the current item. The path must equal the item's path or sit under it; the longest path wins. An item with
 * a query (record tabs use `?tab=`) also needs each of its params to match the page's. When the page has no matching
 * query (for example a record opened with no `?tab=`), the first item on that exact path is current.
 */
export function currentAreaTab(items: AreaTabItem[], pathname: string, search = ""): number {
  const params = new URLSearchParams(search);
  let best = -1;
  let bestScore = -1;
  let firstOnPath = -1;
  items.forEach((item, index) => {
    const path = pathOf(item.href);
    const underPath = pathname === path || pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
    if (!underPath) return;
    if (pathname === path && firstOnPath < 0) firstOnPath = index;
    const query = new URLSearchParams(item.href.includes("?") ? item.href.slice(item.href.indexOf("?") + 1) : "");
    const wanted = [...query.entries()];
    if (wanted.some(([key, value]) => params.get(key) !== value)) return;
    const score = path.length * 100 + wanted.length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best >= 0 ? best : firstOnPath;
}

export function AreaTabs({ label, items }: { label: string; items: AreaTabItem[] }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const visible = items.filter((item) => !item.hidden);
  const current = currentAreaTab(visible, pathname, search);
  const currentRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [current]);
  return (
    <nav aria-label={label} className="-mx-5 border-b border-line lg:mx-0">
      <ul className="flex gap-1 overflow-x-auto px-5 [scrollbar-width:none] lg:px-0 [&::-webkit-scrollbar]:hidden">
        {visible.map((item, index) => {
          const isCurrent = index === current;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                ref={isCurrent ? currentRef : undefined}
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 border-b-[3px] px-3 text-[15px] whitespace-nowrap lg:min-h-10 ${
                  isCurrent ? "border-primary font-extrabold text-primary" : "border-transparent font-semibold text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
                {item.count !== undefined ? <> <span className="text-sm tabular-nums">{item.count}</span></> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
