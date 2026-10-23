import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { eraseExpiredTenantPII } from "@/domains/customers/location-contacts";
export const maxDuration = 60;
/** Scheduled erasure of ended tenant identities; never a communication job. */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 500 });
  if (!cronAuthorized(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const result = await runAutomation({
    ruleKey: "tenant-retention",
    budgetSeconds: 60,
    work: async () => ({ counts: { erased: await eraseExpiredTenantPII() } }),
  });
  return NextResponse.json(result);
}
