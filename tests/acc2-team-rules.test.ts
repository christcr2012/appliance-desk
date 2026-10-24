import { describe, expect, it } from "vitest";
import {
  TeamError, assertMayInvite, assertMayRemoveOrRestore, clampLinkDays, effectiveInvitationState, hashInvitationCode,
  invitationExpiry, newInvitationCode, validateNewPassword,
} from "@/domains/team/rules";

describe("ACC-2 team invitation rules", () => {
  it("makes long unique codes and stores only a hash", () => {
    const a = newInvitationCode();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(newInvitationCode()).not.toBe(a);
    expect(hashInvitationCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationCode(a)).not.toContain(a);
  });

  it("limits the link lifetime to 1-30 whole days", () => {
    expect(clampLinkDays(7)).toBe(7);
    for (const bad of [0, 31, 1.5, Number.NaN, "x"]) expect(() => clampLinkDays(bad)).toThrow(TeamError);
    expect(invitationExpiry(new Date("2026-10-01T00:00:00Z"), 7).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("shows an invited row past its expiry as expired, and never revives used or cancelled ones", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(effectiveInvitationState("INVITED", new Date("2026-10-11T00:00:00Z"), now)).toBe("INVITED");
    expect(effectiveInvitationState("INVITED", new Date("2026-10-10T00:00:00Z"), now)).toBe("EXPIRED");
    expect(effectiveInvitationState("CANCELLED", new Date("2030-01-01T00:00:00Z"), now)).toBe("CANCELLED");
    expect(effectiveInvitationState("ACCEPTED", new Date("2030-01-01T00:00:00Z"), now)).toBe("ACCEPTED");
  });

  it("lets only the owner invite admins, and admins invite staff only when the owner allows it", () => {
    expect(() => assertMayInvite("OWNER", "ADMIN", false)).not.toThrow();
    expect(() => assertMayInvite("ADMIN", "ADMIN", true)).toThrow("Only the owner");
    expect(() => assertMayInvite("ADMIN", "STAFF", false)).toThrow("not allowed");
    expect(() => assertMayInvite("ADMIN", "STAFF", true)).not.toThrow();
    expect(() => assertMayInvite("STAFF", "STAFF", true)).toThrow(TeamError);
    expect(() => assertMayInvite("CUSTOMER", "STAFF", true)).toThrow(TeamError);
  });

  it("limits who can remove or restore whom", () => {
    expect(() => assertMayRemoveOrRestore("OWNER", "o", "ADMIN", "a")).not.toThrow();
    expect(() => assertMayRemoveOrRestore("ADMIN", "a", "STAFF", "s")).not.toThrow();
    expect(() => assertMayRemoveOrRestore("ADMIN", "a", "ADMIN", "b")).toThrow("Only the owner");
    expect(() => assertMayRemoveOrRestore("ADMIN", "a", "OWNER", "o")).toThrow("owner account");
    expect(() => assertMayRemoveOrRestore("OWNER", "o", "OWNER", "o")).toThrow("your own");
    expect(() => assertMayRemoveOrRestore("OWNER", "o", "CUSTOMER", "c")).toThrow("not a team login");
    expect(() => assertMayRemoveOrRestore("STAFF", "s", "STAFF", "t")).toThrow(TeamError);
  });

  it("checks the new password", () => {
    expect(() => validateNewPassword("short", "short")).toThrow("at least 10");
    expect(() => validateNewPassword("long-enough-1", "long-enough-2")).toThrow("don't match");
    expect(() => validateNewPassword("long-enough-1", "long-enough-1")).not.toThrow();
  });
});
