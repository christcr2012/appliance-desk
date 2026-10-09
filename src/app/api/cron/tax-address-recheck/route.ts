import { NextResponse } from "next/server";

import { runAutomation } from "@/domains/automation/runs";
import { recheckCurrentTaxAddresses } from "@/domains/tax/address-recheck";
import { runOfficialRateObservation } from "@/domains/tax/official-rate-auto-apply";
import { runOfficialSourceWatch } from "@/domains/tax/official-source-watch";
import { recalculatePendingPurchaseTax } from "@/domains/tax/purchase-tax-catch-up";

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

  const [addressRecheck, taxRateWatch, purchaseTaxCatchUp] = await Promise.all([
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
      work: async () => {
        const [sources, rates] = await Promise.all([
          runOfficialSourceWatch(),
          runOfficialRateObservation(),
        ]);
        return {
          counts: {
            sourceChecked: sources.checked,
            sourceChanged: sources.changed,
            sourceRecovered: sources.recovered,
            sourceFailed: sources.failed,
            rateObservations: rates.observations,
            rateAutoApplied: rates.autoApplied,
            rateReviewRequired: rates.reviewRequired,
            rateIgnored: rates.ignored,
            rateProviderSupported: rates.status === "SUPPORTED" ? 1 : 0,
            rateProviderUnavailable: rates.status === "UNAVAILABLE" ? 1 : 0,
            rateProviderUnsupported: rates.status === "UNSUPPORTED" ? 1 : 0,
          },
        };
      },
    }),
    runAutomation({
      ruleKey: "tax-address-recheck:purchase-tax-catch-up",
      work: async () => ({ counts: await recalculatePendingPurchaseTax(new Date(), 200) }),
    }),
  ]);

  return NextResponse.json({ addressRecheck, taxRateWatch, purchaseTaxCatchUp });
}
