/**
 * The one definition of "tax setup is in place". The Taxes → Setup overview and the first-time setup
 * checklist on Today both call these functions, so they can never disagree about what counts as done.
 * Pure functions on plain facts: no database, no side effects.
 */

export type SetupFilingAccountFacts = {
  name: string;
  kind: string;
  accountNumber: string | null;
  portalUrl: string | null;
  firstPeriodStart: Date | null;
  basis: string;
  /** MONTHLY, QUARTERLY or ANNUAL; always has a starting value, so it is shown rather than asked. */
  frequency: string;
};

export type BusinessTaxLocationFacts = {
  status: string;
  jurisdictions: ReadonlyArray<{ jurisdiction: { useTaxFilingAccountId: string | null } }>;
};

/** A Colorado sales tax account with its number, filing website, reporting basis and first filing period. */
export function hasCompleteSalesAccount(
  accounts: ReadonlyArray<Pick<SetupFilingAccountFacts,
    "kind" | "accountNumber" | "portalUrl" | "firstPeriodStart" | "basis">>,
): boolean {
  return accounts.some(account =>
    account.kind === "SALES_RETURN" && Boolean(account.accountNumber) &&
    Boolean(account.portalUrl) && Boolean(account.firstPeriodStart) &&
    account.basis !== "UNDECIDED");
}

/** Every active filing account has a first filing period, and at least one account exists. */
export function allFilingStartsRecorded(activeAccountCount: number, configuredStartCount: number): boolean {
  return activeAccountCount > 0 && configuredStartCount === activeAccountCount;
}

/** The business address is confirmed and every business tax area has a use-tax filing account. */
export function areUseTaxAccountsLinked(location: BusinessTaxLocationFacts | null | undefined): boolean {
  return Boolean(location && location.status === "VERIFIED" && location.jurisdictions.length &&
    location.jurisdictions.every(area => area.jurisdiction.useTaxFilingAccountId));
}

export type TaxSetupFacts = {
  accounts: ReadonlyArray<SetupFilingAccountFacts>;
  activeAccountCount: number;
  configuredStartCount: number;
  businessLocation: BusinessTaxLocationFacts | null;
};

/**
 * What is still missing, in plain words and in the order an owner would fix it. Empty means tax setup
 * is in place. The empty/non-empty answer is exactly the three shared predicates above.
 */
export function taxSetupGaps(facts: TaxSetupFacts): string[] {
  const gaps: string[] = [];
  if (!hasCompleteSalesAccount(facts.accounts)) {
    const account = facts.accounts.find(candidate => candidate.kind === "SALES_RETURN");
    if (!account) {
      gaps.push("Add your Colorado sales tax account.");
    } else {
      const missing = [
        !account.accountNumber && "your sales tax account number",
        account.basis === "UNDECIDED" && "how you report sales tax (cash or accrual; ask your accountant if unsure)",
        !account.firstPeriodStart && "your first filing period",
        !account.portalUrl && "the website you file on",
      ].filter((item): item is string => Boolean(item));
      gaps.push(`Enter ${missing.join(", ")}.`);
    }
  }
  if (!facts.businessLocation || facts.businessLocation.status !== "VERIFIED" ||
    facts.businessLocation.jurisdictions.length === 0) {
    gaps.push("Confirm your business address for tax.");
  } else {
    const unlinked = facts.businessLocation.jurisdictions
      .filter(area => !area.jurisdiction.useTaxFilingAccountId).length;
    if (unlinked > 0) {
      gaps.push(`Link a use-tax account for ${unlinked === 1 ? "1 tax area" : `${unlinked} tax areas`} (Colorado and Greeley).`);
    }
  }
  if (!allFilingStartsRecorded(facts.activeAccountCount, facts.configuredStartCount)) {
    gaps.push("Set the first filing period for every filing account.");
  }
  return gaps;
}
