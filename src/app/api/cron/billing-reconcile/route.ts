import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { automationCounts } from "@/domains/automation/counts";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { runPendingHandoffs } from "@/domains/jobs/completion";
import { freezeFinalInvoiceArtifacts } from "@/domains/documents/artifacts";
import { reconcileUnknownDeliveries } from "@/domains/messaging/deliver";
import { resolvePendingRdfRecords } from "@/domains/tax/rdf-records";

/** Daily recovery pass for durable provider intents. */
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set â€” refusing billing reconciliation.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const providerOps = await runAutomation({
    ruleKey: "billing-reconcile:provider-ops",
    work: async () => ({ counts: automationCounts(await finishPendingProviderOperations()) }),
  });
  const handoffs = await runAutomation({
    ruleKey: "billing-reconcile:job-handoffs",
    work: async () => ({ counts: automationCounts(await runPendingHandoffs()) }),
  });
  const invoiceArtifacts = await runAutomation({
  ¶»§q«^