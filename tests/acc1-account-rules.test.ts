import { describe, expect, it } from "vitest";
import { AccountError, cleanName, maskEmail, normalizePhone } from "@/domains/account/rules";
import { decideAccountAuthPath } from "@/domains/account/policy";

describe("ACC-1 phone and name rules", () => {
  it("stores a US phone number one way and treats blank as no phone", () => {
    expect(normalizePhone("970-555-0123")).toBe("+19705550123");
    expect(normalizePhone("(970) 555 0123")).toBe("+19705550123");
    expect(normalizePhone("1 970 555 0123")).toBe("+19705550123");
    expect(normalizePhone("   ")).toBeNull();
  });
  it("refuses numbers that cannot be real US numbers", () => {
    for (const bad of ["555-0123", "123-456-7890", "970-155-0123", "+44 20 7946 0958", "abc"]) {
      expect(() => normalizePhone(bad)).toThrow(AccountError);
    }
  });
  it("cleans a name and refuses an empty or oversized one", () => {
    expect(cleanName("  Pat   Lee ")).toBe("Pat Lee");
    expect(() => cleanName("   ")).toThrow(AccountError);
    expect(() => cleanName("x".repeat(101))).toThrow(AccountError);
  });
  it("hides most of an email address in a notice", () => {
    expect(maskEmail("pat.lee@example.com")).toBe("p***@example.com");
  });
});

describe("ACC-1 which sign-in changes may come straight from the browser", () => {
  const guarded = ["/change-email", "/change-password", "/two-factor/disable", "/two-factor/generate-backup-codes"];
  it("refuses team members on a direct web call, so every change goes through My account", () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      for (const path of guarded) {
        expect(decideAccountAuthPath({ path, viaHttp: true, role }).allow).toBe(false);
        expect(decideAccountAuthPath({ path, viaHttp: false, role }).allow).toBe(true);
      }
    }
  });
  it("never lets a customer or a signed-out caller change a sign-in email", () => {
    expect(decideAccountAuthPath({ path: "/change-email", viaHttp: true, role: "CUSTOMER" }).allow).toBe(false);
    expect(decideAccountAuthPath({ path: "/change-email", viaHttp: false, role: "CUSTOMER" }).allow).toBe(false);
    expect(decideAccountAuthPath({ path: "/change-email", viaHttp: true, role: undefined }).allow).toBe(false);
  });
  it("leaves customers' own password change and every other route alone", () => {
    expect(decideAccountAuthPath({ path: "/change-password", viaHttp: true, role: "CUSTOMER" }).allow).toBe(true);
    expect(decideAccountAuthPath({ path: "/sign-in/email", viaHttp: true, role: "STAFF" }).allow).toBe(true);
    expect(decideAccountAuthPath({ path: "/two-factor/enable", viaHttp: true, role: "OWNER" }).allow).toBe(true);
  });
});
