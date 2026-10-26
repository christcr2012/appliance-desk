import type { Prisma } from "@prisma/client";
import { leadContactKeys } from "./keys";

/**
 * LD-1: duplicate detection at lead creation. A match is another live lead
 * (not merged, not converted) or an existing customer with the same phone
 * (at least 7 digits — shorter strings are not a real number) or email.
 * The lead is always created; a match only flags it (or is audited).
 */
export async function findPossibleDuplicateInTx(
  tx: Prisma.TransactionClient,
  keys: { phoneDigits: string | null; emailLower: string | null },
): Promise<{ leadId: string | null; customerId: string | null }> {
  const phone = keys.phoneDigits && keys.phoneDigits.length >= 7 ? keys.phoneDigits : null;
  const email = keys.emailLower;
  if (!phone && !email) return { leadId: null, customerId: null };

  const or: Prisma.LeadWhereInput[] = [];
  if (phone) or.push({ phoneDigits: phone });
  if (email) or.push({ emailLower: email });
  const lead = await tx.lead.findFirst({
    where: { mergedIntoLeadId: null, status: { not: "CONVERTED" }, OR: or },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (lead) return { leadId: lead.id, customerId: null };

  // Customers keep a plain phone string, so the digits comparison is one
  // raw query; the email comparison is a case-insensitive Prisma query.
  const byPhone = phone
    ? await tx.$queryRaw<{ id: string; createdAt: Date }[]>`
        SELECT "id", "createdAt" FROM "Customer"
        WHERE NULLIF(regexp_replace("phone", '\\D', '', 'g'), '') = ${phone}
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
      `
    : [];
  const byEmail = email
    ? await tx.customer.findFirst({
        where: { user: { email: { equals: email, mode: "insensitive" } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, createdAt: true },
      })
    : null;
  const match = [byPhone[0], byEmail].filter(
    (m): m is { id: string; createdAt: Date } => Boolean(m),
  ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))[0];
  return { leadId: null, customerId: match?.id ?? null };
}

/** The duplicate check for one create, from the raw phone/email just typed. */
export async function findDuplicateForNewLeadInTx(
  tx: Prisma.TransactionClient,
  input: { phone?: string | null; email?: string | null },
): Promise<{ leadId: string | null; customerId: string | null }> {
  return findPossibleDuplicateInTx(tx, leadContactKeys(input));
}
