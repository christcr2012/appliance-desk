import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { applyTaxRateChanges } from "@/domains/tax/rate-changes";
import { runTaxFilingCalendar } from "@/domains/tax/filing-reminders";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run tax automations.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // A failed/paused tax-rate run must not suppress tax filing reminders, or vice versa.
  const [rates, filing] = await Promise.allSettled([
    runAutomation({
      ruleKey: "tax-rate-changes",
      work: async () => ({ counts: await applyTaxRateChanges() }),
    }),
    runAutomation({
      ruleKey: "tax-filing-calendar",
      work: async () => ({ counts: await runTaxFilingCalendar() }),
    }),
  ]);
  const result = (value: typeof rates) => value.status === "fulfilled"
    ? value.value
    : { outcome: "FAILED" as const, runId: null };
  return NextResponse.json({ rates: result(rates), filing: result(filing) });
}
