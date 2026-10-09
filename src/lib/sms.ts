import twilio from "twilio";
import { isLegacySmsDispatchEnabled } from "@/domains/messaging/sms-activation";

export type SmsOutcome = "SENT" | "NOT_ATTEMPTED" | "REJECTED" | "UNKNOWN";
export type SmsResult = {
  sent: boolean;
  outcome: SmsOutcome;
  providerMessageId?: string;
};

/**
 * Low-level Twilio sender. Domain code records durable intent in MessageDelivery
 * before calling this function. Missing configuration and preview deployments are
 * deliberate NOT_ATTEMPTED outcomes; a clear provider 4xx is REJECTED; network,
 * timeout and server failures are UNKNOWN because Twilio may have accepted the
 * message before the response was lost.
 */
export async function sendSms(input: {
  to: string;
  body: string;
  idempotencyKey?: string;
}): Promise<SmsResult> {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production" ||
      !await isLegacySmsDispatchEnabled()) {
    return { sent: false, outcome: "NOT_ATTEMPTED" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.log("[sms] Twilio is not fully configured — skipping send.");
    return { sent: false, outcome: "NOT_ATTEMPTED" };
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    const message = await twilio(accountSid, authToken).messages.create({
      to: input.to,
      from,
      body: input.body,
      ...(appUrl ? { statusCallback: `${appUrl}/api/webhooks/twilio` } : {}),
    });
    return {
      sent: true,
      outcome: "SENT",
      providerMessageId: message.sid,
    };
  } catch (error) {
    console.error("[sms] Provider send failed", error instanceof Error ? error.name : "unknown");
    const status = (error as { status?: number | null } | null)?.status;
    const rejected = typeof status === "number" && status >= 400 && status < 500;
    return { sent: false, outcome: rejected ? "REJECTED" : "UNKNOWN" };
  }
}

export type SmsProviderState = "ACCEPTED" | "DELIVERED" | "FAILED" | "UNKNOWN";

/** Small-volume reconciliation fallback for UNKNOWN MessageDelivery rows. */
export async function getSmsProviderState(messageSid: string): Promise<SmsProviderState> {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") return "UNKNOWN";
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return "UNKNOWN";

  try {
    const message = await twilio(accountSid, authToken).messages(messageSid).fetch();
    switch (message.status) {
      case "delivered":
      case "read":
        return "DELIVERED";
      case "failed":
      case "undelivered":
      case "canceled":
        return "FAILED";
      case "accepted":
      case "scheduled":
      case "queued":
      case "sending":
      case "sent":
        return "ACCEPTED";
      default:
        return "UNKNOWN";
    }
  } catch {
    return "UNKNOWN";
  }
}
