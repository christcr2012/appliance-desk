import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  __setColoradoRateSourceForTests,
  getColoradoRateSource,
  type ColoradoRateSource,
} from "@/domains/tax/colorado-gis";
import {
  confirmAddressLocation,
  locateBusinessTaxAddress,
  locateServiceAddress,
} from "@/domains/tax/locations";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T address tax locations (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `tax-location-owner-${tag}`;
  const customerUserId = `tax-location-customer-user-${tag}`;
  const customerId = `tax-location-customer-${tag}`;
  const addressId = `tax-location-address-${tag}`;
  const code = (suffix: string) => `T${tag.slice(0, 8)}-${suffix}`;
  let originalBusinessTaxAddress: unknown;

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { businessTaxAddress: true },
    });
    originalBusinessTaxAddress = settings.businessTaxAddress;

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `tax-location-owner-${tag}@example.test`,
          role: "OWNER",
        },
        {
          id: customerUserId,
          email: `tax-location-customer-${tag}@example.test`,
          role: "CUSTOMER",
        },
      ],
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId: customerUserId,
        referralCode: `TL${tag.slice(0, 10)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Synthetic Tax Test Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    });
  });

  afterEach(async () => {
    __setColoradoRateSourceForTests(null);
    await prisma.addressTaxLocation.deleteMany({
      where: {
        OR: [
          { serviceAddressId: addressId },
          { forBusinessLocation: true },
        ],
      },
    });
  });

  afterAll(async () => {
    __setColoradoRateSourceForTests(null);
    await prisma.addressTaxLocation.deleteMany({
      where: {
        OR: [
          { serviceAddressId: addressId },
          { forBusinessLocation: true },
        ],
      },
    });
    await prisma.invoiceTaxLine.deleteMany({
      where: { jurisdiction: { code: { startsWith: code("") } } },
    });
    await prisma.purchaseUseTax.deleteMany({
      where: { jurisdiction: { code: { startsWith: code("") } } },
    });
    await prisma.taxRateVersion.deleteMany({
      where: { jurisdiction: { code: { startsWith: code("") } } },
    });
    await prisma.taxabilityRule.deleteMany({
      where: { jurisdiction: { code: { startsWith: code("") } } },
    });
    await prisma.taxJurisdiction.deleteMany({
      where: { code: { startsWith: code("") } },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: ownerId, action: { startsWith: "tax." } },
    });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, customerUserId] } },
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { businessTaxAddress: originalBusinessTaxAddress as never },
    });
  });

  function fakeSource(
    lookup: Awaited<ReturnType<ColoradoRateSource["lookup"]>>,
  ): ColoradoRateSource & { calls: number } {
    return {
      calls: 0,
      async lookup() {
        this.calls += 1;
        return lookup;
      },
    };
  }

  async function reviewedJurisdiction(
    suffix: string,
    options: { rateMilliPercent?: number } = {},
  ) {
    const jurisdiction = await prisma.taxJurisdiction.create({
      data: {
        code: code(suffix),
        name: `Synthetic ${suffix}`,
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
        reviewedByUserId: ownerId,
        reviewedAt: new Date(),
      },
    });
    if (options.rateMilliPercent !== undefined) {
      await prisma.taxRateVersion.create({
        data: {
          jurisdictionId: jurisdiction.id,
          rateMilliPercent: options.rateMilliPercent,
          effectiveFrom:
            businessDateFromKey(businessDateKey(new Date())) ?? new Date(),
          source: "MANUAL",
          recordedByUserId: ownerId,
        },
      });
    }
    return jurisdiction;
  }

  it("uses the approved manual fallback when no GIS test source exists", async () => {
    const result = await getColoradoRateSource().lookup({
      line1: "1 Synthetic Tax Test Way",
      city: "Greeley",
      zip: "80631",
    });
    expect(result).toMatchObject({ status: "UNAVAILABLE" });
  });

  it("marks a matched address VERIFIED when every area and current rate were already reviewed", async () => {
    const jurisdiction = await reviewedJurisdiction("VERIFIED", {
      rateMilliPercent: 1000,
    });
    __setColoradoRateSourceForTests(
      fakeSource({
        status: "MATCHED",
        normalizedAddress: "Synthetic normalized address",
        jurisdictions: [
          {
            code: jurisdiction.code,
            name: jurisdiction.name,
            level: jurisdiction.level,
            administration: jurisdiction.administration,
            rateMilliPercent: 1000,
          },
        ],
      }),
    );

    await expect(
      locateServiceAddress(addressId, { force: true }),
    ).resolves.toEqual({ status: "VERIFIED" });

    const location = await prisma.addressTaxLocation.findFirstOrThrow({
      where: { serviceAddressId: addressId, isCurrent: true },
      include: { jurisdictions: true },
    });
    expect(location).toMatchObject({
      status: "VERIFIED",
      source: "COLORADO_GIS",
      normalizedAddress: "Synthetic normalized address",
    });
    expect(location.jurisdictions.map((row) => row.jurisdictionId)).toEqual([
      jurisdiction.id,
    ]);
  });

  it("requires review for a newly discovered jurisdiction and its first rate", async () => {
    const newCode = code("NEW");
    __setColoradoRateSourceForTests(
      fakeSource({
        status: "MATCHED",
        normalizedAddress: "Synthetic normalized address",
        jurisdictions: [
          {
            code: newCode,
            name: "Synthetic New District",
            level: "SPECIAL_DISTRICT",
            administration: "STATE_COLLECTED",
            rateMilliPercent: 1250,
          },
        ],
      }),
    );

    await expect(
      locateServiceAddress(addressId, { force: true }),
    ).resolves.toEqual({ status: "NEEDS_REVIEW" });

    const jurisdiction = await prisma.taxJurisdiction.findUniqueOrThrow({
      where: { code: newCode },
      include: { rates: true },
    });
    expect(jurisdiction.reviewStatus).toBe("NEEDS_REVIEW");
    expect(jurisdiction.rates).toHaveLength(1);
    expect(jurisdiction.rates[0]).toMatchObject({
      rateMilliPercent: 1250,
      source: "COLORADO_GIS",
    });
  });

  it("serializes two addresses discovering the same new jurisdiction and first rate", async () => {
    const secondAddressId = `${addressId}-concurrent`;
    const sharedCode = code("RACE");
    await prisma.serviceAddress.create({
      data: {
        id: secondAddressId,
        customerId,
        line1: "2 Synthetic Tax Test Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    });

    let calls = 0;
    let releaseBoth!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const source: ColoradoRateSource = {
      async lookup() {
        calls += 1;
        if (calls === 2) releaseBoth();
        await bothStarted;
        return {
          status: "MATCHED",
          normalizedAddress: "Synthetic concurrent address",
          jurisdictions: [
            {
              code: sharedCode,
              name: "Synthetic Shared District",
              level: "SPECIAL_DISTRICT",
              administration: "STATE_COLLECTED",
              rateMilliPercent: 1750,
            },
          ],
        };
      },
    };
    __setColoradoRateSourceForTests(source);

    try {
      const results = await Promise.all([
        locateServiceAddress(addressId, { force: true }),
        locateServiceAddress(secondAddressId, { force: true }),
      ]);
      expect(results).toEqual([
        { status: "NEEDS_REVIEW" },
        { status: "NEEDS_REVIEW" },
      ]);
      expect(
        await prisma.taxJurisdiction.count({ where: { code: sharedCode } }),
      ).toBe(1);
      const jurisdiction = await prisma.taxJurisdiction.findUniqueOrThrow({
        where: { code: sharedCode },
      });
      expect(
        await prisma.taxRateVersion.count({
          where: { jurisdictionId: jurisdiction.id },
        }),
      ).toBe(1);
      expect(
        await prisma.addressTaxLocation.count({
          where: {
            serviceAddressId: { in: [addressId, secondAddressId] },
            isCurrent: true,
          },
        }),
      ).toBe(2);
    } finally {
      await prisma.addressTaxLocation.deleteMany({
        where: { serviceAddressId: secondAddressId },
      });
      await prisma.serviceAddress.deleteMany({
        where: { id: secondAddressId },
      });
    }
  });

  it("discards a provider result when the address changes before the write lock", async () => {
    const originalLine1 = "1 Synthetic Tax Test Way";
    const reviewed = await reviewedJurisdiction("STALE", {
      rateMilliPercent: 1000,
    });

    let startLookup!: () => void;
    let finishLookup!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      startLookup = resolve;
    });
    const allowResult = new Promise<void>((resolve) => {
      finishLookup = resolve;
    });
    __setColoradoRateSourceForTests({
      async lookup() {
        startLookup();
        await allowResult;
        return {
          status: "MATCHED",
          normalizedAddress: "Old private normalized address",
          jurisdictions: [
            {
              code: reviewed.code,
              name: reviewed.name,
              level: reviewed.level,
              administration: reviewed.administration,
              rateMilliPercent: 1000,
            },
          ],
        };
      },
    });

    const pending = locateServiceAddress(addressId, { force: true });
    await lookupStarted;
    await prisma.serviceAddress.update({
      where: { id: addressId },
      data: { line1: "Deleted address" },
    });
    finishLookup();

    try {
      await expect(pending).resolves.toEqual({ status: "NEEDS_REVIEW" });
      expect(
        await prisma.addressTaxLocation.count({
          where: { serviceAddressId: addressId },
        }),
      ).toBe(0);
    } finally {
      await prisma.serviceAddress.update({
        where: { id: addressId },
        data: { line1: originalLine1 },
      });
    }
  });

  it("never guesses the administration for a new jurisdiction when the source does not know it", async () => {
    const unknownCode = code("UNKNOWN-ADMIN");
    __setColoradoRateSourceForTests(
      fakeSource({
        status: "MATCHED",
        normalizedAddress: "Synthetic normalized address",
        jurisdictions: [
          {
            code: unknownCode,
            name: "Synthetic Unknown City",
            level: "CITY",
            administration: null,
            rateMilliPercent: 1000,
          },
        ],
      }),
    );

    await expect(
      locateServiceAddress(addressId, { force: true }),
    ).resolves.toEqual({ status: "NEEDS_REVIEW" });
    expect(
      await prisma.taxJurisdiction.findUnique({ where: { code: unknownCode } }),
    ).toBeNull();
    const location = await prisma.addressTaxLocation.findFirstOrThrow({
      where: { serviceAddressId: addressId, isCurrent: true },
    });
    expect(location.reviewNote).toContain("collection method");
  });

  it("records unavailable lookup as manual review and not-found as failed", async () => {
    __setColoradoRateSourceForTests(
      fakeSource({ status: "UNAVAILABLE", message: "Synthetic outage" }),
    );
    await expect(
      locateServiceAddress(addressId, { force: true }),
    ).resolves.toEqual({ status: "NEEDS_REVIEW" });
    expect(
      await prisma.addressTaxLocation.findFirstOrThrow({
        where: { serviceAddressId: addressId, isCurrent: true },
      }),
    ).toMatchObject({
      status: "NEEDS_REVIEW",
      reviewNote: "Synthetic outage",
    });

    __setColoradoRateSourceForTests(
      fakeSource({ status: "NOT_FOUND", message: "Synthetic not found" }),
    );
    await expect(
      locateServiceAddress(addressId, { force: true }),
    ).resolves.toEqual({ status: "FAILED" });
    expect(
      await prisma.addressTaxLocation.findFirstOrThrow({
        where: { serviceAddressId: addressId, isCurrent: true },
      }),
    ).toMatchObject({ status: "FAILED", reviewNote: "Synthetic not found" });
  });

  it("reuses a lookup for 30 days unless force is requested", async () => {
    const jurisdiction = await reviewedJurisdiction("REUSE", {
      rateMilliPercent: 1000,
    });
    const source = fakeSource({
      status: "MATCHED",
      normalizedAddress: "Synthetic normalized address",
      jurisdictions: [
        {
          code: jurisdiction.code,
          name: jurisdiction.name,
          level: jurisdiction.level,
          administration: jurisdiction.administration,
          rateMilliPercent: 1000,
        },
      ],
    });
    __setColoradoRateSourceForTests(source);

    await locateServiceAddress(addressId, { force: true });
    await locateServiceAddress(addressId);
    expect(source.calls).toBe(1);

    await locateServiceAddress(addressId, { force: true });
    expect(source.calls).toBe(2);
  });

  it("supports the configured business tax location without inventing an address", async () => {
    const jurisdiction = await reviewedJurisdiction("BUSINESS", {
      rateMilliPercent: 1000,
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: {
        businessTaxAddress: {
          line1: "99 Synthetic Business Way",
          city: "Greeley",
          zip: "80631",
        },
      },
    });
    __setColoradoRateSourceForTests(
      fakeSource({
        status: "MATCHED",
        normalizedAddress: "Synthetic business normalized",
        jurisdictions: [
          {
            code: jurisdiction.code,
            name: jurisdiction.name,
            level: jurisdiction.level,
            administration: jurisdiction.administration,
            rateMilliPercent: 1000,
          },
        ],
      }),
    );

    await expect(
      locateBusinessTaxAddress({ force: true }),
    ).resolves.toEqual({ status: "NEEDS_REVIEW" });
    expect(
      await prisma.addressTaxLocation.findFirstOrThrow({
        where: { forBusinessLocation: true, isCurrent: true },
      }),
    ).toMatchObject({
      serviceAddressId: null,
      status: "NEEDS_REVIEW",
      source: "COLORADO_GIS",
    });
  });

  it("lets OWNER/ADMIN confirm a manual address mapping and audits the policy decision", async () => {
    const jurisdiction = await reviewedJurisdiction("MANUAL", {
      rateMilliPercent: 1000,
    });

    await confirmAddressLocation(ownerId, {
      serviceAddressId: addressId,
      jurisdictionIds: [jurisdiction.id],
    });

    expect(
      await prisma.addressTaxLocation.findFirstOrThrow({
        where: { serviceAddressId: addressId, isCurrent: true },
      }),
    ).toMatchObject({
      status: "VERIFIED",
      source: "MANUAL",
      confirmedByUserId: ownerId,
    });
    expect(
      await prisma.auditLog.findFirst({
        where: {
          userId: ownerId,
          action: "tax.address.confirm",
          entityId: addressId,
        },
      }),
    ).not.toBeNull();
  });
});
