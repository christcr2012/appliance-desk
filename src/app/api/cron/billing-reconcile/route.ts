import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { automationCounts } from "@/domains/automation/counts";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { runPendingHandoffs } from "@/domains/jobs/completion";
import { freezeFinalInvoiceArtifacts } from "@/domains/documents/artifacts";
import { reconcileUnknownDeliveries } from "@/domains/messaging/deliver";

/** Daily recovery pass for durable provider intents. */
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
  // Batch E adds one genuinely new pass: UNKNOWN email/SMS outcomes that have
  // a provider id can be reconciled without blindly re-sending the message.
  const messageDeliveries = await runAutomation({
    ruleKey: "billing-reconcile:message-deliveries",
    work: async () => ({ counts: automationCounts(await reconcileUnknownDeliveries(50)) }),
  });

  return NextResponse.json({ providerOps, handoffs, invoiceArtifacts, messageDeliveries });
}
