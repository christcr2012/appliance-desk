import { NextResponse } from "next/server";
import { sendJobDayOfReminders } from "@/domains/jobs";

// Fired once a day by Vercel Cron (see vercel.json's schedule, timed for
// the morning) — texts opted-in customers with a job scheduled for
// today (Task #71, docs/DECISIONS.md 2026-09-28). Same CRON_SECRET
// bearer-token check as /api/cron/billing-reminders — see that route's
// own comment for why.
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run job reminders.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await sendJobDayOfReminders();
  return NextResponse.json(result);
}
