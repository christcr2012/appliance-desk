import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { sendEstimateFollowUpReminders } from "@/domains/estimates";

// Fired once a day by Vercel Cron (see vercel.json). The automation ledger
// claims the Colorado business-day slot before work starts, so two invocations
// cannot silently run the same pass twice. The estimate domain keeps its own
// per-estimate send-cycle claim as a second, business-level dedupe boundary.
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

  const result = await runAutomation({
    ruleKey: "estimate-follow-ups",
    work: async () => ({ counts: await sendEstimateFollowUpReminders() }),
  });
  return NextResponse.json(result);
}
