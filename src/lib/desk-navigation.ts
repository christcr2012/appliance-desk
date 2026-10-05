export type DeskNavGroup = {
  label: string;
  links: { href: string; label: string }[];
};
const groups = [
  {
    label: "Today",
    links: [
      ["today", "Today"],
      ["tasks", "Tasks"],
    ],
  },
  {
    label: "Customers & sales",
    links: [
      ["leads", "Leads"],
      ["customers", "Customers"],
      ["estimates", "Estimates", "finance"],
      ["agreements", "Agreements"],
    ],
  },
  {
    label: "Service",
    links: [
      ["dispatch", "Dispatch"],
      ["jobs", "Jobs"],
      ["maintenance", "Maintenance"],
      ["driver", "Driver view"],
    ],
  },
  {
    label: "Equipment",
    links: [
      ["inventory", "Inventory"],
      ["fleet", "Fleet", "finance"],
      ["parts", "Parts"],
      ["purchase-orders", "Purchase orders", "finance"],
      ["suppliers", "Suppliers", "finance"],
    ],
  },
  {
    label: "Money",
    links: [
      ["dashboard", "Business overview", "finance"],
      ["billing", "Billing", "finance"],
      ["revenue", "Revenue", "finance"],
      ["reports", "Reports", "finance"],
    ],
  },
  {
    label: "Growth",
    links: [
      ["growth", "Growth signals", "finance"],
      ["launch", "Launch list", "finance"],
    ],
  },
  {
    label: "Settings & activity",
    links: [
      ["settings", "Settings", "finance"],
      ["privacy", "Privacy requests", "owner"],
      ["activity", "Activity"],
    ],
  },
];

/** Called on the server: restricted destinations are never serialized to staff. */
export function deskNavigation(role?: string): DeskNavGroup[] {
  if (!["OWNER", "ADMIN", "STAFF"].includes(role ?? "")) return [];
  const finance = role === "OWNER" || role === "ADMIN";
  return groups
    .map((group) => ({
      label: group.label,
      links: group.links
        .filter((link) => {
          const restriction = link[2];
          return !restriction || (restriction === "finance" && finance) || (restriction === "owner" && role === "OWNER");
        })
        .map(([path, label]) => ({ href: `/desk/${path}`, label })),
    }))
    .filter((group) => group.links.length > 0);
}

export function activeDeskHref(
  pathname: string,
  groups: DeskNavGroup[],
): string | undefined {
  return groups
    .flatMap((group) => group.links)
    .filter(
      (link) => pathname === link.href || pathname.startsWith(`${link.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
