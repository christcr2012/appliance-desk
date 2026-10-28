import { businessDateKey } from "@/lib/business-date";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "@/domains/automation/runs";
import { AutomationFailure } from "@/domains/automation/failures";
import { exportDatabaseBackup } from "./index";
import { runMediaInventoryAndCopy } from "./media";

/**
 * An assistant operation uses a deterministic UUID-shaped run key because
 * runAutomation intentionally rejects all other manual-run identifiers.
 * This keeps a lost-response retry bound to the one original backup attempt.
 */
export function operationBackupRunKey(operationId: string): string {
  if (!/^c[a-z0-9]{12,80}$/i.test(operationId)) throw new Error("INVALID_OPERATION_ID");
  const hex = createHash("sha256").update("backup-manual:" + operationId).digest("hex").slice(0, 32);
  return "manual:" + [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)].join("-");
}

/** Owner-only fresh attempt, separate from the next nightly slot.
 * The shared database advisory lock serializes a manual click with backup and media cron claims.
 */
export async function retryBackupNow(actorUserId: string, operationId?: string): Promise<{
  outcome: "RAN" | "ALREADY_RAN" | "FAILED" | "PAUSED";
  runId: string | null;
}> {
  const now = new Date();
  const today = await prisma.automationRun.findFirst({
    where: { ruleKey: "backup", runKey: { startsWith: "backup:" + businessDateKey(now) } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  const retryable = today?.state === "FAILED" || today?.state === "UNKNOWN" ||
    (today?.state === "RUNNING" && now.getTime() - today.startedAt.getTime() >= today.budgetSeconds * 1000);
  if (!today || !retryable) {
    throw new Error("Manual retry is available after today's failed, expired or uncertain backup.");
  }
  return runAutomation({
    ruleKey: "backup-manual",
    // Journal-owned retries use a stable run key, so a lost response cannot start a second backup.
    runKeyOverride: operationId ? operationBackupRunKey(operationId) : "manual:" + randomUUID(),
    actorUserId,
    budgetSeconds: 180,
    work: async ({ runId }) => {
      const backup = await exportDatabaseBackup({ runId });
      if (!backup.ok || !backup.artifactId) {
        throw new AutomationFailure(backup.failureCode ?? "BACKUP_CAPTURE", backup.failureStage ?? "capture");
      }
      const media = await runMediaInventoryAndCopy({ databaseArtifactId: backup.artifactId, databaseBackupUrl: backup.url });
      return { counts: { ...(backup.tableCounts ?? {}), pruned: backup.prunedCount ?? 0,
        pruneFailed: backup.pruneFailed ?? 0, copied: media.counts.copied ?? 0 } };
    },
  });
}
