export type DeskNavGroup = {
  label: string;
  links: { href: string; label: string }[];
};
/**
 * W-8 (D-W6): the desk menu has 14 entries. Screens that used to be separate entries (Dispatch, Jobs, Driver view;
 * Parts and Purchase orders; Revenue, Reports, Fleet, Business overview) are reached as tabs inside Schedule,
 * Equipment and Money (see desk-sections.ts), and the rarely used screens live on the More page. Every old address
 * still works; the aliases below only keep the right menu entry highlighted on those screens.
 */
const groups = [
  {
    label: "Today",
    links: [
      ["today", "Today"],
      ["tasks", "Tasks"],
    ],
  },
  {
    label: "Customers",
    links: [
      ["leads", "Leads"],
      ["customers", "Customers"],
      ["estimates", "Quotes", "finance"],
      ["communications", "Communications"],
      ["agreements", "Rentals"],
    ],
  },
  {
    label: "Work",
    links: [
      ["dispatch", "Schedule"],
      ["maintenance", "Repairs"],
      ["inventory", "Equipment"],
    ],
  },
  {
    label: "Money & taxes",
    links: [
      ["billing", "Money", "finance"],
      ["sales-tax", "Taxes", "finance"],
      ["expenses", "Expenses"],
    ],
  },
  {
    label: "Settings & more",
    links: [
      ["settings", "Settings", "finance"],
      ["more", "More"],
    ],
  },
];

/** Screens that belong to a menu entry without being in the menu themselves (highlight only). */
export const DESK_NAV_ALIASES: Record<string, string[]> = {
  "/desk/dispatch": ["/desk/jobs", "/desk/driver"],
  "/desk/inventory": ["/desk/parts", "/desk/purchases", "/desk/purchase-orders"],
  "/desk/billing": ["/desk/revenue", "/desk/reports", "/desk/fleet", "/desk/dashboard"],
  "/desk/more": [
    "/desk/suppliers", "/desk/growth", "/desk/launch", "/desk/automations", "/desk/privacy", "/desk/activity",
  ],
};

export type DeskMoreLink = { href: string; label: string; detail: string };
const MORE_LINKS: Array<[string, string, string, "finance" | "owner" | undefined]> = [
  ["suppliers", "Suppliers", "Who you buy appliances and parts from.", "finance"],
  ["growth", "Growth signals", "Early signs of where demand is heading.", "finance"],
  ["launch", "Launch list", "What is left before you open to real customers.", "finance"],
  ["automations", "System health", "Whether the background jobs and connections are running.", "finance"],
  ["settings/website", "Website", "Change the words, pictures and promotions on your public website.", "finance"],
  ["privacy", "Privacy requests", "Customers asking to see or delete their information.", "owner"],
  ["activity", "Activity", "Who changed what, and when.", undefined],
];
/** The rarely used screens, filtered for the role on the server like the menu itself. */
export function deskMoreLinks(role?: string): DeskMoreLink[] {
  if (!["OWNER", "ADMIN", "STAFF"].includes(role ?? "")) return [];
  const finance = role === "OWNER" || role === "ADMIN";
  return MORE_LINKS
    .filter(([, , , restriction]) => !restriction || (restriction === "finance" && finance) || (restriction === "owner" && role === "OWNER"))
    .map(([path, label, detail]) => ({ href: `/desk/${path}`, label, detail }));
}

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
  const within = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return groups
    .flatMap((group) => group.links)
    .flatMap((link) => [link.href, ...(DESK_NAV_ALIASES[link.href] ?? [])]
      .filter(within)
      .map((matched) => ({ href: link.href, length: matched.length })))
    .sort((a, b) => b.length - a.length)[0]?.href;
}


/**
 * Phone tabs are derived from the already role-filtered desk navigation.
 * Restricted destinations are never introduced here.
 */
export function deskBottomTabLinks(
  role: string,
  groups: DeskNavGroup[],
): { href: string; label: string }[] {
  const allowed = new Map(
    groups.flatMap((group) => group.links).map((link) => [link.href, link]),
  );
  const preferred =
    role === "STAFF"
      ? [
          ["/desk/today", "Today"],
          ["/desk/dispatch", "Schedule"],
          ["/desk/inventory", "Equipment"],
          ["/desk/customers", "Customers"],
        ]
      : [
          ["/desk/today", "Today"],
          ["/desk/dispatch", "Schedule"],
          ["/desk/customers", "Customers"],
          ["/desk/billing", "Money"],
        ];

  return preferred.flatMap(([href, label]) =>
    allowed.has(href) ? [{ href, label }] : [],
  );
}
