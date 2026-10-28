// AR-12: hiding a feature only changes navigation; URLs and authorization remain unchanged.
export const FEATURE_KEYS = ["team", "propertyManagers", "budget", "accountantExports", "bankStatements", "spanishDocuments", "phoneCosts"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
type AutoKind = "teamOfTwo" | "hasPropertyManager" | "budgetInUse";
export type FeatureSpec = { label: string; line: string; hides: string[]; auto?: AutoKind };
export const FEATURES: Record<FeatureKey, FeatureSpec> = {
  team: { label: "Team", line: "Assign work, set what each person can see.", hides: ["/desk/dispatch", "/desk/settings/permissions", "/desk/approvals"], auto: "teamOfTwo" },
  propertyManagers: { label: "Property managers", line: "Many locations and tenants under one customer.", hides: ["/desk/customers/*/locations"], auto: "hasPropertyManager" },
  budget: { label: "Budget envelopes", line: "Set money aside for each kind of spending.", hides: ["/desk/books/budget"], auto: "budgetInUse" },
  accountantExports: { label: "Files for your accountant", line: "Download your records for an accountant or tax software.", hides: ["/desk/books/exports", "/desk/books/export"] },
  bankStatements: { label: "Bank statements", line: "Upload bank statements and match them to your records.", hides: ["/desk/books/cash"] },
  spanishDocuments: { label: "Spanish documents", line: "Send quotes, rentals and bills in Spanish.", hides: [] },
  phoneCosts: { label: "Phone and texting costs", line: "See what calls and texts cost each month.", hides: ["/desk/settings/telecom"] },
};

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURES, value);
}

export function savedFeatureKeys(value: readonly string[] | null | undefined): Set<FeatureKey> {
  return new Set((value ?? []).filter(isFeatureKey));
}

export function automaticFeatureReasons(input: {
  activeTeam: number; hasPropertyManager: boolean; cashBudgetEnabled: boolean;
}): Map<FeatureKey, string> {
  const found = new Map<FeatureKey, string>();
  if (input.activeTeam >= 2) found.set("team", "Shown because 2 or more people are on your team.");
  if (input.hasPropertyManager) found.set("propertyManagers", "Shown because you already have a property-manager customer or lead.");
  if (input.cashBudgetEnabled) found.set("budget", "Shown because you already use the cash budget.");
  return found;
}

export function shownFeatureKeys(stored: readonly string[] | null | undefined, automatic: ReadonlyMap<FeatureKey, string>): Set<FeatureKey> {
  return new Set([...savedFeatureKeys(stored), ...automatic.keys()]);
}

/** Prefixes match a complete path segment, never /desk/books/cashier when /cash is hidden. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix.includes("*")) {
    const pieces = prefix.split("/");
    const actual = path.split("/");
    return actual.length >= pieces.length && pieces.every((part, i) =>
      part === "*" ? Boolean(actual[i]) : actual[i] === part
    );
  }
  return path === prefix || path.startsWith(prefix + "/");
}

export function isHrefHidden(href: string, shown: ReadonlySet<FeatureKey>): boolean {
  const path = href.split("?")[0]!.split("#")[0]!;
  return FEATURE_KEYS.some(key => !shown.has(key) && FEATURES[key].hides.some(prefix => matchesPrefix(path, prefix)));
}
