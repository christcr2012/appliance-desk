import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { sendUpcomingBillingReminders } from "@/domains/billing";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run billing reminders.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  return NextResponse.json(await runAutomation({
    ruleKey: "billing-reminders",
    work: async () => ({ counts: await sendUpcomingBillingReminders() }),
  }));
}
