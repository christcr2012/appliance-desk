"use server";

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { createBillingPortalSession } from "@/domains/billing";

/** Sends the signed-in customer to Stripe's own hosted Customer Portal —
 * where they manage their payment method (card or bank account),
 * download past invoices, and see upcoming charges. Nothing about
 * payment methods is built here on purpose; Stripe's portal already does
 * this correctly and keeps card/bank details off our own servers, per
 * docs/BUSINESS-RULES.md's billing rules. */
export async function openBillingPortalAction(): Promise<{ error: string } | never> {
  const session = await getServerSession();
  if (!session) {
    return { error: "You need to be signed in." };
  }

  const customer = await getPortalData(session.user.id);
  if (!customer) {
    return { error: "There's no rental account attached to this login yet." };
  }

  const url = await createBillingPortalSession(customer.id);
  if (!url) {
    return {
      error: "You don't have any billing set up yet — this becomes available after your first payment.",
    };
  }

  redirect(url);
}
