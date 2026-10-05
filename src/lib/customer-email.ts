import { sendEmail, type EmailResult } from "@/lib/email";
import { isCustomerEmailEnabled } from "@/domains/settings/customer-email-switch";

/**
 * Low-level customer email sender used by the durable message boundary.
 * It sends only when the owner has turned "Send emails to customers" on
 * (Desk → Settings → Notifications; starts off). Previews never send because
 * sendEmail independently enforces deployment safety.
 *
 * Business domains must use deliverMessage rather than calling this directly;
 * auth/password security mail remains a direct sendEmail exception by design.
 */
export async function sendCustomerEmail(
  input: Parameters<typeof sendEmail>[0],
): Promise<EmailResult> {
  if (!(await isCustomerEmailEnabled())) {
    return { sent: false, outcome: "NOT_ATTEMPTED" };
  }
  return sendEmail(input);
}
