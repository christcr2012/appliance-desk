import { sendEmail } from "@/lib/email";
import { isCustomerEmailEnabled } from "@/domains/settings/customer-email-switch";

/**
 * Every email addressed to a customer goes through here, never straight through
 * `sendEmail`. It sends only when the owner has turned "Send emails to customers" on
 * (Desk → Settings → Notifications; starts off). Anything else (staff alerts, password
 * emails) keeps using `sendEmail` directly. Previews never send regardless.
 * Returns { sent: false } when the switch is off, so callers keep their normal
 * "not sent" handling.
 */
export async function sendCustomerEmail(input: Parameters<typeof sendEmail>[0]): Promise<{ sent: boolean }> {
  if (!(await isCustomerEmailEnabled())) return { sent: false };
  return sendEmail(input);
}
