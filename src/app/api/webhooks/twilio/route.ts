import { NextResponse } from "next/server";
import twilio from "twilio";
import {
  processVerifiedTwilioStatusEvent,
  processVerifiedTwilioStop,
} from "@/domains/messaging/events";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

function formObject(form: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) values[key] = value;
  return values;
}

/** Twilio signs the exact callback URL plus form values. We parse only the
 * form representation needed by Twilio's validator; no business interpretation
 * or database write happens until the signature is valid. */
export async function POST(request: Request): Promise<Response> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN is not set — refusing Twilio webhook.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing x-twilio-signature header" }, { status: 400 });
  }

  const raw = await request.text();
  const form = new URLSearchParams(raw);
  const params = formObject(form);
  if (!twilio.validateRequest(authToken, signature, request.url, params)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const messageSid = form.get("MessageSid")?.trim() || null;
  const body = form.get("Body")?.trim() || "";
  const from = form.get("From")?.trim() || null;
  const keyword = body.toUpperCase();

  try {
    if (messageSid && from && STOP_KEYWORDS.has(keyword)) {
      const result = await processVerifiedTwilioStop({
        eventId: messageSid,
        from,
        keyword,
      });
      return NextResponse.json({ received: true, duplicate: result.duplicate });
    }

    const status = form.get("MessageStatus")?.trim() || null;
    if (messageSid && status) {
      const result = await processVerifiedTwilioStatusEvent({
        eventId: `${messageSid}:${status.toLowerCase()}`,
        messageSid,
        status,
        errorCode: form.get("ErrorCode")?.trim() || null,
      });
      return NextResponse.json({ received: true, duplicate: result.duplicate });
    }

    // Valid Twilio traffic that is not one of the callbacks this application
    // consumes is acknowledged without inventing state.
    return NextResponse.json({ received: true, ignored: true });
  } catch (error) {
    console.error("Failed to process verified Twilio webhook", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Internal error processing event" }, { status: 500 });
  }
}
