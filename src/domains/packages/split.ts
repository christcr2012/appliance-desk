/**
 * Splitting an old "set" appliance (W-16B, D-WB3 "Moving existing data"). Before W-16A a washer and dryer set could be
 * recorded as ONE appliance of the "Washer + Dryer Set" type. That type is retired; each such record becomes the real
 * machines the set package lists. The existing row keeps its asset number and all its history and becomes the first
 * machine; the other machine(s) are new rows with their own asset numbers, model and serial. Anything the old row was
 * part of carries over unchanged — a signed agreement's line and price are never changed, the new machine simply joins
 * the same line, with the same custody stay if the set is at a customer. Cost and seller tax already recorded are split
 * evenly (largest remainder), so totals stay exact. OWNER/ADMIN only.
 */
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { allocateAssetNumbers } from "@/domains/inventory/asset-numbers";
import { assetNumberPrefix } from "@/domains/inventory";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { OLD_SET_TYPE_SLUG, packagePartsProblem } from "./pricing";

export { OLD_SET_TYPE_SLUG };

export class SplitApplianceError extends Error {}

export type SplitPartInput = { applianceTypeId: string; manufacturer?: string; model?: string; serialNumber?: string };

/** The machines an old set appliance must become, from the package that replaced its type (same slug). */
export async function splitPlanFor(applianceId: string) {
  const appliance = await prisma.appliance.findUnique({
    where: { id: applianceId },
    include: { applianceType: true },
  });
  if (!appliance || appliance.applianceType.slug !== OLD_SET_TYPE_SLUG || appliance.archivedAt) return null;
  const pkg = await prisma.rentalPackage.findUnique({
    where: { slug: OLD_SET_TYPE_SLUG },
    include: { components: { include: { applianceType: true }, orderBy: { applianceType: { sortOrder: "asc" } } } },
  });
  if (!pkg || pkg.components.length === 0) return null;
  const parts = pkg.components.flatMap((c) =>
    Array.from({ length: c.quantity }, () => ({ applianceTypeId: c.applianceTypeId, name: c.applianceType.name })),
  );
  return { appliance, packageName: pkg.name, parts, components: pkg.components };
}

const blank = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

export async function splitOldSetAppliance(userId: string, applianceId: string, parts: SplitPartInput[]) {
  const plan = await splitPlanFor(applianceId);
  if (!plan) throw new SplitApplianceError("This appliance is not an old set record, or it was already split.");
  const typeNames = new Map(plan.components.map((c) => [c.applianceTypeId, c.applianceType.name]));
  const problem = packagePartsProblem(
    plan.packageName,
    plan.components.map((c) => ({ applianceTypeId: c.applianceTypeId, name: c.applianceType.name, quantity: c.quantity })),
    parts.map((p) => ({ applianceTypeId: p.applianceTypeId, name: typeNames.get(p.applianceTypeId) ?? "another machine" })),
  );
  if (problem) throw new SplitApplianceError(problem);
  for (const part of parts) {
    if ((part.serialNumber ?? "").length > 100 || (part.model ?? "").length > 100 || (part.manufacturer ?? "").length > 100) {
      throw new SplitApplianceError("Keep each make, model and serial number under 100 characters.");
    }
  }

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${applianceId} FOR UPDATE`;
    const original = await tx.appliance.findUniqueOrThrow({ where: { id: applianceId }, include: { applianceType: true } });
    if (original.applianceType.slug !== OLD_SET_TYPE_SLUG || original.archivedAt) {
      throw new SplitApplianceError("This appliance was already split. Reload the page.");
    }
    const [first, ...others] = parts;
    const costShares = original.acquisitionCostCents == null ? null : allocateAcrossLines(original.acquisitionCostCents, parts.map(() => 1));
    const taxShares = original.acquisitionTaxPaidCents == null ? null : allocateAcrossLines(original.acquisitionTaxPaidCents, parts.map(() => 1));
    const note = `Split from ${original.assetNumber} (an old washer + dryer set record) on ${new Date().toISOString().slice(0, 10)}.`;

    await tx.appliance.update({
      where: { id: original.id },
      data: {
        applianceTypeId: first!.applianceTypeId,
        manufacturer: blank(first!.manufacturer) ?? original.manufacturer,
        model: blank(first!.model) ?? original.model,
        serialNumber: blank(first!.serialNumber),
        acquisitionCostCents: costShares ? costShares[0] : original.acquisitionCostCents,
        acquisitionTaxPaidCents: taxShares ? taxShares[0] : original.acquisitionTaxPaidCents,
        notes: [original.notes, note].filter(Boolean).join("\n"),
      },
    });

    const openAssignment = await tx.applianceAssignment.findFirst({ where: { applianceId, unassignedAt: null } });
    const openCustody = await tx.applianceCustodyEpisode.findFirst({ where: { applianceId, closedAt: null } });
    const created = [];
    for (const [index, part] of others.entries()) {
      const typeName = typeNames.get(part.applianceTypeId)!;
      const [assetNumber] = await allocateAssetNumbers(tx, assetNumberPrefix(typeName), 1);
      const machine = await tx.appliance.create({
        data: {
          assetNumber: assetNumber!,
          applianceTypeId: part.applianceTypeId,
          manufacturer: blank(part.manufacturer),
          model: blank(part.model),
          serialNumber: blank(part.serialNumber),
          color: original.color,
          condition: original.condition,
          purchaseDate: original.purchaseDate,
          acquisitionCostCents: costShares ? costShares[index + 1] : null,
          acquisitionTaxStatus: original.acquisitionTaxStatus,
          acquisitionTaxPaidCents: taxShares ? taxShares[index + 1] : null,
          acquisitionSellerNote: original.acquisitionSellerNote,
          acquisitionTaxChoice: original.acquisitionTaxChoice,
          acquisitionTaxRecordedAt: original.acquisitionTaxRecordedAt,
          acquisitionTaxRecordedByUserId: original.acquisitionTaxRecordedByUserId,
          status: original.status,
          currentLocation: original.currentLocation,
          notes: note,
        },
      });
      if (openAssignment) {
        await tx.applianceAssignment.create({
          data: { rentalLineId: openAssignment.rentalLineId, applianceId: machine.id, assignedAt: openAssignment.assignedAt },
        });
      }
      if (openCustody) {
        await tx.applianceCustodyEpisode.create({
          data: {
            applianceId: machine.id,
            customerId: openCustody.customerId,
            serviceAddressId: openCustody.serviceAddressId,
            agreementId: openCustody.agreementId,
            startedOn: openCustody.startedOn,
            startEvidence: openCustody.startEvidence,
            startJobId: openCustody.startJobId,
          },
        });
      }
      created.push(machine);
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.split_old_set",
        entityType: "Appliance",
        entityId: original.id,
        oldValue: { applianceTypeId: original.applianceTypeId, serialNumber: original.serialNumber, acquisitionCostCents: original.acquisitionCostCents },
        newValue: { keptAs: first!.applianceTypeId, newMachines: created.map((m) => ({ id: m.id, assetNumber: m.assetNumber })) },
      },
    });
    return { original: original.assetNumber, created };
  });
}
