import { describe, expect, it } from "vitest";
import {
  autoRenewTermsVersionFor,
  buildTermsSnapshot,
  sanitizeTermsOverride,
  snapshotAutoRenew,
  snapshotTerminationPolicy,
  type TermsValues,
} from "@/domains/agreements/terms-snapshot";

const now = new Date("2026-10-03T12:00:00Z");
const system: TermsValues = {
  earlyTerminationFeeCents: 5000,
  earlyTerminationFeePercent: null,
  earlyTerminationFeeCapCents: null,
  earlyTerminationNoticeDays: 30,
  unusedTermTreatment: "CREDIT",
  terminationTermsText: "Ending early costs $50.",
  autoRenewNoticeDays: 30,
  renewalTermsText: "Renews monthly.",
};

describe("buildTermsSnapshot: the terms an agreement is locked to", () => {
  it("copies the system-wide terms when there is no per-customer override", () => {
    const snapshot = buildTermsSnapshot(system, null, now);
    expect(snapshot.source).toBe("SYSTEM");
    expect(snapshot.capturedAt).toBe(now.toISOString());
    expect(snapshot.termination).toEqual({
      feeCents: 5000,
      feePercent: null,
      feeCapCents: null,
      noticeDays: 30,
      unusedTerm: "CREDIT",
      termsText: "Ending early costs $50.",
    });
    expect(snapshot.autoRenew).toEqual({
      noticeDays: 30,
      termsText: "Renews monthly.",
      termsVersion: autoRenewTermsVersionFor(30, "Renews monthly."),
    });
  });

  it("is a copy: changing the system terms afterwards does not change an existing snapshot", () => {
    const snapshot = buildTermsSnapshot(system, null, now);
    system.earlyTerminationFeeCents = 99_000;
    try {
      expect(snapshotTerminationPolicy(snapshot)?.feeCents).toBe(5000);
    } finally {
      system.earlyTerminationFeeCents = 5000;
    }
  });

  it("a per-customer override replaces only the fields it names", () => {
    const snapshot = buildTermsSnapshot(system, { earlyTerminationFeeCents: 0, earlyTerminationNoticeDays: 7 }, now);
    expect(snapshot.source).toBe("CUSTOM");
    expect(snapshot.termination).toMatchObject({ feeCents: 0, noticeDays: 7, unusedTerm: "CREDIT", termsText: "Ending early costs $50." });
  });

  it("an override can turn a feature off for one customer, and can customize the wording", () => {
    expect(buildTermsSnapshot(system, { terminationTermsText: null }, now).termination).toBeNull();
    const custom = buildTermsSnapshot(system, { renewalTermsText: "Custom renewal." }, now);
    expect(custom.autoRenew?.termsText).toBe("Custom renewal.");
    expect(custom.autoRenew?.termsVersion).toBe(autoRenewTermsVersionFor(30, "Custom renewal."));
  });

  it("stores null for any section that was not fully set: nothing was agreed, nothing is guessed", () => {
    const blank = buildTermsSnapshot({}, null, now);
    expect(blank.termination).toBeNull();
    expect(blank.autoRenew).toBeNull();
    expect(buildTermsSnapshot({ ...system, terminationTermsText: "  " }, null, now).termination).toBeNull();
    expect(buildTermsSnapshot({ ...system, autoRenewNoticeDays: null }, null, now).autoRenew).toBeNull();
    expect(buildTermsSnapshot({ ...system, unusedTermTreatment: null }, null, now).termination).toBeNull();
  });

  it("ignores unknown keys and junk in a stored override", () => {
    expect(sanitizeTermsOverride(null)).toEqual({});
    expect(sanitizeTermsOverride([1, 2])).toEqual({});
    expect(sanitizeTermsOverride("x")).toEqual({});
    expect(sanitizeTermsOverride({ earlyTerminationFeeCents: 100, isAdmin: true })).toEqual({ earlyTerminationFeeCents: 100 });
    expect(buildTermsSnapshot(system, { isAdmin: true }, now).source).toBe("SYSTEM");
  });
});

describe("reading a stored snapshot back", () => {
  it("returns the same policy (and version) the system-wide settings would have produced", () => {
    const snapshot = buildTermsSnapshot(system, null, now);
    const policy = snapshotTerminationPolicy(JSON.parse(JSON.stringify(snapshot)));
    expect(policy).toMatchObject({ feeCents: 5000, noticeDays: 30, unusedTerm: "CREDIT" });
    expect(policy?.version).toMatch(/^[0-9a-f]{12}$/);
    expect(snapshotTerminationPolicy(JSON.parse(JSON.stringify(buildTermsSnapshot(system, null, now)))))
      .toEqual(policy);
  });

  it("is null for missing, damaged or hand-edited-into-nonsense snapshots", () => {
    expect(snapshotTerminationPolicy(null)).toBeNull();
    expect(snapshotTerminationPolicy({})).toBeNull();
    expect(snapshotTerminationPolicy({ termination: { feeCents: -5, noticeDays: 30, unusedTerm: "CREDIT", termsText: "x" } })).toBeNull();
    expect(snapshotTerminationPolicy("nope")).toBeNull();
    expect(snapshotAutoRenew(null)).toBeNull();
    expect(snapshotAutoRenew({ autoRenew: { noticeDays: 30, termsText: "", termsVersion: "ar-1" } })).toBeNull();
    expect(snapshotAutoRenew({ autoRenew: { noticeDays: "30", termsText: "x", termsVersion: "ar-1" } })).toBeNull();
    expect(snapshotAutoRenew(buildTermsSnapshot(system, null, now))).not.toBeNull();
  });

  it("the auto-renew version changes with the notice days or the wording, and only then", () => {
    expect(autoRenewTermsVersionFor(30, "A")).toBe(autoRenewTermsVersionFor(30, "A"));
    expect(autoRenewTermsVersionFor(30, "A")).not.toBe(autoRenewTermsVersionFor(30, "B"));
    expect(autoRenewTermsVersionFor(30, "A")).not.toBe(autoRenewTermsVersionFor(45, "A"));
  });
});

import { describeSnapshotTerms } from "@/domains/agreements/terms-snapshot";

describe("describeSnapshotTerms (what the customer is shown before signing)", () => {
  const snapshot = (termination: unknown, autoRenew: unknown) => ({ shape: 1, termination, autoRenew });

  it("describes a flat-fee-only policy with a retain treatment and singular day wording", () => {
    const out = describeSnapshotTerms(
      snapshot(
        { feeCents: 2500, feePercent: null, feeCapCents: null, noticeDays: 1, unusedTerm: "RETAIN", termsText: "Words." },
        null,
      ),
    );
    expect(out.ending?.lines).toContain("Ending early fee: $25.");
    expect(out.ending?.lines).toContain("Notice needed to end early: 1 day.");
    expect(out.ending?.lines).toContain("Money paid for months you no longer use is not refunded.");
    expect(out.autoRenew).toBeNull();
  });

  it("says plainly when the owner chose no fee", () => {
    const out = describeSnapshotTerms(
      snapshot(
        { feeCents: 0, feePercent: null, feeCapCents: null, noticeDays: 30, unusedTerm: "REFUND", termsText: "Words." },
        null,
      ),
    );
    expect(out.ending?.lines[0]).toBe("Ending early: no early-ending fee.");
  });

  it("shows nothing for terms that were never agreed, for missing wording, or for junk JSON", () => {
    expect(describeSnapshotTerms(snapshot(null, null))).toEqual({ ending: null, autoRenew: null });
    expect(describeSnapshotTerms(null)).toEqual({ ending: null, autoRenew: null });
    expect(describeSnapshotTerms("junk")).toEqual({ ending: null, autoRenew: null });
    expect(
      describeSnapshotTerms(
        snapshot({ feeCents: 100, feePercent: null, feeCapCents: null, noticeDays: 5, unusedTerm: "CREDIT", termsText: "  " }, null),
      ).ending,
    ).toBeNull();
  });
});
