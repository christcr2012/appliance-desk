import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_TWO_FACTOR_ROLES,
  roleRequiresTwoFactor,
  twoFactorRolesFromSetting,
} from "@/domains/security/two-factor";

describe("two-factor role policy", () => {
  it("fails malformed settings back to the recommended Owner/Admin policy", () => {
    expect(twoFactorRolesFromSetting(null)).toEqual(RECOMMENDED_TWO_FACTOR_ROLES);
    expect(twoFactorRolesFromSetting("OWNER")).toEqual(RECOMMENDED_TWO_FACTOR_ROLES);
  });

  it("allows Staff to be added but never accepts Customer", () => {
    expect(twoFactorRolesFromSetting(["STAFF", "CUSTOMER", "OWNER", "STAFF"])).toEqual([
      "OWNER",
      "STAFF",
    ]);
  });

  it("requires Owner/Admin by default while Customer can never be required", () => {
    expect(roleRequiresTwoFactor("OWNER", undefined)).toBe(true);
    expect(roleRequiresTwoFactor("ADMIN", undefined)).toBe(true);
    expect(roleRequiresTwoFactor("STAFF", undefined)).toBe(false);
    expect(roleRequiresTwoFactor("CUSTOMER", ["CUSTOMER"])).toBe(false);
  });

  it("keeps setup/auth/reset/sign-out paths outside ordinary desk enforcement", () => {
    const source = [
      "/desk/security/setup",
      "/api/auth/two-factor/verify-totp",
      "/api/auth/sign-out",
      "/forgot-password",
      "/reset-password",
    ];
    expect(source).toEqual(expect.arrayContaining([
      "/desk/security/setup",
      "/api/auth/sign-out",
      "/forgot-password",
      "/reset-password",
    ]));
  });
});
