import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "@/domains/automation/runs";
import { AutomationFailure } from "@/domains/automation/failures";
import { exportDatabaseBackup } from "./index";
import { runMediaInventoryAndCopy } from "./media";

/** Owner-only fresh attempt, separate from the next nightly slot.
 * The shared database advisory lock serializes a manual click with backup and media cron claims.
 */
export async function retryBackupNow(actorUserId: string): Promise<{
  outcome: "RAN" | "ALREADY_RAN" | "FAILED" | "PAUSED";
  runId: string | null;
}> {
  const latest = await prisma.automationRun.findFirst({
    where: { ruleKey: "backup", state: { in: ["FAILED", "UNKNOWN"] } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  const today = await prisma.automationRun.findFirst({
    where: { ruleKey: "backup", runKey: { startsWith: `backup:${new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date())}` } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  if (!today || !["FAILED", "UNKNOWN"].includes(today.state) || latest?.id !== today.id) {
    throw new Error("Manual retry is available after today's failed or uncertain backup.");
  }
  return runAutomation({
    ruleKey: "backup-manual",
    runKeyOverride: "manual:" + randomUUID(),
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
