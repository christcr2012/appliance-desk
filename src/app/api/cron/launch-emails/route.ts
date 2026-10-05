import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { sendLaunchSequence } from "@/domains/launch";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runAutomation({
    ruleKey: "launch-emails",
    work: async () => {
      const result = await sendLaunchSequence();
      return { counts: { sent: result.sent, failed: result.failed, blocked: result.blocked ? 1 : 0 } };
    },
  }));
}
