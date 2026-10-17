"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAXES_TABS, activeTaxesTab } from "@/lib/taxes-tabs";

export function TaxesTabs() {
  const active = activeTaxesTab(usePathname());
  return (
    <nav aria-label="Taxes sections" className="print:hidden flex flex-wrap gap-2 border-b border-border pb-3">
      {TAXES_TABS.map((tab) => (
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
