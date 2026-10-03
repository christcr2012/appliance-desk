import { describe, expect, it } from "vitest";
import {
  autoRenewTermsVersionFor,
  termsPolicyDefaults,
  termsPolicyStatus,
  termsPolicyUpdate,
} from "@/domains/settings/terms-policy";
import { loadTerminationPolicy } from "@/domains/agreements/term-policy";

const blank = {
  feeDollars: "",
  feePercent: "",
  feeCapDollars: "",
  noticeDays: "",
  unusedTerm: "",
  terminationTermsText: "",
  autoRenewNoticeDays: "",
  renewalTermsText: "",
};

function ok(raw: Record<string, unknown>) {
  const result = termsPolicyUpdate({ ...blank, ...raw });
  if (!result.success) throw new Error(result.message);
  return result.update;
}
function fail(raw: Record<string, unknown>) {
  const result = termsPolicyUpdate({ ...blank, ...raw });
  if (result.success) throw new Error("expected a rejection");
  return result.message;
}

describe("termsPolicyUpdate: what the owner types becomes saved settings", () => {
  it("an untouched form saves everything as 'not decided yet' (null), never a default", () => {
    expect(ok({})).toEqual({
      earlyTerminationFeeCents: null,
      earlyTerminationFeePercent: null,
      earlyTerminationFeeCapCents: null,
      earlyTerminationNoticeDays: null,
      unusedTermTreatment: null,
      terminationTermsText: null,
      autoRenewNoticeDays: null,
      renewalTermsText: null,
      autoRenewTermsVersion: null,
    });
  });

  it("converts dollars to whole cents without floating-point drift", () => {
    expect(ok({ feeDollars: "49.99" }).earlyTerminationFeeCents).toBe(4999);
    expect(ok({ feeDollars: "$50" }).earlyTerminationFeeCents).toBe(5000);
    expect(ok({ feeDollars: "0.1" }).earlyTerminationFeeCents).toBe(10);
    expect(ok({ feeDollars: "1.15" }).earlyTerminationFeeCents).toBe(115);
    expect(ok({ feeDollars: "0" }).earlyTerminationFeeCents).toBe(0);
  });

  it("saves a full policy exactly as typed", () => {
    expect(
      ok({
        feeDollars: "75",
        feePercent: "25",
        feeCapDollars: "400.50",
        noticeDays: "30",
        unusedTerm: "CREDIT",
        terminationTermsText: "  Ending early costs the fee below.  ",
      }),
    ).toMatchObject({
      earlyTerminationFeeCents: 7500,
      earlyTerminationFeePercent: 25,
      earlyTerminationFeeCapCents: 40_050,
      earlyTerminationNoticeDays: 30,
      unusedTermTreatment: "CREDIT",
      terminationTermsText: "Ending early costs the fee below.",
    });
  });

  it("clearing a box saves null, so the owner can switch a rule back off", () => {
    expect(ok({ feeDollars: "", noticeDays: "" })).toMatchObject({
      earlyTerminationFeeCents: null,
      earlyTerminationNoticeDays: null,
    });
  });

  it("rejects money with fractions of a cent, negatives, letters and absurd sizes", () => {
    for (const bad of ["1.234", "-5", "abc", "1,000", "10000000"]) {
      expect(fail({ feeDollars: bad })).toMatch(/Flat fee/);
    }
  });

  it("rejects percents over 100, decimals and negatives; days over a year", () => {
    expect(fail({ feePercent: "101" })).toMatch(/Percent of rent owed/);
    expect(fail({ feePercent: "12.5" })).toMatch(/whole number/);
    expect(fail({ feePercent: "-1" })).toMatch(/whole number/);
    expect(fail({ noticeDays: "366" })).toMatch(/Days of notice/);
    expect(fail({ autoRenewNoticeDays: "x" })).toMatch(/renewal notice/);
  });

  it("only accepts the three real choices for unused prepaid time", () => {
    for (const choice of ["REFUND", "CREDIT", "RETAIN", ""]) {
      expect(() => ok({ unusedTerm: choice })).not.toThrow();
    }
    expect(fail({ unusedTerm: "KEEP" })).toMatch(/unused prepaid time/);
  });

  it("a highest fee needs a fee to cap, and cannot be below the flat fee", () => {
    expect(fail({ feeCapDollars: "100" })).toMatch(/only makes sense/);
    expect(fail({ feeDollars: "200", feeCapDollars: "100" })).toMatch(/can't be less/);
    expect(() => ok({ feePercent: "10", feeCapDollars: "100" })).not.toThrow();
    expect(() => ok({ feeDollars: "100", feeCapDollars: "100" })).not.toThrow();
  });

  it("refuses over-long wording and control characters", () => {
    expect(fail({ terminationTermsText: "x".repeat(5001) })).toMatch(/under 5000/);
    expect(fail({ renewalTermsText: "bad\u0000text" })).toMatch(/under 5000/);
  });

  it("rejects a submission that is missing fields instead of silently clearing them", () => {
    expect(termsPolicyUpdate({ feeDollars: "5" })).toMatchObject({ success: false });
    expect(termsPolicyUpdate(null as never)).toMatchObject({ success: false });
  });

  it("ignores injected fields: only the policy settings can be written", () => {
    const update = ok({ noticeDays: "10", role: "OWNER", taxRateConfirmed: true, depositEnabled: true });
    expect(Object.keys(update).sort()).toEqual(
      [
        "autoRenewNoticeDays",
        "autoRenewTermsVersion",
        "earlyTerminationFeeCapCents",
        "earlyTerminationFeeCents",
        "earlyTerminationFeePercent",
        "earlyTerminationNoticeDays",
        "renewalTermsText",
        "terminationTermsText",
        "unusedTermTreatment",
      ].sort(),
    );
  });
});

describe("auto-renew terms version is generated, not typed", () => {
  it("exists only when both the notice days and the wording are saved", () => {
    expect(ok({ autoRenewNoticeDays: "30" }).autoRenewTermsVersion).toBeNull();
    expect(ok({ renewalTermsText: "We renew." }).autoRenewTermsVersion).toBeNull();
    expect(
      ok({ autoRenewNoticeDays: "30", renewalTermsText: "We renew." }).autoRenewTermsVersion,
    ).toMatch(/^ar-[0-9a-f]{10}$/);
  });

  it("stays the same when nothing changed and changes when the wording or notice changes", () => {
    const base = autoRenewTermsVersionFor(30, "We renew monthly.");
    expect(autoRenewTermsVersionFor(30, "We renew monthly.")).toBe(base);
    expect(autoRenewTermsVersionFor(30, "We renew yearly.")).not.toBe(base);
    expect(autoRenewTermsVersionFor(45, "We renew monthly.")).not.toBe(base);
  });
});

describe("termsPolicyStatus: plain-English 'is it on, and what is missing'", () => {
  it("is off with a list of what is missing when nothing is set", () => {
    const status = termsPolicyStatus({});
    expect(status.earlyEnding.available).toBe(false);
    expect(status.earlyEnding.missing).toEqual([
      "days of notice",
      "what happens to unused prepaid time",
      "a flat fee or a percent (enter 0 if there should be no fee)",
      "the wording customers will see about ending early",
    ]);
    expect(status.autoRenew.available).toBe(false);
    expect(status.autoRenew.missing).toEqual(["days of renewal notice", "the auto-renew terms wording"]);
  });

  it("turns on exactly when the same rule the quote uses says the policy is complete", () => {
    const saved = ok({ feePercent: "20", noticeDays: "14", unusedTerm: "REFUND", terminationTermsText: "Pay 20% of the rest." });
    const settings = {
      earlyTerminationFeeCents: saved.earlyTerminationFeeCents,
      earlyTerminationFeePercent: saved.earlyTerminationFeePercent,
      earlyTerminationFeeCapCents: saved.earlyTerminationFeeCapCents,
      earlyTerminationNoticeDays: saved.earlyTerminationNoticeDays,
      unusedTermTreatment: saved.unusedTermTreatment,
      terminationTermsText: saved.terminationTermsText,
    };
    expect(termsPolicyStatus(settings).earlyEnding).toEqual({ available: true, missing: [] });
    expect(loadTerminationPolicy(settings)).not.toBeNull();
    // A deliberate "no fee" (0) counts as decided.
    const free = ok({ feeDollars: "0", noticeDays: "0", unusedTerm: "RETAIN", terminationTermsText: "No fee." });
    expect(
      termsPolicyStatus({
        earlyTerminationFeeCents: free.earlyTerminationFeeCents,
        earlyTerminationNoticeDays: free.earlyTerminationNoticeDays,
        unusedTermTreatment: free.unusedTermTreatment,
        terminationTermsText: free.terminationTermsText,
      }).earlyEnding.available,
    ).toBe(true);
    // Without the wording customers will see, it stays off.
    expect(
      termsPolicyStatus({ ...settings, terminationTermsText: null }).earlyEnding,
    ).toEqual({ available: false, missing: ["the wording customers will see about ending early"] });
  });

  it("auto-renew turns on once the notice days and wording exist", () => {
    const saved = ok({ autoRenewNoticeDays: "30", renewalTermsText: "We renew monthly." });
    expect(
      termsPolicyStatus({
        autoRenewNoticeDays: saved.autoRenewNoticeDays,
        autoRenewTermsVersion: saved.autoRenewTermsVersion,
        renewalTermsText: saved.renewalTermsText,
      }).autoRenew,
    ).toEqual({ available: true, missing: [] });
  });
});

describe("termsPolicyDefaults: saved settings back into the form", () => {
  it("shows blanks for undecided values and dollars for money", () => {
    expect(termsPolicyDefaults({})).toEqual(blank);
    expect(
      termsPolicyDefaults({
        earlyTerminationFeeCents: 4999,
        earlyTerminationFeePercent: 0,
        earlyTerminationFeeCapCents: 40_000,
        earlyTerminationNoticeDays: 0,
        unusedTermTreatment: "CREDIT",
        terminationTermsText: "T",
        autoRenewNoticeDays: 30,
        renewalTermsText: "R",
      }),
    ).toEqual({
      feeDollars: "49.99",
      feePercent: "0",
      feeCapDollars: "400.00",
      noticeDays: "0",
      unusedTerm: "CREDIT",
      terminationTermsText: "T",
      autoRenewNoticeDays: "30",
      renewalTermsText: "R",
    });
  });

  it("round-trips: what is saved comes back to the form unchanged", () => {
    const typed = { ...blank, feeDollars: "75.50", feePercent: "25", noticeDays: "30", unusedTerm: "REFUND" };
    const saved = ok(typed);
    const back = termsPolicyDefaults({
      earlyTerminationFeeCents: saved.earlyTerminationFeeCents,
      earlyTerminationFeePercent: saved.earlyTerminationFeePercent,
      earlyTerminationFeeCapCents: saved.earlyTerminationFeeCapCents,
      earlyTerminationNoticeDays: saved.earlyTerminationNoticeDays,
      unusedTermTreatment: saved.unusedTermTreatment,
    });
    expect(back).toEqual(typed);
  });
});
