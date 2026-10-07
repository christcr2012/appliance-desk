import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "perf-owner", role: "OWNER" } }),
}));

import { getActiveApplianceOptionsForCustomer } from "@/domains/agreements/active-appliances";
import { getCustomerProperties } from "@/domains/customers/workspace";
import {
  createLargeAccountFixture,
  enforceRecordedBaseline,
  LARGE_ACCOUNT_APPLIANCES,
  LARGE_ACCOUNT_PROPERTIES,
  measuredMedian,
  PERF_ENABLED,
  type LargeAccountFixture,
} from "./fixtures";

describe.skipIf(!PERF_ENABLED)("Batch F large property-manager account (isolated CI Postgres)", () => {
  let fixture: LargeAccountFixture;

  beforeAll(async () => {
    fixture = await createLargeAccountFixture();
  }, 60_000);

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 30_000);

  it("loads the real owner property/equipment view for 50 properties and 200 appliances within baseline", async () => {
    const result = await measuredMedian("f-large-account-owner-read", async () =>
      Promise.all([
        getCustomerProperties(fixture.customerId),
        getActiveApplianceOptionsForCustomer(fixture.customerId),
      ]),
    );
    const [properties, appliances] = result.value;

    expect(properties).not.toBeNull();
    expect(properties!.serviceAddresses).toHaveLength(LARGE_ACCOUNT_PROPERTIES);
    expect(properties!.rentalAgreements).toHaveLength(LARGE_ACCOUNT_PROPERTIES);
    expect(
      properties!.rentalAgreements.reduce((sum, agreement) => sum + agreement.lines.length, 0),
    ).toBe(LARGE_ACCOUNT_APPLIANCES);
    expect(appliances).toHaveLength(LARGE_ACCOUNT_APPLIANCES);
    enforceRecordedBaseline("f-large-account-owner-read", result.ms);
  });
});
