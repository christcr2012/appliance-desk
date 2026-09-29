import { Resend } from "resend";

/**
 * Thin wrapper around Resend (docs/DECISIONS.md picks Resend for
 * transactional email). Guarded so the app — and CI, and every preview
 * deployment without a real API key — never crashes or hangs on a
 * network call just because RESEND_API_KEY isn't set yet: it logs
 * instead and returns { sent: false }. Once a real key is added to
 * Vercel's environment variables, sending turns on with no code change.
 *
 * Every email sent through this function is now branded (2026-09-29,
 * brand kit v2.0 "Evergreen" — see docs/DECISIONS.md): callers still
 * just pass plain text, same as before this change, and this file
 * builds a branded HTML version alongside it, so every one of this
 * app's ~8 call sites got a real, on-brand email with zero changes to
 * their own code. `text` is still sent too, as Resend's (and every
 * email client's) plain-text fallback.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  /** Label for the button, when `text` ends in a bare link (a
   * password-reset/verification URL, say). Defaults to a generic
   * "Continue" when a link is present but no label was given. */
  actionLabel?: string;
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
      html: renderBrandedEmailHtml(input.text, input.actionLabel),
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

// Matches brand kit v2.0's own template (07_Web_Email/Customer-email-
// EDITABLE.html) — same colors, same table-based layout (the safe,
// widely-supported way to lay out HTML email; flexbox/grid are
// unreliable across real email clients), same header/footer structure.
// Kept in one small, self-contained function rather than a templating
// library, since this is the one HTML email this app sends.
const BRAND = {
  evergreen: "#123C2D",
  ivory: "#F7F5EC",
  ink: "#17251E",
  fresh: "#B9E66B",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BARE_URL_LINE = /^https?:\/\/\S+$/;

/**
 * Turns plain text (paragraphs separated by a blank line, the same
 * convention every call site already uses) into the branded HTML
 * layout. A paragraph that's nothing but a bare URL — every
 * password-reset/verification/activation link this app sends — is
 * rendered as a real button instead of a plain link, same as the brand
 * kit's own template. Everything else is escaped before going into the
 * HTML, since some of this text (a lead's name, a customer's typed
 * maintenance-request notes) is real user input, not copy this app
 * wrote itself.
 */
function renderBrandedEmailHtml(text: string, actionLabel = "Continue"): string {
  const paragraphs = text.split(/\n\n+/);
  const bodyHtml = paragraphs
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (BARE_URL_LINE.test(trimmed)) {
        const url = escapeHtml(trimmed);
        return `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:${BRAND.evergreen};color:white;text-decoration:none;padding:14px 22px;border-radius:6px;font-weight:600">${escapeHtml(actionLabel)}</a></p>`;
      }
      const lines = trimmed.split("\n").map(escapeHtml).join("<br>");
      return `<p style="margin:0 0 16px">${lines}</p>`;
    })
    .join("");

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:${BRAND.ivory};font-family:Arial,sans-serif;color:${BRAND.ink}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:white"><tr><td style="padding:32px;background:${BRAND.evergreen};color:white"><strong style="font-size:25px">ROBINSON</strong><br><span style="font-size:12px;letter-spacing:2px">APPLIANCE RENTALS</span></td></tr><tr><td style="padding:32px">${bodyHtml}</td></tr><tr><td style="padding:24px 32px;border-top:4px solid ${BRAND.fresh};font-size:12px;color:${BRAND.ink}"><a href="https://robinsonappliancerentals.com" style="color:${BRAND.evergreen}">robinsonappliancerentals.com</a></td></tr></table></td></tr></table></body></html>`;
}
