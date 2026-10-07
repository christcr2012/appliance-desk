import { NextResponse } from "next/server";

import { runAutomation } from "@/domains/automation/runs";
import { recheckCurrentTaxAddresses } from "@/domains/tax/address-recheck";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run tax-address re-check.",
    );
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json(
    await runAutomation({
      ruleKey: "tax-address-recheck",
      work: async () => ({
        counts: await recheckCurrentTaxAddresses(),
      }),
    }),
  );
}
