import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { runEmergencyReminders } from "@/domains/vault/emergency";

export const maxDuration = 60;

// VAULT-2: while an emergency-access request is waiting, remind the owner by
// email and text halfway through the wait and again one day before it ends.
// Does nothing when emergency access is switched off (its shipped state).
export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the emergency-access reminders.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await runAutomation({
    ruleKey: "emergency-access",
    budgetSeconds: 60,
    work: async () => ({ counts: await runEmergencyReminders() }),
  }).catch(() => ({ outcome: "FAILED" as const, runId: null }));
  return NextResponse.json({ emergencyAccess: result });
}
