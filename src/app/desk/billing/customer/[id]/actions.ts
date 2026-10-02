"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { recordManualPayment, writeOffInvoice } from "@/domains/billing";
import { dollarsToCents } from "@/domains/pricing/money";
import { businessDateFromKey } from "@/lib/business-date";

export type RecordPaymentState =
  | { status: "idle" }
  | {
      status: "success";
      totalAppliedCents: number;
      overpaymentCents: number;
      invoicesTouched: number;
    }
  | { status: "error"; message: string };

const recordPaymentSchema = z.object({
  amountDollars: z.coerce.number().positive("Enter an amount greater than $0."),
  method: z.enum(["check", "cash", "bank_transfer", "other"]),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the payment was received."),
  invoiceId: z.string().trim().optional().or(z.literal("")),
  reference: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** Chris recording money that moved outside Stripe — a check, cash, or a
 * bank transfer he confirmed himself. */
export async function recordPaymentAction(
  customerId: string,
  input: RecordPaymentInput,
): Promise<RecordPaymentState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  const receivedOn = businessDateFromKey(parsed.data.receivedOn);
  if (!receivedOn) {
    return { status: "error", message: "Enter a valid date the payment was received." };
  }

  try {
    const result = await recordManualPayment(customerId, session.user.id, {
      amountCents: dollarsToCents(parsed.data.amountDollars),
      method: parsed.data.method,
      receivedOn,
      invoiceId: parsed.data.invoiceId || undefined,
      reference: parsed.data.reference || undefined,
      notes: parsed.data.notes || undefined,
    });

    revalidatePath(`/desk/billing/customer/${customerId}`);
    revalidatePath("/desk/billing");
    revalidatePath(`/desk/customers/${customerId}`);
    revalidatePath("/desk/dashboard");

    return {
      status: "success",
      totalAppliedCents: result.totalAppliedCents,
      overpaymentCents: result.overpaymentCents,
      invoicesTouched: result.invoicesTouched.length,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't record that payment.",
    };
  }
}

export type WriteOffState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function writeOffInvoiceAction(
  customerId: string,
  invoiceId: string,
  reason: string,
): Promise<WriteOffState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!reason.trim()) {
    return { status: "error", message: "Say why this invoice is being written off." };
  }

  try {
    await writeOffInvoice(invoiceId, session.user.id, reason.trim());
    revalidatePath(`/desk/billing/customer/${customerId}`);
    revalidatePath("/desk/billing");
    revalidatePath("/desk/dashboard");
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't write off that invoice.",
    };
  }
}
