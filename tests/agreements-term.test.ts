import { describe, expect, it } from "vitest";
import {
  autoRenewPolicyReady,
  loadTerminationPolicy,
  quoteEarlyTermination,
  type TermAgreement,
  type TerminationPolicy,
} from "@/domains/agreements/term";

const basePolicy: TerminationPolicy = {
  feeCents: null,
  feePercent: null,
  feeCapCents: null,
  noticeDays: 30,
  unusedTerm: "CREDIT",
  version: "test-version",
};

// 12 billing periods, first billed Nov 8 2026 (Colorado), term ends Nov 7 2027.
const agreement: TermAgreement = {
  termMonths: 12,
  endDate: new Date("2027-11-08T06:59:59Z"),
  nextBillingDate: new Date("2026-11-08T19:00:00Z"),
  monthlyTotalCents: 6000,
  unpaidBalanceCents: 0,
  paidInFullInAdvance: false,
};
const requestedOn = new Date("2026-10-03T12:00:00Z");

describe("loadTerminationPolicy: null means not available, never a default", () => {
  const complete = {
    earlyTerminationFeeCents: 5000,
    earlyTerminationNoticeDays: 30,
    unusedTermTreatment: "CREDIT",
    terminationTermsText: "Ending early costs the fee below.",
  };

  it("is null when nothing is set", () => {
    expect(loadTerminationPolicy({})).toBeNull();
  });

  it("is null when notice days, treatment, or both fee values are missing", () => {
    expect(loadTerminationPolicy({ ...complete, earlyTerminationNoticeDays: null })).toBeNull();
    expect(loadTerminationPolicy({ ...complete, unusedTermTreatment: null })).toBeNull();
    expect(loadTerminationPolicy({ ...complete, earlyTerminationFeeCents: null })).toBeNull();
  });

  it("is null while the wording customers will see is blank (nothing is offered without published terms)", () => {
    expect(loadTerminationPolicy({ ...complete, terminationTermsText: null })).toBeNull();
    expect(loadTerminationPolicy({ ...complete, terminationTermsText: "" })).toBeNull();
    expect(loadTerminationPolicy({ ...complete, terminationTermsText: "   " })).toBeNull();
  });

  it("is null for values that make no sense", () => {
    expect(loadTerminationPolicy({ ...complete, unusedTermTreatment: "KEEP" })).toBeNull();
    expect(loadTerminationPolicy({ ...complete, earlyTerminationFeeCents: -1 })).toBeNull();
    expect(loadTerminationPolicy({ ...complete, earlyTerminationNoticeDays: 1.5 })).toBeNull();
    expect(
      loadTerminationPolicy({
        earlyTerminationFeePercent: 101,
        earlyTerminationNoticeDays: 30,
        unusedTermTreatment: "RETAIN",
        terminationTermsText: "Terms.",
      }),
    ).toBeNull();
  });

  it("accepts a deliberate no-fee, no-notice policy (zero is a decision, null is not)", () => {
    const policy = loadTerminationPolicy({
      earlyTerminationFeeCents: 0,
      earlyTerminationNoticeDays: 0,
      unusedTermTreatment: "RETAIN",
      terminationTermsText: "No fee.",
    });
    expect(policy).toMatchObject({ feeCents: 0, noticeDays: 0, unusedTerm: "RETAIN" });
  });

  it("accepts a percent-only policy", () => {
    const policy = loadTerminationPolicy({
      earlyTerminationFeePercent: 50,
      earlyTerminationNoticeDays: 14,
      unusedTermTreatment: "REFUND",
      terminationTermsText: "Half of the rest.",
    });
    expect(policy).toMatchObject({ feeCents: null, feePercent: 50, feeCapCents: null });
  });

  it("changes the version whenever a value or the terms text changes, and only then", () => {
    const a = loadTerminationPolicy({ ...complete, terminationTermsText: "Terms A" });
    const same = loadTerminationPolicy({ ...complete, terminationTermsText: "Terms A" });
    const textChanged = loadTerminationPolicy({ ...complete, terminationTermsText: "Terms B" });
    const feeChanged = loadTerminationPolicy({
      ...complete,
      earlyTerminationFeeCents: 6000,
      terminationTermsText: "Terms A",
    });
    expect(a!.version).toBe(same!.version);
    expect(a!.version).not.toBe(textChanged!.version);
    expect(a!.version).not.toBe(feeChanged!.version);
  });
});

describe("autoRenewPolicyReady", () => {
  it("needs a notice period, a terms version and the terms text", () => {
    const ready = {
      autoRenewNoticeDays: 30,
      autoRenewTermsVersion: "2026-10",
      renewalTermsText: "We renew monthly.",
    };
    expect(autoRenewPolicyReady(ready)).toBe(true);
    expect(autoRenewPolicyReady({ ...ready, autoRenewNoticeDays: null })).toBe(false);
    expect(autoRenewPolicyReady({ ...ready, autoRenewTermsVersion: " " })).toBe(false);
    expect(autoRenewPolicyReady({ ...ready, renewalTermsText: null })).toBe(false);
    expect(autoRenewPolicyReady({})).toBe(false);
  });
});

describe("quoteEarlyTermination", () => {
  it("flat fee only", () => {
    const quote = quoteEarlyTermination(agreement, { ...basePolicy, feeCents: 5000 }, requestedOn);
    expect(quote.feeCents).toBe(5000);
    expect(quote.remainingTermMonths).toBe(12);
    expect(quote.remainingRentCents).toBe(72_000);
    expect(quote.effectiveOn.toISOString()).toBe("2026-11-08T07:00:00.000Z");
  });

  it("percent fee only", () => {
    const quote = quoteEarlyTermination(agreement, { ...basePolicy, feePercent: 10 }, requestedOn);
    expect(quote.feeCents).toBe(7200);
  });

  it("when both are set the larger one applies", () => {
    expect(
      quoteEarlyTermination(agreement, { ...basePolicy, feeCents: 5000, feePercent: 10 }, requestedOn)
        .feeCents,
    ).toBe(7200);
    expect(
      quoteEarlyTermination(agreement, { ...basePolicy, feeCents: 10_000, feePercent: 10 }, requestedOn)
        .feeCents,
    ).toBe(10_000);
  });

  it("the cap limits the fee", () => {
    const quote = quoteEarlyTermination(
      agreement,
      { ...basePolicy, feePercent: 10, feeCapCents: 6000 },
      requestedOn,
    );
    expect(quote.feeCents).toBe(6000);
  });

  it("a deliberate zero fee quotes zero", () => {
    expect(quoteEarlyTermination(agreement, { ...basePolicy, feeCents: 0 }, requestedOn).feeCents).toBe(0);
  });

  it("percent fees round half up to the cent", () => {
    const odd = { ...agreement, monthlyTotalCents: 1001 };
    // 12 * 1001 = 12012; 5% = 600.6 -> 601
    expect(quoteEarlyTermination(odd, { ...basePolicy, feePercent: 5 }, requestedOn).feeCents).toBe(601);
    // one month left at 1050: 5% = 52.5 -> 53
    const lastMonth = quoteEarlyTermination(
      { ...agreement, monthlyTotalCents: 1050 },
      { ...basePolicy, feePercent: 5 },
      new Date("2027-09-01T12:00:00Z"),
    );
    expect(lastMonth.remainingTermMonths).toBe(1);
    expect(lastMonth.feeCents).toBe(53);
  });

  it("notice pushes the end to the next billing anniversary, never mid-month", () => {
    // 45 days of notice from Oct 3 is Nov 17, so the first anniversary on or after it is Dec 8.
    const quote = quoteEarlyTermination(
      agreement,
      { ...basePolicy, noticeDays: 45, feePercent: 10 },
      requestedOn,
    );
    expect(quote.effectiveOn.toISOString()).toBe("2026-12-08T07:00:00.000Z");
    expect(quote.remainingTermMonths).toBe(11);
    expect(quote.remainingRentCents).toBe(66_000);
    expect(quote.feeCents).toBe(6600);
  });

  it("a request that lands after the last billing period leaves nothing to charge", () => {
    const quote = quoteEarlyTermination(
      agreement,
      { ...basePolicy, feeCents: 5000 },
      new Date("2027-10-01T12:00:00Z"),
    );
    expect(quote.remainingTermMonths).toBe(0);
    expect(quote.feeCents).toBe(0);
    expect(quote.effectiveOn.toISOString()).toBe("2027-11-08T07:00:00.000Z");
  });

  it("carries the unpaid balance and the policy version into the quote", () => {
    const quote = quoteEarlyTermination(
      { ...agreement, unpaidBalanceCents: 1234 },
      { ...basePolicy, feeCents: 100 },
      requestedOn,
    );
    expect(quote.unpaidBalanceCents).toBe(1234);
    expect(quote.policyVersion).toBe("test-version");
    expect(quote.unusedTermTreatment).toBe("CREDIT");
  });

  it("flags a prepaid term for owner review and reports the unused prepaid rent", () => {
    const quote = quoteEarlyTermination(
      { ...agreement, paidInFullInAdvance: true },
      { ...basePolicy, feeCents: 0 },
      requestedOn,
    );
    expect(quote.prepaidReviewRequired).toBe(true);
    expect(quote.unusedTermCents).toBe(72_000);
    expect(
      quoteEarlyTermination(agreement, { ...basePolicy, feeCents: 0 }, requestedOn).unusedTermCents,
    ).toBe(0);
  });

  it("refuses month-to-month agreements and agreements without a recorded end or billing date", () => {
    const policy = { ...basePolicy, feeCents: 0 };
    expect(() => quoteEarlyTermination({ ...agreement, termMonths: null }, policy, requestedOn)).toThrow(
      /fixed-term/,
    );
    expect(() => quoteEarlyTermination({ ...agreement, endDate: null }, policy, requestedOn)).toThrow(
      /fixed-term/,
    );
    expect(() =>
      quoteEarlyTermination({ ...agreement, nextBillingDate: null }, policy, requestedOn),
    ).toThrow(/fixed-term/);
  });

  it("is deterministic", () => {
    const policy = { ...basePolicy, feeCents: 5000, feePercent: 10 };
    expect(quoteEarlyTermination(agreement, policy, requestedOn)).toEqual(
      quoteEarlyTermination(agreement, policy, requestedOn),
    );
  });
});
