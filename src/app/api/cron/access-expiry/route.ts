import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { revokeEndedAccountantSessions } from "@/domains/accountant";

export const maxDuration = 60;

// ACCT-1: the nightly sweep — an accountant whose access end date has passed
// loses their sessions. Sign-in is already refused by session validation;
// this makes sure no live session lingers past the date.
export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the access-expiry sweep.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await runAutomation({
    ruleKey: "access-expiry",
    budgetSeconds: 60,
    work: async () => ({ counts: { swept: await revokeEndedAccountantSessions() } }),
  }).catch(() => ({ outcome: "FAILED" as const, runId: null }));
  return NextResponse.json({ accessExpiry: result });
}
