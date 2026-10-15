import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  DENIED_PERMISSION, effectiveLocationPermission, mayContactTenant,
  parseLocationCsv, tenantTextPermittedWithoutConsent,
} from "@/domains/customers/location-contacts";

describe("W-23 permission policy and CSV validator", () => {
  const grant = { deliveryPickup: true, maintenance: true, swaps: false,
    copyClient: true, appointmentConfirmer: "CLIENT" as const };
  it("fails closed for missing/corrupt permission; explicit site override supersedes default", () => {
    expect(effectiveLocationPermission({}, null)).toEqual(DENIED_PERMISSION);
    expect(effectiveLocationPermission(grant, { maintenance: true })).toEqual(DENIED_PERMISSION);
    const override = { ...grant, maintenance: false, swaps: true };
    expect(effectiveLocationPermission(grant, override)).toEqual(override);
    expect(mayContactTenant(override, "maintenance")).toBe(false);
    expect(mayContactTenant(override, "swaps")).toBe(true);
  });
  it("never mistakes the client's grant for a tenant's own SMS consent", () => {
    expect(tenantTextPermittedWithoutConsent()).toBe(false);
  });
  const header = "street,unit,city,state,zip,unitLabel,tenantName,tenantPhone,tenantEmail,language";
  it("accepts a quoted CSV import with a unit label and independently scoped occupant", () => {
    const rows = parseLocationCsv(header + '\n"10, Test Street",Apt 2,Denver,CO,80201,Unit 2,Ana,,ana@example.test,es\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ street: "10, Test Street",
      unitLabel: "Unit 2", tenantName: "Ana", language: "es" });
  });
  it("rejects unknown columns, missing fields, duplicate sites, invalid tenant email and spreadsheet formulas", () => {
    expect(() => parseLocationCsv("a,b\nx,y")).toThrow(/columns/i);
    expect(() => parseLocationCsv(header + "\n,,Denver,CO,80201,,,,,\n")).toThrow(/address/i);
    const row = "10 Test St,,Denver,CO,80201,Unit 1,Sam,,,en";
    expect(() => parseLocationCsv(header + "\n" + row + "\n" + row)).toThrow(/duplicate/i);
    expect(() => parseLocationCsv(header + "\n10 Test St,,Denver,CO,80201,,Sam,,not-an-email,en")).toThrow();
    expect(() => parseLocationCsv(header + "\n=1+1,,Denver,CO,80201,,,,,")).toThrow(/formula/i);
    expect(() => parseLocationCsv(header + '\n"bad,quote,Denver,CO,80201,,,,,\n')).toThrow(/quote/i);
  });
});
