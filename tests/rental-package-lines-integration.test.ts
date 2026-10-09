import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { addRentalLine } from "@/domains/agreements";
import { addEstimateLineItem } from "@/domains/estimates/index-base";
import { createPackage, setPackageActive } from "@/domains/packages";
import { splitOldSetAppliance } from "@/domains/packages/split";
import { getExceptionOverview } from "@/domains/exceptions";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("set lines on agreements and quotes, and splitting old set records (W-16B)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `w16b-owner-${tag}`;
  const customerUserId = `w16b-cust-${tag}`;
  const customerId = `w16b-customer-${tag}`;
  const addressId = `w16b-address-${tag}`;
  const types = { washer: `w16b-washer-${tag}`, dryer: `w16b-dryer-${tag}` };
  const applianceIds: string[] = [];
  let packageId = "";
  let oldSetTypeId = "";

  const appliance = async (typeId: string, suffix: string, data: Record<string, unknown> = {}) => {
    const created = await prisma.appliance.create({
      data: { id: `w16b-${suffix}-${tag}`, assetNumber: `W16B-${suffix}-${tag}`, applianceTypeId: typeId, ...data },
    });
    applianceIds.push(created.id);
    return created;
  };
  const draftAgreement = (termMonths: number | null) =>
    prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "DRAFT", termMonths } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "Set Owner", role: "OWNER", emailVerified: true },
        { id: customerUserId, email: `${tag}-cust@example.test`, name: "Set Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId: customerUserId, referralCode: `W16B${tag}`.slice(0, 20) } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Set St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.createMany({
      data: [
        { id: types.washer, name: `Washer ${tag}`, slug: `washer-${tag}`, monthlyPriceCents: 3500, sortOrder: 801 },
        { id: types.dryer, name: `Dryer ${tag}`, slug: `dryer-${tag}`, monthlyPriceCents: 3500, sortOrder: 802 },
      ],
    });
    packageId = (
      await createPackage(ownerId, {
        name: `Pair ${tag}`,
        monthlyPriceCents: 6000,
        components: [
          { applianceTypeId: types.washer, quantity: 1 },
          { applianceTypeId: types.dryer, quantity: 1 },
        ],
      })
    ).id;
  });

  afterAll(async () => {
    const agreements = await prisma.rentalAgreement.findMany({ where: { customerId }, select: { id: true } });
    const lineIds = (await prisma.rentalLine.findMany({ where: { agreementId: { in: agreements.map((a) => a.id) } } })).map((l) => l.id);
    await prisma.applianceCustodyEpisode.deleteMany({ where: { customerId } });
    await prisma.applianceAssignment.deleteMany({ where: { rentalLineId: { in: lineIds } } });
    await prisma.rentalLine.deleteMany({ where: { id: { in: lineIds } } });
    await prisma.estimate.deleteMany({ where: { title: { endsWith: tag } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    const created = await prisma.appliance.findMany({ where: { notes: { contains: `W16B-OLD-${tag}` } }, select: { id: true } });
    await prisma.appliance.deleteMany({ where: { id: { in: [...applianceIds, ...created.map((a) => a.id)] } } });
    await prisma.rentalPackage.deleteMany({ where: { id: packageId } });
    await prisma.pricingRule.deleteMany({ where: { changedBy: ownerId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    if (oldSetTypeId) await prisma.applianceType.deleteMany({ where: { id: oldSetTypeId } });
    await prisma.applianceType.deleteMany({ where: { id: { in: Object.values(types) } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("a set line takes exactly one machine per part, keeps the set and gets the set prepay discount", async () => {
    const agreement = await draftAgreement(12);
    const washer = await appliance(types.washer, "W1");
    const dryer = await appliance(types.dryer, "D1");
    const washer2 = await appliance(types.washer, "W2");

    await expect(
      addRentalLine(ownerId, agreement.id, { label: "Pair", listPriceCents: 6000, applianceIds: [washer.id, washer2.id], packageId }),
    ).rejects.toThrow(`Pair ${tag} needs exactly Washer ${tag} + Dryer ${tag}. You picked 2 × Washer ${tag}.`);
    expect(await prisma.appliance.count({ where: { id: { in: [washer.id, washer2.id] }, status: "RESERVED" } })).toBe(0);

    const line = await addRentalLine(ownerId, agreement.id, { label: "Pair", listPriceCents: 6000, applianceIds: [washer.id, dryer.id], packageId });
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(line).toMatchObject({ packageId, listPriceCents: 6000, prepayDiscountCentsPerMonth: settings.twelveMonthPrepayDiscountSetCents });
    expect(await prisma.applianceAssignment.count({ where: { rentalLineId: line.id, unassignedAt: null } })).toBe(2);

    // Retired sets cannot be put on new lines; single-machine lines still work without a set.
    await setPackageActive(ownerId, packageId, false);
    const other = await draftAgreement(null);
    await expect(
      addRentalLine(ownerId, other.id, { label: "Pair", listPriceCents: 6000, applianceIds: [washer2.id], packageId }),
    ).rejects.toThrow(/no longer offered/);
    const single = await addRentalLine(ownerId, other.id, { label: "Washer", listPriceCents: 3500, applianceIds: [washer2.id] });
    expect(single.packageId).toBeNull();
    await setPackageActive(ownerId, packageId, true);
  });

  it("a quote line can name a set and keep a special price", async () => {
    const estimate = await prisma.estimate.create({ data: { title: `Quote ${tag}`, status: "DRAFT", customerId, createdByUserId: ownerId } });
    const line = await addEstimateLineItem(ownerId, estimate.id, { description: "Pair", quantity: 3, monthlyPriceCents: 5000, packageId });
    expect(line).toMatchObject({ packageId, monthlyPriceCents: 5000, quantity: 3 });
    await setPackageActive(ownerId, packageId, false);
    await expect(addEstimateLineItem(ownerId, estimate.id, { description: "Pair", quantity: 1, monthlyPriceCents: 5000, packageId })).rejects.toThrow(
      /no longer offered/,
    );
    await setPackageActive(ownerId, packageId, true);
  });

  it("an old one-record set shows on To do, and splitting it keeps history, the rental, custody and exact totals", async () => {
    // Recreate the pre-W-16A shape: a retired "washer-dryer-set" type (the seeded package of the same slug replaced it).
    oldSetTypeId = (
      await prisma.applianceType.create({
        data: { name: `Washer + Dryer Set ${tag}`, slug: "washer-dryer-set", monthlyPriceCents: 6000, isActive: false },
      })
    ).id;
    const old = await appliance(oldSetTypeId, "OLD", {
      status: "RENTED",
      model: "Old model",
      acquisitionCostCents: 50001,
      acquisitionTaxPaidCents: 333,
      acquisitionTaxStatus: "SALES_TAX_PAID",
      notes: `W16B-OLD-${tag}`,
    });
    const agreement = await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "ACTIVE" } });
    const line = await prisma.rentalLine.create({ data: { agreementId: agreement.id, label: "Washer + Dryer Set", monthlyPriceCents: 6000, listPriceCents: 6000 } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: old.id } });
    await prisma.applianceCustodyEpisode.create({
      data: { applianceId: old.id, customerId, serviceAddressId: addressId, agreementId: agreement.id, startedOn: new Date("2026-09-01"), startEvidence: "MANUAL" },
    });

    const before = await getExceptionOverview();
    expect(before.items.filter((i) => i.category === "OLD_SET_APPLIANCE" && i.href === `/desk/inventory/${old.id}/split`)).toHaveLength(1);

    const seeded = await prisma.rentalPackage.findUniqueOrThrow({
      where: { slug: "washer-dryer-set" },
      include: { components: { include: { applianceType: true } } },
    });
    const washerType = seeded.components.find((c) => c.applianceType.slug === "washer")!.applianceTypeId;
    const dryerType = seeded.components.find((c) => c.applianceType.slug === "dryer")!.applianceTypeId;
    await expect(
      splitOldSetAppliance(ownerId, old.id, [{ applianceTypeId: washerType }, { applianceTypeId: washerType }]),
    ).rejects.toThrow(/needs exactly/);

    const result = await splitOldSetAppliance(ownerId, old.id, [
      { applianceTypeId: washerType, model: "WA-1", serialNumber: "SER-W" },
      { applianceTypeId: dryerType, model: "DR-1", serialNumber: "SER-D" },
    ]);
    expect(result.created).toHaveLength(1);
    const kept = await prisma.appliance.findUniqueOrThrow({ where: { id: old.id } });
    const added = await prisma.appliance.findUniqueOrThrow({ where: { id: result.created[0]!.id } });
    expect(kept).toMatchObject({ applianceTypeId: washerType, assetNumber: old.assetNumber, model: "WA-1", serialNumber: "SER-W", status: "RENTED" });
    expect(added).toMatchObject({ applianceTypeId: dryerType, model: "DR-1", serialNumber: "SER-D", status: "RENTED", acquisitionTaxStatus: "SALES_TAX_PAID" });
    expect(kept.acquisitionCostCents! + added.acquisitionCostCents!).toBe(50001);
    expect(kept.acquisitionTaxPaidCents! + added.acquisitionTaxPaidCents!).toBe(333);
    expect(await prisma.applianceAssignment.count({ where: { rentalLineId: line.id, unassignedAt: null } })).toBe(2);
    expect(await prisma.rentalLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ monthlyPriceCents: 6000, label: "Washer + Dryer Set" });
    expect(await prisma.applianceCustodyEpisode.findFirst({ where: { applianceId: added.id, closedAt: null } })).toMatchObject({
      customerId,
      agreementId: agreement.id,
    });
    expect(await prisma.auditLog.count({ where: { entityId: old.id, action: "appliance.split_old_set" } })).toBe(1);

    await expect(splitOldSetAppliance(ownerId, old.id, [{ applianceTypeId: washerType }, { applianceTypeId: dryerType }])).rejects.toThrow(
      /already split/,
    );
    const after = await getExceptionOverview();
    expect(after.items.some((i) => i.href === `/desk/inventory/${old.id}/split`)).toBe(false);
  });

  it("the migration turns the old set type into a package, points old requests at it and retires the type — safely re-runnable", async () => {
    const sql = readFileSync("prisma/migrations/20261013100000_rental_packages/migration.sql", "utf8");
    const dataStep = sql.slice(sql.indexOf("-- Moving existing data"));
    const statements = dataStep
      .split(/;\s*\n/)
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    expect(statements).toHaveLength(4);

    const rollback = new Error("rollback");
    await expect(
      prisma.$transaction(async (tx) => {
        // Start from the pre-W-16A shape: no package, an active set type, a lead that asked for it. (Runs after the split
        // test in this file, so the old type that test made is moved aside first; everything rolls back.)
        await tx.applianceType.updateMany({ where: { slug: "washer-dryer-set" }, data: { slug: `old-set-${tag}` } });
        await tx.rentalPackage.deleteMany({ where: { slug: "washer-dryer-set" } });
        const setType = await tx.applianceType.create({
          data: { name: `Old Set Type ${tag}`, slug: "washer-dryer-set", monthlyPriceCents: 6100, showOnWebsite: true, sortOrder: 0 },
        });
        const lead = await tx.lead.create({
          data: { contactName: "Old lead", phone: "5550000000", desiredTerm: "month-to-month", quantity: 1, applianceRequests: { create: [{ applianceTypeId: setType.id }] } },
        });
        for (let run = 0; run < 2; run += 1) {
          for (const statement of statements) await tx.$executeRawUnsafe(statement);
        }
        const pkg = await tx.rentalPackage.findUniqueOrThrow({
          where: { slug: "washer-dryer-set" },
          include: { components: { include: { applianceType: true } } },
        });
        expect(pkg).toMatchObject({ monthlyPriceCents: 6100, showOnWebsite: true, isActive: true });
        expect(pkg.components.map((c) => c.applianceType.slug).sort()).toEqual(["dryer", "washer"]);
        expect(await tx.applianceType.findUniqueOrThrow({ where: { id: setType.id } })).toMatchObject({ isActive: false, showOnWebsite: false });
        expect(await tx.leadApplianceRequest.findFirstOrThrow({ where: { leadId: lead.id } })).toMatchObject({ packageId: pkg.id });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
