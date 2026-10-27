import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_METHOD_POLICY, allowedMethodsFor, makeSixDigitCode, methodPolicyFromSetting, normalizeMethodPolicy, textCodesAvailable,
} from "@/domains/security/second-step-rules";

describe("ACC-3 second-step rules", () => {
  it("starts with no email codes for the owner or admins (IN-85) and every method for staff", () => {
    expect(RECOMMENDED_METHOD_POLICY.OWNER).toEqual(["TOTP", "SMS"]);
    expect(RECOMMENDED_METHOD_POLICY.ADMIN).toEqual(["TOTP", "SMS"]);
    expect(RECOMMENDED_METHOD_POLICY.STAFF).toEqual(["TOTP", "SMS", "EMAIL"]);
  });

  it("reads a stored policy, falling back to the recommended value for anything missing or malformed", () => {
    expect(methodPolicyFromSetting(null)).toEqual(RECOMMENDED_METHOD_POLICY);
    expect(methodPolicyFromSetting({ OWNER: "SMS", ADMIN: [], STAFF: ["EMAIL", "bogus", "EMAIL"] })).toEqual({
      OWNER: ["TOTP", "SMS"], ADMIN: ["TOTP", "SMS"], STAFF: ["EMAIL"],
    });
  });

  it("always keeps the authenticator app, so no policy can leave a level with no way in", () => {
    const policy = normalizeMethodPolicy({ OWNER: [], ADMIN: ["EMAIL"], STAFF: ["SMS", "SMS", "nope"] });
    expect(policy.OWNER).toEqual(["TOTP"]);
    expect(policy.ADMIN).toEqual(["TOTP", "EMAIL"]);
    expect(policy.STAFF).toEqual(["TOTP", "SMS"]);
  });

  it("gives customers and unknown roles no methods", () => {
    expect(allowedMethodsFor("CUSTOMER", RECOMMENDED_METHOD_POLICY)).toEqual([]);
    expect(allowedMethodsFor("nobody", RECOMMENDED_METHOD_POLICY)).toEqual([]);
    // ACCT-1: the accountant is outside the per-level policy; the authenticator
    // app is always their method.
    expect(allowedMethodsFor("ACCOUNTANT", RECOMMENDED_METHOD_POLICY)).toEqual(["TOTP"]);
  });

  it("allows text codes only when production, keys and the owner's switch are all true", () => {
    expect(textCodesAvailable({ production: true, keysPresent: true, switchOn: true })).toBe(true);
    for (const off of ["production", "keysPresent", "switchOn"] as const) {
      expect(textCodesAvailable({ production: true, keysPresent: true, switchOn: true, [off]: false })).toBe(false);
    }
  });

  it("makes 6-digit codes, keeping leading zeros", () => {
    expect(makeSixDigitCode(() => 0)).toBe("000000");
    expect(makeSixDigitCode(() => 7)).toBe("777777");
  });
});
