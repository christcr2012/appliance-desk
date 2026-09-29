import { NextResponse } from "next/server";
import { exportDatabaseBackup, sendBackupFailureAlertToChris } from "@/domains/backup";

// Reads every row of every business table, so it needs more headroom
// than the other cron routes (which each touch a handful of records).
// 60s is well within what every Vercel plan allows and comfortably
// covers this business's current data size, with room to grow.
export const maxDuration = 60;

// Fired once a day by Vercel Cron (see vercel.json's schedule) — an
// independent daily export of every business-critical table to Vercel
// Blob, on top of Neon's own 6-hour point-in-time recovery window (Task
// flagged by the 2026-09-29 audit, docs/ROADMAP.md). Same CRON_SECRET
// bearer-token check as the other cron routes.
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the backup.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await exportDatabaseBackup();
  await sendBackupFailureAlertToChris(result);

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
