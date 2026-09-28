import { NextResponse } from "next/server";
import { sendUpcomingBillingReminders } from "@/domains/billing";

// Fired once a day by Vercel Cron (see vercel.json's schedule) — sends
// "your payment is coming up" emails (Task #67, docs/DECISIONS.md
// 2026-09-28 "Automation rules"). Vercel signs every cron request with
// this same secret as a bearer token, so a request without it is
// refused — otherwise anyone who found this URL could trigger it (it's
// harmless to run twice in the same day since the domain layer already
// dedupes per billing cycle, but there's no reason to leave it open).
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run billing reminders.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await sendUpcomingBillingReminders();
  return NextResponse.json(result);
}
