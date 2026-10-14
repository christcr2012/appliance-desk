import { describe, expect, it } from "vitest";
import { businessDateKey } from "@/lib/business-date";
import { resolveSetupTaxPolicy, type SetupTaxPolicyVersion } from "@/domains/billing/setup-tax-policy-version";

const make = (treatment: string, effectiveFromKey: string, approvedAt = new Date("2026-10-14T16:00:00Z")): SetupTaxPolicyVersion => ({
  treatment, effectiveFromKey, ownerApprovedAt: approvedAt,
  cpaConfirmedOnKey: effectiveFromKey <= "2026-03-31" ? "2026-02-28" : "2026-10-12",
  decisionNote: "CPA reviewed the actual setup charge category",
  adviserReference: "Email memo from professional on 2026-10-12",
  cancelledAt: null,
});

describe("W-22 effective-dated CPA decision rules", () => {
  it("retains current treatment while a later legal change is already recorded", () => {
    const current = make("TAXABLE", "2026-10-14");
    const later = make("NOT_TAXABLE", "2026-11-01", new Date("2026-10-15T12:00:00Z"));
    expect(resolveSetupTaxPolicy([later, current], new Date("2026-10-20T12:00:00Z"))).toBe("TAXABLE");
    expect(resolveSetupTaxPolicy([current, later], new Date("2026-11-01T06:40:00Z"))).toBe("NOT_TAXABLE");
  });
  it("honors the Denver midnight on the end of daylight saving time", () => {
    const versions = [make("TAXABLE", "2026-10-14"), make("NOT_TAXABLE", "2026-11-01")];
    const before = new Date("2026-11-01T05:59:59Z"); // 11/1 UTC still 10/31 23:59:59 MDT
    const after = new Date("2026-11-01T06:00:00Z"); // 11/1 00:00 MDT
    expect(businessDateKey(before)).toBe("2026-10-31");
    expect(resolveSetupTaxPolicy(versions, before)).toBe("TAXABLE");
    expect(businessDateKey(after)).toBe("2026-11-01");
    expect(resolveSetupTaxPolicy(versions, after)).toBe("NOT_TAXABLE");
  });
  it("honors the Denver midnight on the start of daylight saving time", () => {
    const versions = [make("TAXABLE", "2026-03-01", new Date("2026-03-01T12:00Z")),
      make("NOT_TAXABLE", "2026-03-08", new Date("2026-03-06T18:00Z"))];
    expect(resolveSetupTaxPolicy(versions, new Date("2026-03-08T06:59:59Z"))).toBe("TAXABLE");
    expect(resolveSetupTaxPolicy(versions, new Date("2026-03-08T07:00:00Z"))).toBe("NOT_TAXABLE");
  });
  it("a revocation stops business use; scheduled future decisions can be cancelled", () => {
    const first = make("TAXABLE", "2026-10-14");
    const revoked = make("UNDECIDED", "2026-10-20", new Date("2026-10-20T12:00Z"));
    const next = { ...make("NOT_TAXABLE", "2026-11-01"), cancelledAt: new Date("2026-10-20T12:00Z") };
    expect(resolveSetupTaxPolicy([first,revoked,next], new Date("2026-10-24T12:00Z"))).toBe("UNDECIDED");
    expect(resolveSetupTaxPolicy([first,revoked,next], new Date("2026-11-02T12:00Z"))).toBe("UNDECIDED");
  });
  it("requires a recorded adviser decision and cannot backdate approval for an earlier event", () => {
    const version = make("TAXABLE", "2026-10-14", new Date("2026-10-15T12:00Z"));
    expect(resolveSetupTaxPolicy([version], new Date("2026-10-14T23:00Z"))).toBe("UNDECIDED");
    expect(resolveSetupTaxPolicy([{ ...version, adviserReference: null }], new Date("2026-10-16T12:00Z"))).toBe("UNDECIDED");
    expect(resolveSetupTaxPolicy([version], new Date("2026-10-16T12:00Z"))).toBe("TAXABLE");
    expect(resolveSetupTaxPolicy([version], new Date("invalid"))).toBe("UNDECIDED");
  });
});
