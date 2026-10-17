"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeSectionTab, type DeskSectionTab } from "@/lib/desk-sections";

export function SectionTabsNav({ label, tabs }: { label: string; tabs: DeskSectionTab[] }) {
  const active = activeSectionTab(usePathname(), tabs);
  return (
    <nav aria-label={label} className="print:hidden mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={active === tab.href ? "page" : undefined}
          className={`rounded-lg border px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
            active === tab.href ? "border-action bg-action text-on-action" : "border-border bg-card hover:bg-accent"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
