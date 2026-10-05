import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { automationCounts } from "@/domains/automation/counts";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { runPendingHandoffs } from "@/domains/jobs/completion";
import { freezeFinalInvoiceArtifacts } from "@/domains/documents/artifacts";

/** Daily recovery pass for durable Stripe/provider intents. */
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing billing reconciliation.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Post-D drift check: these are the three real passes in this route. Do not
  // recreate the obsolete design-only `subscription-ends` pass.
  const providerOps = await runAutomation({
    ruleKey: "billing-reconcile:provider-ops",
    work: async () => ({ counts: automationCounts(await finishPendingProviderOperations()) }),
  });
  const handoffs = await runAutomation({
    ruleKey: "billing-reconcile:job-handoffs",
    work: async () => ({ counts: automationCounts(await runPendingHandoffs()) }),
  });
  const invoiceArtifacts = await runAutomation({
    ruleKey: "billing-reconcile:invoice-artifacts",
    work: async () => ({ counts: automationCounts(await freezeFinalInvoiceArtifacts(200)) }),
  });

  return NextResponse.json({ providerOps, handoffs, invoiceArtifacts });
}
