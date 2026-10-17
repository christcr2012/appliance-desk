import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getUnsignedFollowUpDays } from "@/domains/agreements/unsigned-follow-up";
import type { ExceptionItem } from "./rules";

const DAY = 86_400_000;

/**
 * Agreements sent for signature that have waited longer than the owner's setting (starting at 3 days).
 * Clears by itself when the customer signs or the agreement is cancelled. Read-only; nothing is sent to the customer.
 */
export async function listUnsignedAgreements(limit: number, now: Date): Promise<{ rows: ExceptionItem[]; total: number }> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
  const days = await getUnsignedFollowUpDays();
  const cutoff = new Date(now.getTime() - days * DAY);
  const where = { status: "AWAITING_SIGNATURE" as const, signature: { is: { signedAt: null, createdAt: { lte: cutoff } } } };
  const rows = await prisma.rentalAgreement.findMany({
    where, select: { id: true, signature: { select: { createdAt: true } },
      customer: { select: { user: { select: { name: true, email: true } } } } },
    orderBy: [{ id: "asc" }], take: 200,
  });
  const sorted = rows
    .map((a) => ({ a, sent: (a.signature as { createdAt: Date }).createdAt }))
    .sort((x, y) => x.sent.getTime() - y.sent.getTime() || x.a.id.localeCompare(y.a.id));
  return {
    rows: sorted.slice(0, limit).map(({ a, sent }): ExceptionItem => {
      const name = a.customer.user.name ?? a.customer.user.email;
      return {
        category: "UNSIGNED_AGREEMENT", severity: "medium",
        title: "Follow up: " + name + " hasn't signed",
        detail: "The agreement was sent for signature and has waited " + Math.max(days, Math.floor((now.getTime() - sent.getTime()) / DAY)) +
          " days. Contact the customer; nothing is sent automatically.",
        href: "/desk/agreements/" + encodeURIComponent(a.id), since: sent,
      };
    }),
    total: sorted.length,
  };
}
