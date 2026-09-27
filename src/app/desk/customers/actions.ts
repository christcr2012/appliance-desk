"use server";

import { requireRole } from "@/lib/session";
import { sendCustomerActivationEmail } from "@/domains/leads";
import { getCustomerById } from "@/domains/customers";

export type ResendActivationState =
  | { status: "sent" }
  | { status: "error"; message: string };

/** Lets Chris re-send the "set your password" activation email to a
 * customer whose account he can see never logged in yet, or who says
 * the first email didn't arrive / the link expired (Phase 6A item 2 —
 * Chris should never need to know or relay a customer's password
 * himself). Reuses the exact same email Better Auth's own forgot-
 * password flow sends — see src/lib/auth.ts's sendResetPassword and
 * src/domains/leads/index.ts's sendCustomerActivationEmail. */
export async function resendActivationEmailAction(
  customerId: string,
): Promise<ResendActivationState> {
  await requireRole("OWNER", "ADMIN");

  const customer = await getCustomerById(customerId);
  if (!customer) {
    return { status: "error", message: "Couldn't find that customer." };
  }

  const sent = await sendCustomerActivationEmail(customer.user.email);
  if (!sent) {
    return {
      status: "error",
      message: "Couldn't send the activation email just now — try again shortly.",
    };
  }

  return { status: "sent" };
}
