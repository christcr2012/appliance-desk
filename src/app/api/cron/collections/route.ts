import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { runCollectionsPass } from "@/domains/collections/engine";

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the collections pass.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(request.headers.get("authorization"), expected)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  // OPS-6: only prepares drafts and To do items for Chris. It never sends anything to a customer.
  return NextResponse.json(await runAutomation({
    ruleKey: "collections",
    work: async () => ({ counts: { ...(await runCollectionsPass()) } }),
  }));
}
