import { describe, expect, it } from "vitest";
import { customersBackHref, legacyCustomerRedirect, parseCustomerParams } from "@/app/desk/customers/[id]/params";

describe("customer record URL (CUSTOMER-RECORD 2)", () => {
  it("defaults and bad values", () => {
    expect(parseCustomerParams({})).toEqual({ tab: undefined, full: false, filter: "all", cursor: undefined, page: 1, newAccount: false, emailSent: false, from: undefined });
    expect(parseCustomerParams({ tab: "bills", full: "1", filter: "notes", page: "3", newAccount: "1", emailSent: "1" })).toMatchObject({ tab: "bills", full: true, filter: "notes", page: 3, newAccount: true, emailSent: true });
    expect(parseCustomerParams({ tab: "nope", filter: "x", page: "-4", full: "yes" })).toMatchObject({ tab: undefined, filter: "all", page: 1, full: false });
  });

  it("old tab links redirect, keeping other params", () => {
    expect(legacyCustomerRedirect("c1", { tab: "overview" })).toBe("/desk/customers/c1");
    expect(legacyCustomerRedirect("c1", { tab: "properties" })).toBe("/desk/customers/c1?tab=details");
    expect(legacyCustomerRedirect("c1", { tab: "service", page: "2" })).toBe("/desk/customers/c1?page=2&tab=visits");
    expect(legacyCustomerRedirect("c1", { tab: "billing" })).toBe("/desk/customers/c1?tab=details#referrals");
    expect(legacyCustomerRedirect("c1", { tab: "unknown-thing" })).toBe("/desk/customers/c1");
    expect(legacyCustomerRedirect("c1", { tab: "rentals" })).toBeNull();
    expect(legacyCustomerRedirect("c1", {})).toBeNull();
  });

  it("the back link only returns to a Customers list", () => {
    expect(customersBackHref("/desk/customers?q=lopez")).toBe("/desk/customers?q=lopez");
    expect(customersBackHref("https://evil.test")).toBe("/desk/customers");
    expect(customersBackHref(undefined)).toBe("/desk/customers");
  });
});
