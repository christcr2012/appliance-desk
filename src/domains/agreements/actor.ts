import type { Prisma } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockRentalAgreementInTx } from "./index";

export const POLICY_ROLES = ["OWNER", "ADMIN"] as const;

/**
 * Who is acting. Staff (owner/admin) can act on any agreement; a customer can
 * act only on their own. Both are re-checked inside the same transaction as
 * the change, so a deactivated account cannot slip an action in.
 */
export type TermActor = { userId: string; kind: "team" | "customer" };

export async function lockAgreementForActor(
  tx: Prisma.TransactionClient,
  actor: TermActor,
  agreementId: string,
) {
  if (actor.kind === "team") {
    await assertActiveTeamActor(tx, actor.userId, POLICY_ROLES);
    return lockRentalAgreementInTx(tx, agreementId);
  }
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { role: true, archivedAt: true },
  });
  if (!user || user.archivedAt || user.role !== "CUSTOMER") {
    throw new Error("This account no longer has access to make that change.");
  }
  const agreement = await lockRentalAgreementInTx(tx, agreementId);
  const customer = await tx.customer.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  // Same message as a missing agreement, so another customer's id reveals nothing.
  if (!customer || customer.id !== agreement.customerId) {
    throw new Error("Couldn't find that rental agreement.");
  }
  return agreement;
}
