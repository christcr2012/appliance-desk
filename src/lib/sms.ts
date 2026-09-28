import twilio from "twilio";

/**
 * Thin wrapper around Twilio (Task #71, docs/DECISIONS.md — SMS
 * notifications). Guarded exactly like src/lib/email.ts's sendEmail:
 * missing configuration logs and returns { sent: false } instead of
 * crashing or hanging on a network call, so the app, CI, and every
 * preview deployment stay safe with nothing configured.
 *
 * TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are set in Vercel already, but
 * TWILIO_PHONE_NUMBER deliberately isn't yet — Chris can't buy a real
 * Twilio number until his LLC's A2P 10DLC business registration is
 * done (a carrier requirement for business texting, not a bug here).
 * Every SMS-sending code path is fully built and wired up now; it
 * simply stays dormant (this no-ops) until that one env var is added,
 * at which point sending turns on with no code change — same pattern
 * BLOB_READ_WRITE_TOKEN and STRIPE_WEBHOOK_SECRET followed before they
 * were set.
 */
export async function sendSms(input: { to: string; body: string }): Promise<{ sent: boolean }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.log(
      `[sms] Twilio isn't fully configured yet (needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER) — skipping send. Would have texted ${input.to}: "${input.body}"`,
    );
    return { sent: false };
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({ to: input.to, from, body: input.body });
    return { sent: true };
  } catch (error) {
    // Same reasoning as sendEmail: a failed text must never break
    // whatever real work already happened (the job was still
    // scheduled, the reminder logic already ran) — logged, not thrown.
    console.error("[sms] Failed to send text message", error);
    return { sent: false };
  }
}
