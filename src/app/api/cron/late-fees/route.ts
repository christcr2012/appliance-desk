import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { runLateFees, billPendingLateFees, sendLateFeeDigestToChris } from "@/domains/billing";

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run late-fee automation.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(authHeader, expected)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  return NextResponse.json(await runAutomation({
    ruleKey: "late-fees",
    work: async () => {
      // FEE-1: warn first, record fees only for warned customers, then put recorded fees on the next bill.
      const { counts, recorded } = await runLateFees();
      const billed = await billPendingLateFees();
      await sendLateFeeDigestToChris(recorded);
      return { counts: { ...counts, ...billed } };
    },
  }));
}
