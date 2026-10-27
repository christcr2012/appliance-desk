// OPS-2: refrigerant (EPA Section 608 Type I) certifications for the people who can be given repair visits.
// Owner only. A repair marked "sealed system" can be given only to someone listed here. Nothing here contacts anyone.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey } from "@/lib/business-date";

export class CertificationError extends Error {}
export const TYPE_I = "EPA_608_TYPE_I";

export async function saveTeamCertification(actorUserId: string, userId: string, input: { certificationNumber: string; issuedOnKey?: string }): Promise<void> {
  const number = input.certificationNumber.trim().slice(0, 60);
  if (!number) throw new CertificationError("Enter the certification number from the card.");
  const issuedOn = input.issuedOnKey ? businessDateFromKey(input.issuedOnKey) : null;
  if (input.issuedOnKey && !issuedOn) throw new CertificationError("Pick a real date.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const person = await tx.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true } });
    if (!person || person.archivedAt || !["OWNER", "ADMIN", "STAFF"].includes(person.role)) throw new CertificationError("Choose an active team member.");
    await tx.teamCertification.upsert({
      where: { userId_kind: { userId, kind: TYPE_I } },
      create: { userId, kind: TYPE_I, certificationNumber: number, issuedOn, createdByUserId: actorUserId },
      update: { certificationNumber: number, issuedOn },
    });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "team.certification_saved", entityType: "User", entityId: userId, newValue: { kind: TYPE_I } } });
  });
}

export async function removeTeamCertification(actorUserId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const removed = await tx.teamCertification.deleteMany({ where: { userId, kind: TYPE_I } });
    if (removed.count > 0) await tx.auditLog.create({ data: { userId: actorUserId, action: "team.certification_removed", entityType: "User", entityId: userId, newValue: { kind: TYPE_I } } });
  });
}

/** Owner view: every active team member and whether a refrigerant certification is on file. */
export async function listTeamCertifications() {
  const people = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "STAFF"] }, archivedAt: null },
    orderBy: [{ role: "asc" }, { name: "asc" }], take: 100,
    select: { id: true, name: true, email: true, role: true, teamCertifications: { where: { kind: TYPE_I }, select: { certificationNumber: true, issuedOn: true } } },
  });
  return people.map((p) => ({ id: p.id, name: p.name ?? p.email, role: p.role, certification: p.teamCertifications[0] ?? null }));
}

/**
 * The gate: a sealed-system repair may only be given to someone with a refrigerant certification on file. Call inside the
 * transaction that assigns the visit, after the people are locked. No assignee is fine (nobody is doing it yet).
 */
export async function assertSealedSystemAssignee(tx: Prisma.TransactionClient, assigneeUserId: string | null | undefined): Promise<void> {
  if (!assigneeUserId) return;
  const cert = await tx.teamCertification.findUnique({ where: { userId_kind: { userId: assigneeUserId, kind: TYPE_I } }, select: { id: true } });
  if (cert) return;
  const person = await tx.user.findUnique({ where: { id: assigneeUserId }, select: { name: true, email: true } });
  throw new CertificationError(`Hire a certified technician for this repair. ${person?.name ?? person?.email ?? "That person"} has no refrigerant (Type I) certification on file. Sealed refrigerant systems may only be repaired by someone certified; add it in Settings > Team if they have one.`);
}
