import type { Prisma } from "@prisma/client";
import { generateUniqueReferralCode } from "@/domains/referrals";

/**
 * Batch M (design D-M3). Every invoice needs a customer, so all counter sales to someone with no account belong to one
 * built-in "Walk-in sales" customer. It has no password and no login account (nobody can sign in as it), its email is on
 * the `.invalid` domain (mail can never be delivered), and it is archived so every list that skips archived customers
 * skips it. Its invoices still count in sales, tax returns and exports like any other.
 */
export const WALK_IN_EMAIL = "walk-in-sales@customers.invalid";
export const WALK_IN_NAME = "Walk-in sales";

export async function ensureWalkInCustomer(tx: Prisma.TransactionClient): Promise<{ customerId: string; userId: string }> {
  const existing = await tx.customer.findFirst({ where: { isWalkIn: true }, select: { id: true, userId: true } });
  if (existing) return { customerId: existing.id, userId: existing.userId };
  // Serialize two first sales: the partial unique index would reject the loser, so take a lock and look again.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('walk-in-customer'))::text AS locked`;
  const again = await tx.customer.findFirst({ where: { isWalkIn: true }, select: { id: true, userId: true } });
  if (again) return { customerId: again.id, userId: again.userId };
  const user = await tx.user.upsert({
    where: { email: WALK_IN_EMAIL },
    update: {},
    create: { email: WALK_IN_EMAIL, name: WALK_IN_NAME, role: "CUSTOMER", emailVerified: false, archivedAt: new Date() },
    select: { id: true },
  });
  const customer = await tx.customer.create({
    data: {
      userId: user.id,
      isWalkIn: true,
      archivedAt: new Date(),
      referralCode: await generateUniqueReferralCode(tx),
    },
    select: { id: true },
  });
  return { customerId: customer.id, userId: user.id };
}
