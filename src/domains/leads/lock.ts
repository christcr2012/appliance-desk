import type { Prisma } from "@prisma/client";

/**
 * LD-1: lock a lead row for writing and refuse a lead that was merged away.
 * Every lead write takes this lock first, so two sessions racing on the same
 * lead serialize, and a write that started from a stale page (the lead was
 * merged in another session) is refused instead of writing to a dead lead.
 */
export async function lockLiveLeadInTx(
  tx: Prisma.TransactionClient,
  leadId: string,
): Promise<{
  id: string;
  status: string;
  contactName: string;
  assignedToUserId: string | null;
  nextFollowUpOn: Date | null;
  version: number;
}> {
  const locked = await tx.$queryRaw<
    {
      id: string;
      status: string;
      contactName: string;
      assignedToUserId: string | null;
      mergedIntoLeadId: string | null;
      nextFollowUpOn: Date | null;
      version: number;
    }[]
  >`
    SELECT "id", "status", "contactName", "assignedToUserId", "mergedIntoLeadId", "nextFollowUpOn", "version"
    FROM "Lead" WHERE "id" = ${leadId} FOR UPDATE
  `;
  if (locked.length !== 1) throw new Error("That lead no longer exists.");
  const lead = locked[0]!;
  if (lead.mergedIntoLeadId) {
    const target = await tx.lead.findUnique({
      where: { id: lead.mergedIntoLeadId },
      select: { contactName: true },
    });
    throw new Error(
      `This lead was merged into ${target?.contactName ?? "another lead"}. Open that lead instead.`,
    );
  }
  return {
    id: lead.id,
    status: lead.status,
    contactName: lead.contactName,
    assignedToUserId: lead.assignedToUserId,
    nextFollowUpOn: lead.nextFollowUpOn,
    version: lead.version,
  };
}
