import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: false }) }));
import { prisma } from "@/lib/prisma";
import {
  createPackage,
  updatePackage,
  setPackageActive,
  setPackageVisibility,
  PackageInputError,
} from "@/domains/packages";
import { getPublishedCatalog } from "@/domains/pricing";
import { createLead } from "@/domains/leads";
import { leadFormSchemaForCatalog } from "@/domains/leads/schema";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("rental packages (W-16A) in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `pkg-owner-${tag}`;
  const staffId = `pkg-staff-${tag}`;
  const archivedId = `pkg-archived-${tag}`;
  const typeIds = { washer: `pkg-washer-${tag}`, dryer: `pkg-dryer-${tag}`, freezer: `pkg-freezer-${tag}`, retired: `pkg-retired-${tag}` };
  const leadIds: string[] = [];
  const set = (name: string, price = 6000) => ({
    name: `${name} ${tag}`,
    monthlyPriceCents: price,
    components: [
      { applianceTypeId: typeIds.washer, quantity: 1 },
      { applianceTypeId: typeIds.dryer, quantity: 1 },
    ],
  });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "Package Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `${tag}-staff@example.test`, name: "Package Staff", role: "STAFF", emailVerified: true },
        { id: archivedId, email: `${tag}-old@example.test`, name: "Old Admin", role: "ADMIN", emailVerified: true, archivedAt: new Date() },
      ],
    });
    await prisma.applianceType.createMany({
      data: [
        { id: typeIds.washer, name: `Washer ${tag}`, slug: `washer-${tag}`, monthlyPriceCents: 3500, showOnWebsite: true, sortOrder: 901 },
        { id: typeIds.dryer, name: `Dryer ${tag}`, slug: `dryer-${tag}`, monthlyPriceCents: 3500, showOnWebsite: true, sortOrder: 902 },
        // Stands for a type the owner adds after launch.
        { id: typeIds.freezer, name: `Chest Freezer ${tag}`, slug: `chest-freezer-${tag}`, monthlyPriceCents: 2999, showOnWebsite: false, sortOrder: 903 },
        { id: typeIds.retired, name: `Old Thing ${tag}`, slug: `old-thing-${tag}`, monthlyPriceCents: 1000, isActive: false, sortOrder: 904 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.leadApplianceRequest.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.consentRecord.deleteMany({ where: { OR: leadIds.map((id) => ({ details: { path: ["leadId"], equals: id } })) } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.rentalPackage.deleteMany({ where: { name: { endsWith: tag } } });
    await prisma.pricingRule.deleteMany({ where: { changedBy: ownerId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.applianceType.deleteMany({ where: { id: { in: Object.values(typeIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, archivedId] } } });
  });

  it("creates a hidden set with its machines and an audit row; a price change keeps price history", async () => {
    const created = await createPackage(ownerId, set("Laundry Pair"));
    expect(created).toMatchObject({ showOnWebsite: false, isActive: true, monthlyPriceCents: 6000, slug: `laundry-pair-${tag}` });
    expect(await prisma.rentalPackageComponent.count({ where: { packageId: created.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: created.id, action: "package.create", userId: ownerId } })).toBe(1);

    await updatePackage(ownerId, created.id, { ...set("Laundry Pair", 5800), components: [{ applianceTypeId: typeIds.washer, quantity: 2 }] });
    const after = await prisma.rentalPackage.findUniqueOrThrow({ where: { id: created.id }, include: { components: true } });
    expect(after.monthlyPriceCents).toBe(5800);
    expect(after.components).toEqual([expect.objectContaining({ applianceTypeId: typeIds.washer, quantity: 2 })]);
    expect(await prisma.pricingRule.findFirst({ where: { changedBy: ownerId, label: `Laundry Pair ${tag} — set price` } })).toMatchObject({
      oldValueCents: 6000,
      newValueCents: 5800,
    });
    // Same price again: no new price-history row.
    await updatePackage(ownerId, created.id, { ...set("Laundry Pair", 5800), components: [{ applianceTypeId: typeIds.washer, quantity: 2 }] });
    expect(await prisma.pricingRule.count({ where: { changedBy: ownerId, label: `Laundry Pair ${tag} — set price` } })).toBe(1);
  });

  it("works with a type added after launch", async () => {
    const created = await createPackage(ownerId, {
      name: `Freezer Pair ${tag}`,
      monthlyPriceCents: 5000,
      components: [{ applianceTypeId: typeIds.freezer, quantity: 2 }],
    });
    expect(await prisma.rentalPackageComponent.findMany({ where: { packageId: created.id } })).toEqual([
      expect.objectContaining({ applianceTypeId: typeIds.freezer, quantity: 2 }),
    ]);
  });

  it("refuses staff, archived accounts, retired machines and duplicate names without writing anything", async () => {
    await expect(createPackage(staffId, set("Staff Set"))).rejects.toThrow(/no longer has access/);
    await expect(createPackage(archivedId, set("Archived Set"))).rejects.toThrow(/no longer has access/);
    await expect(
      createPackage(ownerId, { ...set("Retired Set"), components: [{ applianceTypeId: typeIds.retired, quantity: 2 }] }),
    ).rejects.toThrow(/is retired/);
    await createPackage(ownerId, set("Twin"));
    await expect(createPackage(ownerId, set("Twin"))).rejects.toBeInstanceOf(PackageInputError);
    expect(await prisma.rentalPackage.count({ where: { name: { in: [`Staff Set ${tag}`, `Archived Set ${tag}`, `Retired Set ${tag}`] } } })).toBe(0);
  });

  it("offers only published, active sets whose machines are all active, before single machines", async () => {
    const shown = await createPackage(ownerId, set("Shown Set", 6000));
    await setPackageVisibility(ownerId, shown.id, true);
    const hidden = await createPackage(ownerId, set("Hidden Set"));
    const retiredSet = await createPackage(ownerId, set("Retired Later"));
    await setPackageVisibility(ownerId, retiredSet.id, true);
    await setPackageActive(ownerId, retiredSet.id, false);
    expect(await prisma.rentalPackage.findUniqueOrThrow({ where: { id: retiredSet.id } })).toMatchObject({ isActive: false, showOnWebsite: false });
    await expect(setPackageVisibility(ownerId, retiredSet.id, true)).rejects.toThrow(/Restore this set/);

    const catalog = await getPublishedCatalog();
    const shownItem = catalog.find((item) => item.id === shown.id);
    expect(shownItem).toMatchObject({ kind: "package", contents: `Washer ${tag} + Dryer ${tag}`, savingCents: 1000 });
    expect(catalog.some((item) => item.id === hidden.id || item.id === retiredSet.id)).toBe(false);
    const lastPackage = catalog.map((item) => item.kind).lastIndexOf("package");
    const firstType = catalog.map((item) => item.kind).indexOf("type");
    expect(lastPackage).toBeLessThan(firstType);

    // Retiring a machine type hides every set that contains it.
    await prisma.applianceType.update({ where: { id: typeIds.dryer }, data: { isActive: false } });
    expect((await getPublishedCatalog()).some((item) => item.id === shown.id)).toBe(false);
    await prisma.applianceType.update({ where: { id: typeIds.dryer }, data: { isActive: true } });
  });

  it("stores a requested set as one request row per machine, tagged with the set", async () => {
    const pkg = await createPackage(ownerId, set("Lead Set"));
    const input = leadFormSchemaForCatalog(true).parse({
      accountType: "individual",
      isPropertyManager: false,
      contactName: "Package lead",
      phone: "5551234567",
      applianceTypeIds: [typeIds.freezer],
      packageIds: [pkg.id],
      quantity: 2,
      desiredTerm: "month-to-month",
      consent: true,
    });
    const lead = await createLead(input);
    leadIds.push(lead.id);
    const rows = await prisma.leadApplianceRequest.findMany({ where: { leadId: lead.id }, orderBy: { applianceTypeId: "asc" } });
    expect(rows.map((r) => [r.applianceTypeId, r.packageId, r.quantity])).toEqual(
      [
        [typeIds.dryer, pkg.id, 2],
        [typeIds.freezer, null, 2],
        [typeIds.washer, pkg.id, 2],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });
});
