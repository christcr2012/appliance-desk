import { Resend } from "resend";

/**
 * Thin wrapper around Resend (docs/DECISIONS.md picks Resend for
 * transactional email). Guarded so the app — and CI, and every preview
 * deployment without a real API key — never crashes or hangs on a
 * network call just because RESEND_API_KEY isn't set yet: it logs
 * instead and returns { sent: false }. Once a real key is added to
 * Vercel's environment variables, sending turns on with no code change.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "Appliance Desk <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(
      `[email] RESEND_API_KEY not set — skipping send. Would have emailed ${input.to}: "${input.subject}"`,
    );
    return { sent: false };
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { sent: true };
  } catch (error) {
    // A failed notification email must never break lead submission itself
    // — the lead is already saved by the time this runs. Log so it shows
    // up in Sentry/Vercel logs and can be followed up by hand.
    console.error("[email] Failed to send notification email", error);
    return { sent: false };
  }
}
