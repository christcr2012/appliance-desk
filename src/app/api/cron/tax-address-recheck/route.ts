import { NextResponse } from "next/server";

import { runAutomation } from "@/domains/automation/runs";
import { recheckCurrentTaxAddresses } from "@/domains/tax/address-recheck";
import { runOfficialSourceWatch } from "@/domains/tax/official-source-watch";

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

  const [addressRecheck, taxRateWatch] = await Promise.all([
    runAutomation({
      ruleKey: "tax-address-recheck",
      work: async () => {
        const result = await recheckCurrentTaxAddresses();
        return {
          counts: {
            due: result.due ? 1 : 0,
            automaticSourceAvailable: result.automaticSourceAvailable ? 1 : 0,
            checked: result.checked,
            changed: result.changed,
            needsReview: result.needsReview,
          },
        };
      },
    }),
    runAutomation({
      ruleKey: "tax-rate-watch",
      work: async () => ({
        counts: await runOfficialSourceWatch(),
      }),
    }),
  ]);

  return NextResponse.json({ addressRecheck, taxRateWatch });
}
