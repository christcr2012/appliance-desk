import { describe, expect, it } from "vitest";
import {
  AUTOPAY_NOTICE_DAYS, LATE_FEE_CAP_CENTS, addDaysToKey, baseFeeDateKey, canJoinNextCharge, classifyLateFeeAgreement, decideLateFee,
  effectiveGraceDays, feeDateAfterNoticeKey, lateFeeAmountCents, noticeDateKey, validateNoticeDays, type LateFeeFacts,
} from "@/domains/billing/late-fee-rules";

// FEE-1 legal and fairness rules, as pure functions (docs/build-specs/engines/LATE-FEES.md "Legal rules").
const facts = (over: Partial<LateFeeFacts> = {}): LateFeeFacts => ({
  todayKey: "2026-10-12", dueKey: "2026-10-01", graceDays: 10, noticeDays: 2, warnedKey: null, failedPaymentAfterWarning: false,
  outstandingCents: 4000, feeCents: 500, militaryHold: false, agreementNamesFee: true, paymentInProgress: false, alreadyCharged: false, ...over,
});

describe("fee day (rule 2: day 11, for every rental)", () => {
  it("due Oct 1 with 10 days to pay: the first fee day is Oct 12 (day 11), never Oct 11", () => {
    expect(baseFeeDateKey("2026-10-01", 10)).toBe("2026-10-12");
    expect(baseFeeDateKey("2026-10-01", 10) > "2026-10-11").toBe(true);
  });
  it("an older agreement that says 5 days is lifted to 10; a longer one is kept", () => {
    expect(effectiveGraceDays(5)).toBe(10);
    expect(effectiveGraceDays(0)).toBe(10);
    expect(effectiveGraceDays(14)).toBe(14);
    expect(baseFeeDateKey("2026-10-01", 5)).toBe("2026-10-12");
    expect(baseFeeDateKey("2026-10-01", 14)).toBe("2026-10-16");
  });
  it("counts calendar days across a month and daylight-time change without drifting", () => {
    expect(addDaysToKey("2026-10-25", 8)).toBe("2026-11-02");
    expect(baseFeeDateKey("2026-10-28", 10)).toBe("2026-11-08");
    expect(baseFeeDateKey("2027-03-02", 10)).toBe("2027-03-13");
  });
});

describe("the warning date and the fee day after a warning", () => {
  it("warns the notice-days before the fee day, and never earlier than the notice plus the notice days", () => {
    expect(noticeDateKey("2026-10-12", 2)).toBe("2026-10-10");
    expect(feeDateAfterNoticeKey("2026-10-12", "2026-10-10", 2)).toBe("2026-10-12");
    expect(feeDateAfterNoticeKey("2026-10-12", "2026-10-15", 2)).toBe("2026-10-17");
  });
  it("the setting is a whole number from 1 to 5", () => {
    expect(validateNoticeDays(1)).toBe(1);
    expect(validateNoticeDays(5)).toBe(5);
    for (const bad of [0, 6, 2.5, NaN]) expect(() => validateNoticeDays(bad)).toThrow(/whole number/);
  });
});

describe("amount (rule 3: at most $15)", () => {
  it("is the larger of flat and percent, capped at $15", () => {
    expect(lateFeeAmountCents({ flatCents: 500, percent: 0, outstandingCents: 4000 })).toBe(500);
    expect(lateFeeAmountCents({ flatCents: 500, percent: 20, outstandingCents: 4000 })).toBe(800);
    expect(lateFeeAmountCents({ flatCents: 5000, percent: 0, outstandingCents: 4000 })).toBe(LATE_FEE_CAP_CENTS);
    expect(lateFeeAmountCents({ flatCents: 0, percent: 50, outstandingCents: 100_000 })).toBe(LATE_FEE_CAP_CENTS);
    expect(lateFeeAmountCents({ flatCents: 0, percent: 0, outstandingCents: 4000 })).toBe(0);
  });
});

describe("class (rule 1)", () => {
  const base = { isBusiness: false, isPropertyManager: false, companyName: null as string | null };
  it("household over 4 months is a consumer lease; month-to-month or short is short; a company is business", () => {
    expect(classifyLateFeeAgreement({ ...base, termMonths: 12 })).toBe("CONSUMER_LEASE");
    expect(classifyLateFeeAgreement({ ...base, termMonths: 6 })).toBe("CONSUMER_LEASE");
    expect(classifyLateFeeAgreement({ ...base, termMonths: 4 })).toBe("CONSUMER_SHORT");
    expect(classifyLateFeeAgreement({ ...base, termMonths: null })).toBe("CONSUMER_SHORT");
    expect(classifyLateFeeAgreement({ ...base, isBusiness: true, termMonths: 12 })).toBe("BUSINESS");
    expect(classifyLateFeeAgreement({ ...base, isPropertyManager: true, termMonths: null })).toBe("BUSINESS");
    expect(classifyLateFeeAgreement({ ...base, companyName: "Acme LLC", termMonths: 12 })).toBe("BUSINESS");
  });
});

describe("decideLateFee", () => {
  it("nobody warned: on the notice day (Oct 10) send the warning; before it, nothing", () => {
    expect(decideLateFee(facts({ todayKey: "2026-10-09" }))).toEqual({ kind: "NONE", reason: "NOT_YET_NOTICE_DAY" });
    expect(decideLateFee(facts({ todayKey: "2026-10-10" }))).toEqual({ kind: "SEND_NOTICE", feeDateKey: "2026-10-12" });
    expect(decideLateFee(facts({ todayKey: "2026-10-11" }))).toEqual({ kind: "SEND_NOTICE", feeDateKey: "2026-10-12" });
  });
  it("no delivered warning, no fee: the fee day passes and Chris is asked", () => {
    expect(decideLateFee(facts({ todayKey: "2026-10-12" }))).toEqual({ kind: "NEEDS_WARNING" });
    expect(decideLateFee(facts({ todayKey: "2026-10-20" }))).toEqual({ kind: "NEEDS_WARNING" });
  });
  it("warned two days ahead: the fee is recorded on the fee day, not before", () => {
    const warned = { warnedKey: "2026-10-10" };
    expect(decideLateFee(facts({ ...warned, todayKey: "2026-10-11" }))).toEqual({ kind: "WAIT", reason: "FEE_DAY_NOT_REACHED" });
    expect(decideLateFee(facts({ ...warned, todayKey: "2026-10-12" }))).toEqual({ kind: "RECORD_FEE", feeCents: 500 });
  });
  it("a warning delivered late pushes the fee day out by the notice days", () => {
    const warned = { warnedKey: "2026-10-15" };
    expect(decideLateFee(facts({ ...warned, todayKey: "2026-10-16" }))).toEqual({ kind: "WAIT", reason: "FEE_DAY_NOT_REACHED" });
    expect(decideLateFee(facts({ ...warned, todayKey: "2026-10-17" }))).toEqual({ kind: "RECORD_FEE", feeCents: 500 });
  });
  it("never during a payment in progress; once it is over the fee can follow", () => {
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", paymentInProgress: true }))).toEqual({ kind: "WAIT", reason: "PAYMENT_IN_PROGRESS" });
  });
  it("a failed payment after the warning needs a fresh warning (and a new fee day)", () => {
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", failedPaymentAfterWarning: true }))).toEqual({ kind: "RENOTICE" });
  });
  it("once per bill, never when paid, never without terms in the signed agreement", () => {
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", alreadyCharged: true }))).toEqual({ kind: "NONE", reason: "ALREADY_CHARGED" });
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", outstandingCents: 0 }))).toEqual({ kind: "NONE", reason: "PAID" });
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", agreementNamesFee: false }))).toEqual({ kind: "NONE", reason: "NO_FEE_TERMS" });
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", feeCents: 0 }))).toEqual({ kind: "NONE", reason: "NO_FEE_TERMS" });
  });
  it("30-day window: after day 30 nothing is assessed; a warning that pushes the fee day past day 30 means no fee", () => {
    expect(decideLateFee(facts({ todayKey: "2026-10-31", warnedKey: "2026-10-10" }))).toEqual({ kind: "RECORD_FEE", feeCents: 500 });
    expect(decideLateFee(facts({ todayKey: "2026-11-01", warnedKey: "2026-10-10" }))).toEqual({ kind: "NONE", reason: "WINDOW_PASSED" });
    expect(decideLateFee(facts({ todayKey: "2026-10-31", warnedKey: "2026-10-30" }))).toEqual({ kind: "NONE", reason: "WINDOW_PASSED" });
  });
  it("an active-duty servicemember never gets an automatic fee", () => {
    expect(decideLateFee(facts({ warnedKey: "2026-10-10", militaryHold: true }))).toEqual({ kind: "MILITARY_REVIEW" });
  });
});

describe("autopay (rule 7: 10 days' notice of a new amount)", () => {
  it("joins an automatic charge only when it is at least 10 days away", () => {
    expect(AUTOPAY_NOTICE_DAYS).toBe(10);
    expect(canJoinNextCharge({ todayKey: "2026-10-12", nextChargeKey: "2026-10-22", autopay: true })).toBe(true);
    expect(canJoinNextCharge({ todayKey: "2026-10-12", nextChargeKey: "2026-10-21", autopay: true })).toBe(false);
    expect(canJoinNextCharge({ todayKey: "2026-10-12", nextChargeKey: "2026-10-13", autopay: false })).toBe(true);
    expect(canJoinNextCharge({ todayKey: "2026-10-12", nextChargeKey: null, autopay: true })).toBe(false);
  });
});
