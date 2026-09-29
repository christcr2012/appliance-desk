import { NextResponse } from "next/server";
import { sendEstimateFollowUpReminders } from "@/domains/estimates";

// Fired once a day by Vercel Cron (see vercel.json's schedule) — sends a
// single "still interested?" follow-up on any estimate that's been sent
// but not responded to for a few days (2026-09-29, see
// docs/ROADMAP.md's "Automatic follow-up on a sent-but-unanswered
// estimate" entry). Same secret-bearer-token guard as this app's other
// cron routes (src/app/api/cron/billing-reminders is the model this
// copies) — harmless to run twice in a day since the domain layer
// already dedupes per send-cycle, but no reason to leave it open.
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run estimate follow-ups.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await sendEstimateFollowUpReminders();
  return NextResponse.json(result);
}
