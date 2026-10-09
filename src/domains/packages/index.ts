/**
 * Rental packages (sets) — Batch W Amendment B, D-WB3. The owner defines what goes together (e.g. one Washer + one
 * Dryer) and the set price; every machine stays its own appliance. OWNER/ADMIN only; every write re-checks the actor
 * inside its transaction, locks the package row it changes and leaves an AuditLog row. A price change is also kept in
 * PricingRule (price history is sacred: signed agreements keep their own snapshot and are never changed here).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { slugify } from "@/domains/settings";
import { validatePackageInput, type PackageInput } from "./pricing";

export class PackageInputError extends Error {}

const componentInclude = {
  components: {
    include: { applianceType: { select: { id: true, name: true, monthlyPriceCents: true, isActive: true } } },
    orderBy: { applianceType: { sortOrder: "asc" } },
  },
} satisfies Prisma.RentalPackageInclude;

/** Every package, active and retired, with its machines — for Settings → Products and pricing. */
export async function listPackagesForSettings() {
  return prisma.rentalPackage.findMany({
    include: componentInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

async function lockPackage(tx: Prisma.TransactionClient, packageId: string) {
  await tx.$queryRaw`SELECT "id" FROM "RentalPackage" WHERE "id" = ${packageId} FOR UPDATE`;
  const found = await tx.rentalPackage.findUnique({ where: { id: packageId }, include: componentInclude });
  if (!found) throw new PackageInputError("That set no longer exists. Reload the page.");
  return found;
}

async function checkInput(tx: Prisma.TransactionClient, input: PackageInput, excludeId?: string) {
  const problem = validatePackageInput(input);
  if (problem) throw new PackageInputError(problem);
  const types = await tx.applianceType.findMany({
    where: { id: { in: input.components.map((c) => c.applianceTypeId) } },
    select: { id: true, isActive: true, name: true },
  });
  if (types.length !== input.components.length) throw new PackageInputError("One of those machine types no longer exists. Reload the page.");
  const retired = types.find((t) => !t.isActive);
  if (retired) throw new PackageInputError(`${retired.name} is retired. Restore it first, or pick another machine.`);
  const name = input.name.trim();
  const clash = await tx.rentalPackage.findFirst({ where: { name, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
  if (clash) throw new PackageInputError(`A set named “${name}” already exists.`);
  return name;
}

async function uniqueSlug(tx: Prisma.TransactionClient, name: string) {
  const base = slugify(name);
  if (!base) throw new PackageInputError("The name must contain at least one letter or number.");
  let slug = base;
  for (let suffix = 2; await tx.rentalPackage.findUnique({ where: { slug } }); suffix += 1) slug = `${base}-${suffix}`;
  return slug;
}

const componentRows = (input: PackageInput) =>
  input.components.map((c) => ({ applianceTypeId: c.applianceTypeId, quantity: c.quantity }));

/** Creates a set. It starts hidden from the website, like a new appliance type. */
export async function createPackage(userId: string, input: PackageInput) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const name = await checkInput(tx, input);
    const slug = await uniqueSlug(tx, name);
    const maxSort = await tx.rentalPackage.aggregate({ _max: { sortOrder: true } });
    const created = await tx.rentalPackage.create({
      data: {
        name,
        slug,
        monthlyPriceCents: input.monthlyPriceCents,
        showOnWebsite: false,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        components: { create: componentRows(input) },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "package.create",
        entityType: "RentalPackage",
        entityId: created.id,
        newValue: { name, monthlyPriceCents: input.monthlyPriceCents, components: componentRows(input) },
      },
    });
    return created;
  });
}

/** Changes a set's name, price and machines. Agreements already signed keep their own prices. */
export async function updatePackage(userId: string, packageId: string, input: PackageInput) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const before = await lockPackage(tx, packageId);
    const name = await checkInput(tx, input, packageId);
    await tx.rentalPackageComponent.deleteMany({ where: { packageId } });
    const updated = await tx.rentalPackage.update({
      where: { id: packageId },
      data: { name, monthlyPriceCents: input.monthlyPriceCents, components: { create: componentRows(input) } },
    });
    if (before.monthlyPriceCents !== input.monthlyPriceCents) {
      await tx.pricingRule.create({
        data: {
          label: `${name} — set price`,
          monthlyPriceCents: input.monthlyPriceCents,
          changedBy: userId,
          oldValueCents: before.monthlyPriceCents,
          newValueCents: input.monthlyPriceCents,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: "package.update",
        entityType: "RentalPackage",
        entityId: packageId,
        oldValue: {
          name: before.name,
          monthlyPriceCents: before.monthlyPriceCents,
          components: before.components.map((c) => ({ applianceTypeId: c.applianceTypeId, quantity: c.quantity })),
        },
        newValue: { name, monthlyPriceCents: input.monthlyPriceCents, components: componentRows(input) },
      },
    });
    return updated;
  });
}

export async function setPackageVisibility(userId: string, packageId: string, showOnWebsite: boolean) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const before = await lockPackage(tx, packageId);
    if (showOnWebsite && !before.isActive) throw new PackageInputError("Restore this set before showing it on the website.");
    const updated = await tx.rentalPackage.update({ where: { id: packageId }, data: { showOnWebsite } });
    await tx.auditLog.create({
      data: { userId, action: "package.visibility", entityType: "RentalPackage", entityId: packageId, newValue: { showOnWebsite } },
    });
    return updated;
  });
}

/** Retiring never deletes (old quotes and agreements keep pointing at it) and always hides it from the website. */
export async function setPackageActive(userId: string, packageId: string, isActive: boolean) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockPackage(tx, packageId);
    const updated = await tx.rentalPackage.update({
      where: { id: packageId },
      data: isActive ? { isActive } : { isActive, showOnWebsite: false },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: isActive ? "package.restore" : "package.retire",
        entityType: "RentalPackage",
        entityId: packageId,
        newValue: { isActive },
      },
    });
    return updated;
  });
}
