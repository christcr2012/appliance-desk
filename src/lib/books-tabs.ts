// AR-7 (BOOKS-TAXES 1): the Books sub-tab strip, shown on every Books page. "Money set aside"
// (the budget page) joins only when budgets are on — the caller filters it by cashBudgetEnabled.
export type BooksTab = { key: string; label: string; href: string };

export const BOOKS_TABS: BooksTab[] = [
  { key: "overview", label: "Overview", href: "/desk/books" },
  { key: "months", label: "Month by month", href: "/desk/books/months" },
  { key: "reports", label: "Reports", href: "/desk/books/reports" },
  { key: "assets", label: "Equipment value", href: "/desk/books/assets" },
  { key: "accountant", label: "For your accountant", href: "/desk/books/accountant" },
  { key: "budget", label: "Money set aside", href: "/desk/books/budget" },
];

/** Pages that live inside a tab without being the tab's own page. */
const EXTRA_MATCHES: Record<string, string> = {
  "/desk/books/closing": "reports",
  "/desk/books/exports": "accountant",
  "/desk/books/export": "accountant",
  "/desk/books/cash": "accountant",
  "/desk/books/setup": "overview",
};

export function activeBooksTab(pathname: string | null): string {
  if (!pathname) return "overview";
  for (const [prefix, key] of Object.entries(EXTRA_MATCHES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return key;
  }
  let best = "overview";
  let bestLength = -1;
  for (const tab of BOOKS_TABS) {
    if (tab.key === "overview") continue;
    if ((pathname === tab.href || pathname.startsWith(tab.href + "/")) && tab.href.length > bestLength) {
      best = tab.key;
      bestLength = tab.href.length;
    }
  }
  return best;
}
