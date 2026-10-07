import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  recheckCurrentTaxAddresses,
  TAX_ADDRESS_CHANGE_REVIEW_NOTE,
} from "@/domains/tax/address-recheck";
import {
  __setColoradoRateSourceForTests,
  type ColoradoRateSource,
} from "@/domains/tax/colorado-gis";
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T tax-address re-check (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `tax-recheck-user-${tag}`;
  const customerId = `tax-recheck-customer-${tag}`;
  const addressId = `tax-recheck-address-${tag}`;
  const changedJurisdictionId = `tax-recheck-new-jurisdiction-${tag}`;
  const changedRateId = `tax-recheck-new-rate-${tag}`;
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${tag}-recheck@example.test`,
        name: "Tax re-check customer",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `RC${tag.slice(0, 16)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "300 Recheck Ave",
        city: "Greeley",
        zip: "80631",
      },
    });
    taxFixture = await seedTaxReadyContext(addressId, {
      rateMilliPercent: 7_300,
    });
    await prisma.taxJurisdiction.create({
      data: {
        id: changedJurisdictionId,
        code: `RC-${tag.slice(0, 8)}`,
        name: "Synthetic changed tax area",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
    await prisma.taxRateVersion.create({
      data: {
        id: changedRateId,
        jurisdictionId: changedJurisdictionId,
        rateMilliPercent: 8_000,
        effectiveFrom: businessDateFromKey("2026-01-01")!,
        source: "MANUAL",
      },
    });
  });

  afterEach(() => {
    __setColoradoRateSourceForTests(null);
  });

  afterAll(async () => {
    __setColoradoRateSourceForTests(null);
    await prisma.auditLog.deleteMany({
      where: {
        action: "tax.address_recheck_changed",
        entityId: addressId,
      },
    });
    await prisma.addressTaxLocation.deleteMany({
      where: { serviceAddressId: addressId },
    });
    await prisma.taxRateVersion.deleteMany({
      where: { id: changedRateId },
    });
    await prisma.taxJurisdiction.deleteMany({
      where: { id: changedJurisdictionId },
    });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("does not disturb owner-verified addresses when automatic GIS is unavailable", async () => {
    const before = await prisma.addressTaxLocation.findFirstOrThrow({
      where: { serviceAddressId: addressId, isCurrent: true },
    });

    const result = await recheckCurrentTaxAddresses(
      businessDateFromKey("2026-11-01")!,
      { serviceAddressIds: [addressId] },
    );

    expect(result).toEqual({
      due: true,
      automaticSourceAvailable: false,
      checked: 0,
      changed: 0,
      needsReview: 0,
    });
    const after = await prisma.addressTaxLocation.findFirstOrThrow({
      where: { serviceAddressId: addressId, isCurrent: true },
    });
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("VERIFIED");
  });

  it("marks a changed jurisdiction set for review and records evidence", async () => {
    const source: ColoradoRateSource = {
      lookup: async () => ({
        status: "MATCHED",
        normalizedAddress: "300 RECHECK AVE, GREELEY CO 80631",
        jurisdictions: [
          {
            code: `RC-${tag.slice(0, 8)}`,
            name: "Synthetic changed tax area",
            level: "CITY",
            administration: "STATE_COLLECTED",
            rateMilliPercent: 8_000,
          },
        ],
      }),
    };
    __setColoradoRateSourceForTests(source);

    const result = await recheckCurrentTaxAddresses(
      businessDateFromKey("2026-11-01")!,
      { serviceAddressIds: [addressId] },
    );
    expect(result).toEqual({
      due: true,
      automaticSourceAvailable: true,
      checked: 1,
      changed: 1,
      needsReview: 1,
    });

    const current = await prisma.addressTaxLocation.findFirstOrThrow({
      where: { serviceAddressId: addressId, isCurrent: true },
      include: { jurisdictions: true },
    });
    expect(current.status).toBe("NEEDS_REVIEW");
    expect(current.reviewNote).toBe(TAX_ADDRESS_CHANGE_REVIEW_NOTE);
    expect(current.jurisdictions.map((row) => row.jurisdictionId)).toEqual([
      changedJurisdictionId,
    ]);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "tax.address_recheck_changed",
          entityId: addressId,
        },
      }),
    ).toBe(1);
  });

  it("runs the original address re-check only on the first Colorado calendar day of a month", async () => {
    __setColoradoRateSourceForTests({
      lookup: async () => ({
        status: "UNAVAILABLE",
        message: "should not be called",
      }),
    });

    const result = await recheckCurrentTaxAddresses(
      businessDateFromKey("2026-11-02")!,
      { serviceAddressIds: [addressId] },
    );
    expect(result.due).toBe(false);
    expect(result.checked).toBe(0);
  });
});
