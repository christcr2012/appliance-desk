import type { Prisma } from "@prisma/client";
import { assertTestingSeedEnvironment } from "../src/lib/testing-environment";

/** The initial migration already inserts BusinessSettings. A durable marker,
 * under the seed transaction's advisory lock, distinguishes first fixture
 * initialization from later redeployments and operator edits. */
export async function initializeTestingSettings(
  tx: Pick<Prisma.TransactionClient, "businessSettings" | "auditLog">,
  actorId: string,
): Promise<void> {
  assertTestingSeedEnvironment();
  const identity = { action: "testing.seed.settings.v1", entityType: "TestingEnvironment", entityId: "synthetic-fixtures" };
  if (await tx.auditLog.findFirst({ where: identity, select: { id: true } })) return;
  await tx.businessSettings.update({ where: { id: "singleton" }, data: {
    publicBusinessName: "Robinson Appliance Rentals — TEST DATA",
    publicPhone: "+13035550100", publicEmail: "testing@example.test",
    publicAddress: "Fictional testing address — not a business location",
    shortTermLeaseElection: "COLLECT_ON_RENTALS",
  } });
  await tx.auditLog.create({ data: { ...identity, userId: actorId,
    newValue: { synthetic: true, reason: "Fictional testing setup; not business or CPA approval" },
  } });
}
