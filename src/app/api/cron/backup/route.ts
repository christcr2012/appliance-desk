import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { exportDatabaseBackup, sendBackupFailureAlertToChris } from "@/domains/backup";
import { runMediaInventoryAndCopy } from "@/domains/backup/media";
import { prisma } from "@/lib/prisma";
import { AutomationFailure } from "@/domains/automation/failures";

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the backup.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(authHeader, expected)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let databaseBackupUrl: string | null = null;
  let databaseArtifactId: string | null = null;
  const backup = await runAutomation({
    ruleKey: "backup",
    budgetSeconds: 60,
    work: async ({ runId }) => {
      const result = await exportDatabaseBackup({ runId });
      if (!result.ok) {
        await sendBackupFailureAlertToChris(result);
        throw new AutomationFailure(result.failureCode ?? "BACKUP_CAPTURE", result.failureStage ?? "capture");
      }
      databaseBackupUrl = result.url ?? null;
      databaseArtifactId = result.artifactId ?? null;
      return {
        counts: {
          ...(result.tableCounts ?? {}),
          pruned: result.prunedCount ?? 0,
          pruneFailed: result.pruneFailed ?? 0,
          captureMs: result.captureMs ?? 0,
          bytes: result.bytes ?? 0,
        },
      };
    },
  });

  let media: Awaited<ReturnType<typeof runAutomation>> | null = null;
  if (backup.outcome === "RAN" || backup.outcome === "ALREADY_RAN") {
    // A prior daily invocation may have succeeded, failed or timed out;
    // never use a newest-file fallback when the current run did not provide its artifact.
    if (!databaseArtifactId && backup.runId) {
      const recovered = await prisma.backupArtifact.findFirst({
        where: { kind: "DATABASE", state: "VERIFIED", runId: backup.runId },
        orderBy: [{ verifiedAt: "desc" }, { id: "desc" }],
      });
      databaseArtifactId = recovered?.id ?? null;
    }
    const pairedId = databaseArtifactId;
    media = await runAutomation({
      ruleKey: "media-copy",
      budgetSeconds: 60,
      work: async () => {
        if (!pairedId) throw new AutomationFailure("BACKUP_CAPTURE", "media-pair");
        const result = await runMediaInventoryAndCopy({ databaseArtifactId: pairedId, databaseBackupUrl });
        return { counts: result.counts };
      },
    });
  }

  return NextResponse.json({ backup, media });
}
