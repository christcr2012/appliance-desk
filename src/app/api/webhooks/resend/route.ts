import { NextResponse } from "next/server";
import { Resend } from "resend";
import { processVerifiedResendEvent } from "@/domains/messaging/events";

/** Resend signs the exact raw body with Svix headers. No payload is read or
 * logged when the secret is absent, and semantic processing happens only after
 * verification succeeds. */
export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("RESEND_WEBHOOK_SECRET is not set — refusing Resend webhook.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 400 });
  }

  const payload = await request.text();
  let verified: unknown;
  try {
    verified = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await processVerifiedResendEvent(
      id,
      verified as {
        type: string;
        data?: {
          email_id?: string;
          to?: string | string[];
          bounce?: { type?: string } | null;
        };
      },
    );
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    console.error("Failed to process verified Resend webhook", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Internal error processing event" }, { status: 500 });
  }
}
