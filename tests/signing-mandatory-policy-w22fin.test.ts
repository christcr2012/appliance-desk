import { describe, expect, it } from "vitest";
import {
  effectiveMandatorySigningPolicy, parseMandatorySigningPolicyVersions,
  validateMandatorySigningPolicy,
} from "@/domains/billing/signing-mandatory-policy";

const decision = { delivery: "REQUIRED", installation: "NOT_APPLICABLE",
  removal: "NOT_APPLICABLE", damageWaiver: "UNDECIDED", retailDelivery: "EXEMPT" } as const;
const record = (revision: number, effectiveFromKey: string, recordedAt: string) => ({
  revision, effectiveFromKey, recordedAt, recordedByUserId: "owner-1",
  reason: "Documented owner policy and category evidence.", decisions: decision,
});
describe("dated and auditable mandatory signing charge policy", () => {
  it("validates real dates, owner explanation and every category", () => {
    expect(validateMandatorySigningPolicy({
      effectiveFromKey: "2026-10-14", reason: "Owner policy explanation.",
      decisions: decision,
    })).toMatchObject({ decisions: decision });
    expect(() => validateMandatorySigningPolicy({
      effectiveFromKey: "2026-02-30", reason: "Owner policy explanation.", decisions: decision,
    })).toThrow(/real effective date/);
    expect(() => validateMandatorySigningPolicy({
      effectiveFromKey: "2026-10-14", reason: "too short", decisions: decision,
    })).toThrow(/reason/);
    expect(() => validateMandatorySigningPolicy({
      effectiveFromKey: "2026-10-14", reason: "Owner policy explanation.",
      decisions: { ...decision, retailDelivery: "CHARGE_NOW" } as never,
    })).toThrow(/delivery fee/);
  });
  it("returns UNDECIDED on corrupted, unsaved or future only rule versions", () => {
    expect(effectiveMandatorySigningPolicy(null).revision).toBeNull();
    expect(effectiveMandatorySigningPolicy([record(2, "2026-10-14", "2026-10-14T12:00:00.000Z")]).revision).toBeNull();
    const future = [record(1, "2026-11-01", "2026-10-14T12:00:00.000Z")];
    expect(effectiveMandatorySigningPolicy(future, new Date("2026-10-15T18:00:00Z")).revision).toBeNull();
  });
  it("selects the newest effective reviewed rule and preserves older terms", () => {
    const versions = [
      record(1, "2026-10-11", "2026-10-11T16:00:00.000Z"),
      { ...record(2, "2026-10-14", "2026-10-14T12:00:00.000Z"),
        decisions: { ...decision, delivery: "NOT_APPLICABLE" } },
      record(3, "2026-11-04", "2026-10-14T13:00:00.000Z"),
    ];
    expect(parseMandatorySigningPolicyVersions(versions)).toHaveLength(3);
    expect(effectiveMandatorySigningPolicy(versions, new Date("2026-10-12T18:00:00Z")).revision).toBe(1);
    expect(effectiveMandatorySigningPolicy(versions, new Date("2026-10-15T18:00:00Z")).decision.delivery).toBe("NOT_APPLICABLE");
    expect(effectiveMandatorySigningPolicy(versions, new Date("2026-11-05T18:00:00Z")).revision).toBe(3);
  });
});
