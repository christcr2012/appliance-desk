import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { exportDatabaseBackup, sendBackupFailureAlertToChris } from "@/domains/backup";

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the backup.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const outcome = await runAutomation({
    ruleKey: "backup",
    budgetSeconds: 60,
    work: async () => {
      const result = await exportDatabaseBackup();
      if (!result.ok) {
        await sendBackupFailureAlertToChris(result);
        throw new Error(result.error ?? "Database backup failed.");
      }
      return {
        counts: {
          ...(result.tableCounts ?? {}),
          pruned: result.prunedCount ?? 0,
        },
      };
    },
  });
  return NextResponse.json(outcome);
}
