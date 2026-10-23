import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { applyDueScheduledPriceChanges } from "@/domains/pricing/scheduled";

// Fired once a day by Vercel Cron (see vercel.json), after Colorado midnight in both summer and winter time. The
// automation ledger claims the Colorado business-day slot first, and every change is applied under a row lock, so a
// second invocation cannot apply a price twice.
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to apply scheduled price changes.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await runAutomation({
    ruleKey: "scheduled-prices",
    work: async () => {
      const counts = await applyDueScheduledPriceChanges();
      // Changes that were applied stay applied; the failure shows up in the system issues inbox so someone looks.
      if (counts.failed > 0) {
        throw new Error(`${counts.failed} scheduled price change(s) could not be applied. Open Settings → Price changes to see why.`);
      }
      return { counts };
    },
  });
  return NextResponse.json(result);
}
