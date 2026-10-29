import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { sweepSystemIssues } from "@/domains/system-issues/sources";
import { reconcileAgentOperations } from "@/domains/agent-control/operations";
import { automationCounts } from "@/domains/automation/counts";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { checkBankPaymentsInFlight } from "@/domains/billing/in-flight-check";
import { runPendingHandoffs } from "@/domains/jobs/completion";
import { freezeFinalInvoiceArtifacts } from "@/domains/documents/artifacts";
import { reconcileUnknownDeliveries } from "@/domains/messaging/deliver";
import { replayUnmatchedTwilioStatusEvents } from "@/domains/messaging/events";
import { resolvePendingRdfRecords } from "@/domains/tax/rdf-records";
import { processReadyRdfCharges } from "@/domains/tax/rdf-charges";
import { recordCrossingIfCrossed } from "@/domains/tax/rdf-threshold-evidence";
import { listPendingRdfSwitches, prepareRdfSwitches } from "@/domains/tax/rdf-switches";
import { sendOwnerAlert } from "@/domains/messaging/owner-alerts";
import { businessDateKey } from "@/lib/business-date";

/** Daily recovery pass for durable provider intents. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing billing reconciliation.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (!cronAuthorized(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const providerOps = await runAutomation({
    ruleKey: "billing-reconcile:provider-ops",
    work: async () => ({ counts: automationCounts(await finishPendingProviderOperations()) }),
  });
  // BILL-1: bank payments that are still "being confirmed" (50 a night, oldest check first).
  const bankInFlight = await runAutomation({
    ruleKey: "billing-reconcile:bank-in-flight",
    work: async () => ({ counts: automationCounts(await checkBankPaymentsInFlight()) }),
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
    work: async () => {
      // TFA-2: record the $500,000 crossing date from the crossing invoice
      // before tonight's pending records are decided against it, then prepare
      // any delivery-fee switch the app can already date for the owner.
      const crossedOn = await recordCrossingIfCrossed(new Date());
      await prepareRdfSwitches(new Date());
      const resolved = await resolvePendingRdfRecords(new Date(), 50);
      // Spec §6.3: the owner also gets an email when a switch is 30 days out
      // (the alert key makes it once per switch, however often this runs).
      const pendingSwitches = await listPendingRdfSwitches(new Date());
      for (const row of pendingSwitches) {
        await sendOwnerAlert({
          key: `rdf-switch:${row.id}`,
          subject: row.kind === "START"
            ? `Retail delivery fees start on ${businessDateKey(row.startsOn)}`
            : `Retail delivery fees stop on ${businessDateKey(row.startsOn)}`,
          text: row.kind === "START"
            ? `Retail delivery fees start on ${businessDateKey(row.startsOn)} for your delivered sales. Approve on Today so the app adds them from that day. Until you approve, the fee is owed but not billed to customers.`
            : `Retail delivery fees stop on ${businessDateKey(row.startsOn)}. Approve on Today to confirm the change.`,
          href: "/desk/today",
        });
      }
      return { counts: automationCounts({ ...resolved, crossingRecorded: crossedOn ? 1 : 0, switchAlerts: pendingSwitches.length }) };
    },
  });

  const retailDeliveryFeeCharges = await runAutomation({
    ruleKey: "billing-reconcile:retail-delivery-fee-charges",
    work: async () => ({ counts: automationCounts(await processReadyRdfCharges(30)) }),
  });

  // Purely diagnostic, private and bounded. Never retries providers or files tax.
  // Run this after business obligations so diagnostics cannot delay reconciliation.
  const systemIssues = await runAutomation({
    ruleKey: "system-issues-sweep",
    work: async () => {
      const issues = await sweepSystemIssues(new Date(), 100);
      // Readback-only: uncertain assistant operations never dispatch a second effect.
      const assistants = await reconcileAgentOperations(new Date(), 10);
      return { counts: automationCounts({ ...issues, ...assistants }) };
    },
  });
  return NextResponse.json({ systemIssues, providerOps, bankInFlight, handoffs, invoiceArtifacts, messageDeliveries, retailDeliveryFees, retailDeliveryFeeCharges });
}
