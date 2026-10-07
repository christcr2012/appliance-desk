import { NextResponse } from "next/server";

import { runAutomation } from "@/domains/automation/runs";
import { applyTaxRateChanges } from "@/domains/tax/rate-changes";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run tax-rate changes.",
    );
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json(
    await runAutomation({
      ruleKey: "tax-rate-changes",
      work: async () => ({ counts: await applyTaxRateChanges() }),
    }),
  );
}
