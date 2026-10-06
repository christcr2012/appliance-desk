import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { exportDatabaseBackup, sendBackupFailureAlertToChris } from "@/domains/backup";
import { runMediaInventoryAndCopy, verifyMediaRecoverySample } from "../../../../../scripts/media-inventory";

export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the backup.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let databaseBackupUrl: string | null = null;
  const backup = await runAutomation({
    ruleKey: "backup",
    budgetSeconds: 60,
    work: async () => {
      const result = await exportDatabaseBackup();
      if (!result.ok) {
        await sendBackupFailureAlertToChris(result);
        throw new Error(result.error ?? "Database backup failed.");
      }
      databaseBackupUrl = result.url ?? null;
      return {
        counts: {
          ...(result.tableCounts ?? {}),
          pruned: result.prunedCount ?? 0,
        },
      };
    },
  });

  let media: Awaited<ReturnType<typeof runAutomation>> | null = null;
  if (backup.outcome === "RAN" || backup.outcome === "ALREADY_RAN") {
    media = await runAutomation({
      ruleKey: "media-copy",
      budgetSeconds: 240,
      work: async () => {
        const result = await runMediaInventoryAndCopy({ databaseBackupUrl });
        const verification = await verifyMediaRecoverySample(result.manifestUrl, 3);
        return {
          counts: {
            ...result.counts,
            verifiedRecoverySamples: verification.checked,
            verificationTombstonesSkipped: verification.skippedTombstoned,
          },
        };
      },
    });
  }

  return NextResponse.json({ backup, media });
}
