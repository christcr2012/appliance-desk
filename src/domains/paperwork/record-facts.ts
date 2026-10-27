import { prisma } from "@/lib/prisma";

/**
 * Presence facts about business records for the setup guide (SETUP-1).
 *
 * This module is deliberately light — prisma only — because the setup guide
 * is imported by the To-do (exceptions) chain, which must never pull the
 * file-storage/blob chain in. It is also the one place outside records.ts
 * that names the encrypted-number column: the guide needs to know whether a
 * record HAS a saved number, never the number itself (VAULT-2 grep rule —
 * the secret column names live only in the paperwork and vault domains).
 */
export type SetupRecordFact = {
  id: string;
  hasNumber: boolean;
  fileCount: number;
  hasBeenDone: boolean;
};

export async function getSetupRecordFacts(templateKeys: string[]): Promise<Map<string, SetupRecordFact>> {
  if (templateKeys.length === 0) return new Map();
  const rows = await prisma.businessPaperwork.findMany({
    where: { templateKey: { in: templateKeys } },
    select: {
      id: true,
      templateKey: true,
      numberEncrypted: true,
      lastDoneOn: true,
      _count: { select: { recordFiles: { where: { deletedAt: null } } } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.templateKey as string,
      {
        id: r.id,
        hasNumber: r.numberEncrypted != null,
        fileCount: r._count.recordFiles,
        hasBeenDone: r.lastDoneOn != null,
      },
    ]),
  );
}
