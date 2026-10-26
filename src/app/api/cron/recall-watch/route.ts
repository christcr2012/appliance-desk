import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { runRecallWatch } from "@/domains/recalls/watch";

export const maxDuration = 60;

// OPS-1: reads the government's public recall list and records POSSIBLE matches for Chris. Read only; it never
// confirms a recall, holds a machine or contacts anyone.
export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the recall check.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await runAutomation({
    ruleKey: "recall-watch",
    budgetSeconds: 60,
    work: async () => ({ counts: await runRecallWatch() }),
  }).catch(() => ({ outcome: "FAILED" as const, runId: null }));
  return NextResponse.json({ recalls: result });
}
