/**
 * W-8 (D-W6): screens that used to be separate menu entries are tabs inside one entry. Every tab is an existing
 * address, so nothing moved; the tabs just let the owner switch between them. Role limits are applied here and
 * again by each page, so a tab is never shown to someone who cannot open it.
 */
export type DeskSectionKey = "schedule" | "equipment" | "money";
export type DeskSectionTab = { href: string; label: string; restriction?: "finance" };

export const DESK_SECTIONS: Record<DeskSectionKey, { label: string; tabs: DeskSectionTab[] }> = {
  schedule: {
    label: "Schedule",
    tabs: [
      { href: "/desk/dispatch", label: "Dispatch board" },
      { href: "/desk/jobs", label: "Jobs" },
      { href: "/desk/driver", label: "Driver view" },
    ],
  },
  equipment: {
    label: "Equipment",
    tabs: [
      { href: "/desk/inventory", label: "Inventory" },
      { href: "/desk/inventory/retired", label: "Retired", restriction: "finance" },
      { href: "/desk/recalls", label: "Recalls", restriction: "finance" },
      { href: "/desk/parts", label: "Parts" },
      { href: "/desk/purchases", label: "Purchases", restriction: "finance" },
      { href: "/desk/purchase-orders", label: "Purchase orders", restriction: "finance" },
    ],
  },
  money: {
    label: "Money",
    tabs: [
      { href: "/desk/billing", label: "Billing", restriction: "finance" },
      { href: "/desk/disputes", label: "Disputes", restriction: "finance" },
      { href: "/desk/sales", label: "Shop sales", restriction: "finance" },
      { href: "/desk/revenue", label: "Revenue", restriction: "finance" },
      { href: "/desk/books", label: "Books", restriction: "finance" },
      { href: "/desk/fleet", label: "Fleet", restriction: "finance" },
      { href: "/desk/reports", label: "Reports", restriction: "finance" },
      { href: "/desk/dashboard", label: "Business overview", restriction: "finance" },
    ],
  },
};

export function deskSectionTabs(section: DeskSectionKey, role?: string): DeskSectionTab[] {
  if (!["OWNER", "ADMIN", "STAFF"].includes(role ?? "")) return [];
  const finance = role === "OWNER" || role === "ADMIN";
  return DESK_SECTIONS[section].tabs.filter((tab) => !tab.restriction || finance);
}

/** The tab whose address matches best; null outside the section. */
export function activeSectionTab(pathname: string, tabs: DeskSectionTab[]): string | null {
  return tabs
    .filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}
