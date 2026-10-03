import { describe, expect, it } from "vitest";
import { autoRenewWindowOpen } from "@/domains/agreements/auto-renew";
import { cancelAtSecondsForAgreement, cancelAtSecondsFor } from "@/domains/billing/subscription-term";
import { earlyEndingNotDoneException } from "@/domains/exceptions/rules";
import { categorizeLine } from "@/domains/billing/categories";

const termEnd = new Date("2027-11-08T06:59:59Z");

describe("auto-renew window", () => {
  it("opens exactly the customer's notice days before the term ends and closes when the term has run out", () => {
    const agreement = { endDate: termEnd, noticeDays: 30 };
    // Counted in Colorado calendar days to the renewal's first day (Nov 8): Oct 9 is exactly 30 days.
    expect(autoRenewWindowOpen(agreement, new Date("2027-10-09T18:00:00Z"))).toBe(true);
    expect(autoRenewWindowOpen(agreement, new Date("2027-10-08T18:00:00Z"))).toBe(false);
    // The boundary is Colorado midnight (MDT, UTC-6, still in effect on Oct 9), not UTC midnight.
    expect(autoRenewWindowOpen(agreement, new Date("2027-10-09T05:59:00Z"))).toBe(false);
    expect(autoRenewWindowOpen(agreement, new Date("2027-10-09T06:00:00Z"))).toBe(true);
    // Still open on the last day of the term, closed after it.
    expect(autoRenewWindowOpen(agreement, new Date("2027-11-08T06:00:00Z"))).toBe(true);
    expect(autoRenewWindowOpen(agreement, new Date("2027-11-09T00:00:00Z"))).toBe(false);
  });
});

describe("Stripe end date for an early ending", () => {
  const base = { termMonths: 12, endDate: termEnd };
  it("is the second before the ending date when that is earlier than the term end", () => {
    const effective = new Date("2027-03-08T07:00:00Z");
    expect(cancelAtSecondsForAgreement({ ...base, terminationEffectiveOn: effective })).toBe(
      Math.floor((effective.getTime() - 1000) / 1000),
    );
  });
  it("keeps the natural term end when the ending date is on or after it, or when nothing was requested", () => {
    const natural = cancelAtSecondsFor(base);
    expect(cancelAtSecondsForAgreement({ ...base, terminationEffectiveOn: new Date("2027-12-01T07:00:00Z") })).toBe(natural);
    expect(cancelAtSecondsForAgreement({ ...base, terminationEffectiveOn: null })).toBe(natural);
  });
});

describe("early ending exception and fee category", () => {
  it("explains a prepaid rental differently from a stuck ending", () => {
    const common = { id: "a", terminationEffectiveOn: new Date("2027-03-08T07:00:00Z"), customerName: "Pat" };
    expect(earlyEndingNotDoneException({ ...common, prepaid: true }).detail).toMatch(/paid in advance/);
    expect(earlyEndingNotDoneException({ ...common, prepaid: false }).detail).toMatch(/still active/);
  });
  it("groups the early ending fee with fees on statements", () => {
    expect(categorizeLine("EARLY_TERMINATION_FEE")).toBe("FEES");
  });
});
