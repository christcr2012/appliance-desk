import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { sweepSystemIssues } from "@/domains/system-issues/sources";
import { automationCounts } from "@/domains/automation/counts";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { runPendingHandoffs } from "@/domains/jobs/completion";
import { freezeFinalInvoiceArtifacts } from "@/domains/documents/artifacts";
import { reconcileUnknownDeliveries } from "@/domains/messaging/deliver";
import { replayUnmatchedTwilioStatusEvents } from "@/domains/messaging/events";
import { resolvePendingRdfRecords } from "@/domains/tax/rdf-records";
import { processReadyRdfCharges } from "@/domains/tax/rdf-charges";

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
    work: async () => {
      const before = await replayUnmatchedTwilioStatusEvents(50);
      const reconciled = await reconcileUnknownDeliveries(50);
      const after = await replayUnmatchedTwilioStatusEvents(50);
      return { counts: automationCounts({
        ...reconciled,
        matched: before.matched + after.matched,
        pending: after.pending,
      }) };
    },
  });

  const retailDeliveryFees = await runAutomation({
    ruleKey: "billing-reconcile:retail-delivery-fees",
    work: async () => ({ counts: automationCounts(await resolvePendingRdfRecords(new Date(), 50)) }),
  });

  const retailDeliveryFeeCharges = await runAutomation({
    ruleKey: "billing-reconcile:retail-delivery-fee-charges",
    work: async () => ({ counts: automationCounts(await processReadyRdfCharges(30)) }),
  });

  // Purely diagnostic, private and bounded. Never retries providers or files tax.
  // Run this after business obligations so diagnostics cannot delay reconciliation.
  const systemIssues = await runAutomation({
    ruleKey: "system-issues-sweep",
    work: async () => ({ counts: automationCounts(await sweepSystemIssues(new Date(), 100)) }),
  });
  return NextResponse.json({ systemIssues, providerOps, handoffs, invoiceArtifacts, messageDeliveries, retailDeliveryFees, retailDeliveryFeeCharges });
}
