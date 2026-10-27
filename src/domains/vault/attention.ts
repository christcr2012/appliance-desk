import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { rotationState } from "./rules";

/**
 * VAULT-2: password-rotation To dos (spec §6 — only for logins that carry a
 * rotation schedule). Owner-only data: the exceptions index calls this only
 * for the OWNER, like the other owner-gated sources, and no secret or
 * ciphertext is ever read — titles and dates only.
 */
export async function listVaultRotationAttention(now = new Date()): Promise<ExceptionItem[]> {
  const rows = await prisma.vaultCredential.findMany({
    where: { rotateEveryMonths: { not: null } },
    select: { id: true, title: true, lastRotatedOn: true, createdAt: true, rotateEveryMonths: true },
    orderBy: { title: "asc" },
  });
  const items: ExceptionItem[] = [];
  for (const row of rows) {
    const rotation = rotationState(row, now);
    if (!rotation?.overdue) continue;
    items.push({
      category: "VAULT",
      severity: "low",
      title: `Change the password for ${row.title}`,
      detail: `It was last changed ${row.lastRotatedOn ? businessDateKey(row.lastRotatedOn) : "when it was added"}, and it is set to change every ${row.rotateEveryMonths} months.`,
      href: `/desk/vault/${row.id}`,
      since: now,
    });
  }
  return items;
}
