import { createHash } from "node:crypto";
import type { sendEmail, EmailResult } from "@/lib/email";
import { deliverMessage } from "@/domains/messaging/deliver";

function compatibilityKey(input: Parameters<typeof sendEmail>[0]): string {
  if (input.idempotencyKey?.trim()) return input.idempotencyKey;
  const digest = createHash("sha256")
    .update(JSON.stringify({
      to: input.to.trim().toLowerCase(),
      subject: input.subject,
      text: input.text,
      actionLabel: input.actionLabel ?? null,
      replyTo: input.replyTo ?? null,
      marketing: input.marketing ?? null,
    }))
    .digest("hex");
  return `customer-email-${digest}`;
}

/**
 * Compatibility adapter for customer-email call sites while Batch E moves each
 * domain to deliverMessage directly. The durable boundary now owns the master
 * customer-email switch, preview safety, suppression, idempotency and provider
 * outcome semantics. Account verification/password email does not use this
 * adapter and remains a direct low-level security email by design.
 */
export async function sendCustomerEmail(
  input: Parameters<typeof sendEmail>[0],
): Promise<EmailResult> {
  const delivery = await deliverMessage({
    idempotencyKey: compatibilityKey(input),
    channel: "EMAIL",
    purpose: input.marketing ? "MARKETING" : "TRANSACTIONAL",
    templateKey: "customer-email-compat",
    customerFacing: true,
    recipient: { type: "Customer", address: input.to },
    render: () => ({
      subject: input.subject,
      text: input.text,
      actionLabel: input.actionLabel,
      marketing: input.marketing,
    }),
  });

  if (delivery.state === "ACCEPTED" || delivery.state === "DELIVERED") {
    return {
      sent: true,
      outcome: "SENT",
      ...(delivery.providerMessageId ? { providerMessageId: delivery.providerMessageId } : {}),
    };
  }
  if (delivery.state === "NOT_SENT" || delivery.state === "SUPPRESSED") {
    return { sent: false, outcome: "NOT_ATTEMPTED" };
  }
  if (delivery.state === "UNKNOWN" || delivery.state === "PENDING") {
    return { sent: false, outcome: "UNKNOWN" };
  }
  return { sent: false, outcome: "REJECTED" };
}
