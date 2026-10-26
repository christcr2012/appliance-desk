// FEE-1: the old "add the fee to the overdue bill" code is gone. The engine is late-fee-engine.ts; this file keeps the
// short note to Chris about fees that were recorded tonight.
import { deliverMessage } from "@/domains/messaging/deliver";
import { formatCents } from "@/domains/pricing";
import { getBusinessSettings } from "@/domains/settings";
import { businessDateKey } from "@/lib/business-date";
import type { RecordedLateFee } from "./late-fee-engine";

export type LateFeeApplication = RecordedLateFee;

export async function sendLateFeeDigestToChris(applications: RecordedLateFee[]): Promise<void> {
  if (applications.length === 0) return;

  const settings = await getBusinessSettings();
  const notifyTo = process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;
  const day = businessDateKey(new Date());
  const lines = applications
    .map((application) => `#${application.invoiceNumber} — ${application.customerName}: ${formatCents(application.feeCents)}`)
    .join("\n");

  const result = await deliverMessage({
    idempotencyKey: `late-fee-digest-${day}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "late-fee-digest",
    customerFacing: false,
    recipient: { type: "Staff", address: notifyTo },
    subject: { type: "LateFeeDigest", id: day },
    render: () => ({
      subject: `Late fees recorded for ${applications.length} bill${applications.length === 1 ? "" : "s"}`,
      text: `These customers were warned about a late fee and did not pay. The fee is recorded as its own charge and goes on their next bill (the late bill itself did not change):\n\n${lines}\n\nYou can waive any of them with a reason before or after it is billed.`,
    }),
  });
  if (!["ACCEPTED", "DELIVERED", "NOT_SENT"].includes(result.state)) {
    console.error("[billing] Late-fee digest delivery needs attention", result.deliveryId, result.state);
  }
}
