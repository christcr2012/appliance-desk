import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_TWO_FACTOR_ROLES,
  isTwoFactorEnrollmentExemptPath,
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

  it("exempts only setup/auth/login/recovery paths from page-level enrollment", () => {
    for (const path of [
      "/desk/security/setup",
      "/api/auth/two-factor/verify-totp",
      "/api/auth/sign-out",
      "/login",
      "/login/two-factor",
      "/forgot-password",
      "/reset-password",
    ]) {
      expect(isTwoFactorEnrollmentExemptPath(path), path).toBe(true);
    }
    for (const path of ["/desk/today", "/desk/billing", "/desk/settings", "/account"]) {
      expect(isTwoFactorEnrollmentExemptPath(path), path).toBe(false);
    }
  });
});
