import { randomUUID } from "node:crypto";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDraftAgreement } from "@/domains/agreements";
import { createJob, updateJobStatus } from "@/domains/jobs";
import { scheduleJob } from "@/domains/jobs/scheduling";
import {
  assertDeliveryReadyInTx,
  deliveryTaxReadiness,
  recordDeliveryCountInTx,
  recordReadinessOverrideInTx,
  saveReadiness,
} from "@/domains/tax/delivery-readiness";
import { prisma } from "@/lib/prisma";

/**
 * FEETAX-2: the delivery-area readiness check on real Postgres. Each
 * test builds its own tagged jurisdictions, readiness rows, customer
 * and located address, and cleans them up afterwards.
 */
const maybeDescribe = process.env.DATABASE_URL ? describe : describe.skip;

const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const NOW = new Date("2026-10-27T16:00:00.000Z");

let ownerId = "";
let seq = 0;

async function makeAddress(state = "CO") {
  seq += 1;
  const userId = `dr-user-${tag}-${seq}`;
  const customerId = `dr-customer-${tag}-${seq}`;
  const addressId = `dr-address-${tag}-${seq}`;
  await prisma.user.create({
    data: { id: userId, email: `dr-${tag}-${seq}@example.test`, role: "CUSTOMER" },
  });
  await prisma.customer.create({
    data: { id: customerId, userId, referralCode: `DR${tag.slice(0, 8)}${seq}` },
  });
  await prisma.serviceAddress.create({
    data: {
      id: addressId,
      customerId,
      line1: "1 Readiness Test Way",
      city: "Testville",
      state,
      zip: "80631",
    },
  });
  return { customerId, addressId };
}

async function makeJurisdiction(
  suffix: string,
  opts: {
    administration?: "SELF_COLLECTED" | "STATE_COLLECTED";
    level?: "CITY" | "STATE";
    readiness?: {
      licenseRequired: "NONE" | "ALWAYS" | "AFTER_FIRST_DELIVERY" | "AFTER_SECOND_DELIVERY_IN_12_MONTHS" | "UNKNOWN";
      licenseRecordId?: string | null;
    } | null;
    rentalRule?: "TAXABLE" | "EXEMPT" | "UNDECIDED" | null;
  } = {},
) {
  const id = `dr-jur-${tag}-${suffix}`;
  await prisma.taxJurisdiction.create({
    data: {
      id,
      code: `DR${tag.slice(0, 6)}-${suffix}`.toUpperCase(),
      name: `Test ${suffix} ${tag}`,
      level: opts.level ?? "CITY",
      administration: opts.administration ?? "SELF_COLLECTED",
      reviewStatus: "REVIEWED",
    },
  });
  if (opts.readiness) {
    await prisma.jurisdictionReadiness.create({
      data: {
        jurisdictionId: id,
        licenseRequired: opts.readiness.licenseRequired,
        licenseRecordId: opts.readiness.licenseRecordId ?? null,
        filesThrough: "SUTS",
        reviewStatus: "REVIEWED",
      },
    });
  }
  if (opts.rentalRule) {
    await prisma.taxabilityRule.create({
      data: { jurisdictionId: id, category: "RENTAL", taxability: opts.rentalRule },
    });
  }
  return id;
}

async function locate(addressId: string, jurisdictionIds: string[]) {
  await prisma.addressTaxLocation.create({
    data: {
      serviceAddressId: addressId,
      status: "VERIFIED",
      source: "MANUAL",
      lookedUpAt: NOW,
      isCurrent: true,
      jurisdictions: {
        create: jurisdictionIds.map((jurisdictionId) => ({ jurisdictionId })),
      },
    },
  });
}

async function makeLicenseRecord(
  expiresOn: Date | null,
  status: "DONE" | "TO_DO" | "IN_PROGRESS" | "NOT_NEEDED" = "DONE",
) {
  const id = `dr-record-${tag}-${seq}-${randomUUID().slice(0, 6)}`;
  await prisma.businessPaperwork.create({
    data: {
      id,
      title: `Test city license ${tag}`,
      groupName: "Licenses",
      kind: "LICENSE",
      status,
      expiresOn,
    },
  });
  return id;
}

async function makeAgreement(customerId: string, addressId: string) {
  const id = `dr-agreement-${tag}-${seq}-${randomUUID().slice(0, 6)}`;
  await prisma.rentalAgreement.create({
    data: { id, customerId, serviceAddressId: addressId, status: "DRAFT" },
  });
  return id;
}

maybeDescribe("FEETAX-2 delivery readiness (real Postgres)", () => {
  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { role: "OWNER", archivedAt: null },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    ownerId = owner.id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ["tax.delivery_readiness_override", "tax.readiness_update"] },
        entityId: { startsWith: "dr-" },
      },
    });
    // Agreements and jobs created through the real save paths carry
    // generated ids, so they are cleaned up by their dr- customer/address.
    await prisma.job.deleteMany({
      where: {
        OR: [
          { customerId: { startsWith: "dr-" } },
          { serviceAddressId: { startsWith: "dr-" } },
        ],
      },
    });
    await prisma.rentalAgreement.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "dr-" } },
          { customerId: { startsWith: "dr-" } },
        ],
      },
    });
    await prisma.jurisdictionDeliveryCount.deleteMany({
      where: { jurisdictionId: { startsWith: "dr-" } },
    });
    await prisma.addressTaxLocation.deleteMany({
      where: { serviceAddressId: { startsWith: "dr-" } },
    });
    await prisma.jurisdictionReadiness.deleteMany({
      where: { jurisdictionId: { startsWith: "dr-" } },
    });
    await prisma.taxabilityRule.deleteMany({
      where: { jurisdictionId: { startsWith: "dr-" } },
    });
    await prisma.taxJurisdiction.deleteMany({ where: { id: { startsWith: "dr-" } } });
    await prisma.businessPaperwork.deleteMany({ where: { id: { startsWith: "dr-" } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { startsWith: "dr-" } } });
    await prisma.customer.deleteMany({ where: { id: { startsWith: "dr-" } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: "dr-" } } });
  });

  it("a seeded state-collected place (Eaton) is ready", async () => {
    const { addressId } = await makeAddress();
    const eaton = await prisma.taxJurisdiction.findUniqueOrThrow({
      where: { code: "EATON" },
      select: { id: true },
    });
    const state = await prisma.taxJurisdiction.findUniqueOrThrow({
      where: { code: "CO" },
      select: { id: true },
    });
    await locate(addressId, [state.id, eaton.id]);
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(true);
    expect(result.places.every((place) => !place.problem)).toBe(true);
  });

  it("an undecided self-collected city is not ready, and is the overrideable kind", async () => {
    const { addressId } = await makeAddress();
    const city = await makeJurisdiction("undecided", {
      readiness: { licenseRequired: "NONE" },
      rentalRule: "UNDECIDED",
    });
    await locate(addressId, [city]);
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.overrideable).toBe(true);
    expect(result.places[0]?.problem?.code).toBe("RULES_UNDECIDED");
  });

  it("a self-collected place with no readiness row is not set up and cannot be overridden", async () => {
    const { addressId } = await makeAddress();
    const city = await makeJurisdiction("unrowed", { readiness: null });
    await locate(addressId, [city]);
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.overrideable).toBe(false);
    expect(result.places[0]?.problem?.code).toBe("PLACE_NOT_SET_UP");
  });

  it("license ALWAYS without a record is not ready and the override refuses", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("licensed", {
      readiness: { licenseRequired: "ALWAYS" },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.overrideable).toBe(false);
    expect(result.places[0]?.problem?.code).toBe("LICENSE_REQUIRED");

    const agreementId = await makeAgreement(customerId, addressId);
    await expect(
      prisma.$transaction((tx) =>
        recordReadinessOverrideInTx(tx, {
          agreementId,
          actorUserId: ownerId,
          reason: "Trying to skip the license",
          serviceAddressId: addressId,
        }, NOW),
      ),
    ).rejects.toThrow(/can't be overridden/);
  });

  it("the owner override works for rules-undecided, is stored, and is audited", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("overridable", {
      readiness: { licenseRequired: "NONE" },
      rentalRule: null,
    });
    await locate(addressId, [city]);
    const agreementId = await makeAgreement(customerId, addressId);

    await prisma.$transaction((tx) =>
      recordReadinessOverrideInTx(tx, {
        agreementId,
        actorUserId: ownerId,
        reason: "Customer is a long-standing account; rules review booked with the CPA.",
        serviceAddressId: addressId,
      }, NOW),
    );

    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
    });
    expect(agreement.readinessOverrideByUserId).toBe(ownerId);
    expect(agreement.readinessOverrideReason).toContain("long-standing");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "tax.delivery_readiness_override", entityId: agreementId },
    });
    expect(audit).toBeTruthy();

    await expect(
      prisma.$transaction((tx) =>
        assertDeliveryReadyInTx(tx, { serviceAddressId: addressId, agreementId }, NOW),
      ),
    ).resolves.toBeUndefined();
  });

  it("the second-delivery license rule: first delivery fine, the next needs the license", async () => {
    const { addressId } = await makeAddress();
    const city = await makeJurisdiction("counting", {
      readiness: {
        licenseRequired: "AFTER_SECOND_DELIVERY_IN_12_MONTHS",
      },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);
    expect((await deliveryTaxReadiness(addressId, NOW)).ready).toBe(true);

    await prisma.jurisdictionDeliveryCount.create({
      data: { jurisdictionId: city, deliveredOn: NOW, orderId: `dr-order-${tag}-1` },
    });
    const blocked = await deliveryTaxReadiness(addressId, NOW);
    expect(blocked.ready).toBe(false);
    expect(blocked.places[0]?.problem?.code).toBe("LICENSE_REQUIRED");
    expect(blocked.places[0]?.problem?.message).toContain("next delivery");

    const recordId = await makeLicenseRecord(null);
    await prisma.jurisdictionReadiness.update({
      where: { jurisdictionId: city },
      data: { licenseRecordId: recordId },
    });
    expect((await deliveryTaxReadiness(addressId, NOW)).ready).toBe(true);
  });

  it("an expired license on file is not ready", async () => {
    const { addressId } = await makeAddress();
    const recordId = await makeLicenseRecord(new Date("2026-01-01T00:00:00.000Z"));
    const city = await makeJurisdiction("expired", {
      readiness: { licenseRequired: "ALWAYS", licenseRecordId: recordId },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.places[0]?.problem?.message).toContain("expired");
  });

  it("out-of-state is refused and never overrideable", async () => {
    const { addressId } = await makeAddress("WY");
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.overrideable).toBe(false);
    expect(result.places[0]?.problem?.code).toBe("OUT_OF_STATE");
  });

  it("an address whose tax places aren't confirmed is not ready", async () => {
    const { addressId } = await makeAddress();
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.places[0]?.problem?.code).toBe("ADDRESS_NOT_LOCATED");
  });

  it("a desk order save refuses a not-ready address, and the owner override saves it", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("ordergate", {
      readiness: { licenseRequired: "NONE" },
      rentalRule: null,
    });
    await locate(addressId, [city]);

    await expect(
      createDraftAgreement(ownerId, { customerId, serviceAddressId: addressId }),
    ).rejects.toThrow(/isn't decided yet/);

    const agreement = await createDraftAgreement(ownerId, {
      customerId,
      serviceAddressId: addressId,
      overrideReason: "Rules review booked with the CPA for this week.",
    });
    const saved = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
    });
    expect(saved.readinessOverrideByUserId).toBe(ownerId);
  });

  it("a desk order save can never override a missing city license", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("orderlicense", {
      readiness: { licenseRequired: "ALWAYS" },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);

    await expect(
      createDraftAgreement(ownerId, {
        customerId,
        serviceAddressId: addressId,
        overrideReason: "Trying anyway",
      }),
    ).rejects.toThrow(/can't be overridden/);
  });

  it("a delivery job refuses a not-ready address and accepts a ready one", async () => {
    const { customerId, addressId } = await makeAddress();
    const blocked = await makeJurisdiction("jobblocked", {
      readiness: { licenseRequired: "ALWAYS" },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [blocked]);
    await expect(
      createJob(ownerId, {
        type: "DELIVERY",
        customerId,
        serviceAddressId: addressId,
      }),
    ).rejects.toThrow(/requires a city license/);

    const ready = await makeAddress();
    const eaton = await prisma.taxJurisdiction.findUniqueOrThrow({
      where: { code: "EATON" },
      select: { id: true },
    });
    await locate(ready.addressId, [eaton.id]);
    const job = await createJob(ownerId, {
      type: "DELIVERY",
      customerId: ready.customerId,
      serviceAddressId: ready.addressId,
    });
    expect(job.id).toBeTruthy();
    await prisma.job.delete({ where: { id: job.id } });
  });

  it("a missing license takes precedence over an undecided rent rule, so it can never be overridden", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("bothproblems", {
      readiness: { licenseRequired: "ALWAYS" },
      // no rentalRule: the rent decision is undecided too
    });
    await locate(addressId, [city]);
    const result = await deliveryTaxReadiness(addressId, NOW);
    expect(result.ready).toBe(false);
    expect(result.places[0]?.problem?.code).toBe("LICENSE_REQUIRED");
    expect(result.overrideable).toBe(false);

    const agreementId = await makeAgreement(customerId, addressId);
    await expect(
      prisma.$transaction((tx) =>
        recordReadinessOverrideInTx(tx, {
          agreementId,
          actorUserId: ownerId,
          reason: "Trying to skip the license via the rent rule",
          serviceAddressId: addressId,
        }, NOW),
      ),
    ).rejects.toThrow(/can't be overridden/);
  });

  it("a license record that is not marked done does not count as on file", async () => {
    const { addressId } = await makeAddress();
    const pendingId = await makeLicenseRecord(null, "TO_DO");
    const city = await makeJurisdiction("pendinglicense", {
      readiness: { licenseRequired: "ALWAYS", licenseRecordId: pendingId },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);
    const before = await deliveryTaxReadiness(addressId, NOW);
    expect(before.ready).toBe(false);
    expect(before.places[0]?.problem?.code).toBe("LICENSE_REQUIRED");

    await prisma.businessPaperwork.update({
      where: { id: pendingId },
      data: { status: "DONE" },
    });
    const after = await deliveryTaxReadiness(addressId, NOW);
    expect(after.ready).toBe(true);
  });

  it("recording a delivery count is idempotent per order", async () => {
    const { addressId } = await makeAddress();
    const city = await makeJurisdiction("counted", {
      readiness: {
        licenseRequired: "AFTER_SECOND_DELIVERY_IN_12_MONTHS",
      },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);
    const orderId = `dr-order-${tag}-count`;
    await prisma.$transaction((tx) =>
      recordDeliveryCountInTx(tx, { orderId, serviceAddressId: addressId, deliveredOn: NOW }),
    );
    await prisma.$transaction((tx) =>
      recordDeliveryCountInTx(tx, { orderId, serviceAddressId: addressId, deliveredOn: NOW }),
    );
    const rows = await prisma.jurisdictionDeliveryCount.findMany({
      where: { orderId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jurisdictionId).toBe(city);
  });

  it("a license expiring before the scheduled visit date does not satisfy scheduling", async () => {
    const { customerId, addressId } = await makeAddress();
    const recordId = await makeLicenseRecord(new Date("2026-11-06T00:00:00.000Z"));
    const city = await makeJurisdiction("expiringlicense", {
      readiness: { licenseRequired: "ALWAYS", licenseRecordId: recordId },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);

    // A visit while the license is still valid schedules fine.
    const early = await createJob(ownerId, {
      type: "DELIVERY",
      customerId,
      serviceAddressId: addressId,
      scheduledAt: new Date("2026-11-01T16:00:00.000Z"),
    });
    expect(early.id).toBeTruthy();

    // The same address with a visit after the license expires refuses.
    await expect(
      createJob(ownerId, {
        type: "DELIVERY",
        customerId,
        serviceAddressId: addressId,
        scheduledAt: new Date("2026-11-20T16:00:00.000Z"),
      }),
    ).rejects.toThrow(/has expired/);

    // Rescheduling the good job past the expiry refuses too.
    await expect(
      scheduleJob(ownerId, {
        jobId: early.id,
        expectedVersion: early.version,
        scheduledAt: new Date("2026-11-20T16:00:00.000Z"),
        durationMinutes: null,
        assignedToUserId: null,
        confirmedConflictJobIds: [],
      }),
    ).rejects.toThrow(/has expired/);
  });

  it("starting a second advance-booked delivery refuses once the first crosses the license threshold", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("dispatchcount", {
      readiness: {
        licenseRequired: "AFTER_SECOND_DELIVERY_IN_12_MONTHS",
      },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);

    // Both orders book fine in advance: no delivery has happened yet.
    const first = await createJob(ownerId, {
      type: "DELIVERY",
      customerId,
      serviceAddressId: addressId,
    });
    const second = await createJob(ownerId, {
      type: "DELIVERY",
      customerId,
      serviceAddressId: addressId,
    });

    // The first delivery completes, which crosses the city's
    // license-after-the-next-delivery threshold...
    await prisma.$transaction((tx) =>
      recordDeliveryCountInTx(tx, {
        orderId: first.id,
        serviceAddressId: addressId,
        deliveredOn: NOW,
      }),
    );

    // ...so the second job can no longer go out without the license.
    await expect(
      updateJobStatus(ownerId, second.id, "IN_PROGRESS"),
    ).rejects.toThrow(/needs a city license first/);
  });

  it("saving a place's readiness creates then updates one row, audited", async () => {
    const city = await makeJurisdiction("saveedit", { rentalRule: "TAXABLE" });
    await saveReadiness(ownerId, city, {
      licenseRequired: "ALWAYS",
      filesThrough: "SUTS",
      licenseRecordId: null,
      sourceUrl: "https://example.test/license",
      notes: "Checked with the city clerk.",
      markReviewed: true,
    }, NOW);
    let row = await prisma.jurisdictionReadiness.findUniqueOrThrow({
      where: { jurisdictionId: city },
    });
    expect(row.licenseRequired).toBe("ALWAYS");
    expect(row.reviewStatus).toBe("REVIEWED");

    await saveReadiness(ownerId, city, {
      licenseRequired: "NONE",
      filesThrough: "SUTS",
      licenseRecordId: null,
      sourceUrl: null,
      notes: "Clerk confirmed no license is needed.",
      markReviewed: false,
    }, NOW);
    row = await prisma.jurisdictionReadiness.findUniqueOrThrow({
      where: { jurisdictionId: city },
    });
    expect(row.licenseRequired).toBe("NONE");
    const audits = await prisma.auditLog.count({
      where: { action: "tax.readiness_update", entityId: city },
    });
    expect(audits).toBe(2);

    await expect(
      saveReadiness(ownerId, "dr-jur-missing", {
        licenseRequired: "NONE",
        filesThrough: "SUTS",
        licenseRecordId: null,
        sourceUrl: null,
        notes: null,
        markReviewed: false,
      }, NOW),
    ).rejects.toThrow(/Couldn't find that place/);
  });

  it("a delivery already on the truck counts toward the threshold at dispatch", async () => {
    const { customerId, addressId } = await makeAddress();
    const city = await makeJurisdiction("dispatchtruck", {
      readiness: {
        licenseRequired: "AFTER_SECOND_DELIVERY_IN_12_MONTHS",
      },
      rentalRule: "TAXABLE",
    });
    await locate(addressId, [city]);

    const first = await createJob(ownerId, {
      type: "DELIVERY",
      customerId,
      serviceAddressId: addressId,
    });
    const second = await createJob(ownerId, {
      type: "DELIVERY",
      customerId,
      serviceAddressId: addressId,
    });

    // The first job goes out (nothing delivered anywhere yet).
    await updateJobStatus(ownerId, first.id, "IN_PROGRESS");

    // While it is on the truck, the second cannot also go out: the
    // in-progress delivery already counts toward the city's rule.
    await expect(
      updateJobStatus(ownerId, second.id, "IN_PROGRESS"),
    ).rejects.toThrow(/needs a city license first/);
  });
});
