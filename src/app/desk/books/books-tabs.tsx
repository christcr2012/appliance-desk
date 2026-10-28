"use client";
// AR-7: the Books sub-tab strip (mirrors the Taxes family's taxes-tabs pattern).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOOKS_TABS, activeBooksTab } from "@/lib/books-tabs";

export function BooksTabs({ budgetsOn }: { budgetsOn: boolean }) {
  const active = activeBooksTab(usePathname());
  const tabs = BOOKS_TABS.filter((tab) => tab.key !== "budget" || budgetsOn);
  return (
    <nav aria-label="Books sections" className="print:hidden flex flex-wrap gap-2 border-b border-border pb-3">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`rounded-lg border px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
            active === tab.key ? "border-action bg-action text-on-action" : "border-border bg-card hover:bg-accent"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
