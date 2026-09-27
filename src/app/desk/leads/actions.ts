"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { updateLeadStatus, convertLeadToCustomer } from "@/domains/leads";
import type { LeadStatus } from "@prisma/client";

export type LeadActionState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "converted";
      customerId: string;
      isNewAccount: boolean;
      activationEmailSent: boolean;
    }
  | { status: "error"; message: string };

const NON_CONVERTED_STATUSES: Exclude<LeadStatus, "CONVERTED">[] = [
  "NEW",
  "CONTACTED",
  "LOST",
];

export async function updateLeadStatusAction(
  leadId: string,
  status: string,
): Promise<LeadActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (
    !NON_CONVERTED_STATUSES.includes(status as (typeof NON_CONVERTED_STATUSES)[number])
  ) {
    return { status: "error", message: "That's not a valid status to set here." };
  }

  try {
    await updateLeadStatus(
      session.user.id,
      leadId,
      status as Exclude<LeadStatus, "CONVERTED">,
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't update that lead.",
    };
  }

  revalidatePath("/desk/leads");
  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/dashboard");

  return { status: "success" };
}

export async function convertLeadAction(
  leadId: string,
): Promise<LeadActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    const { customer, isNewAccount, activationEmailSent } = await convertLeadToCustomer(
      session.user.id,
      leadId,
    );

    revalidatePath("/desk/leads");
    revalidatePath(`/desk/leads/${leadId}`);
    revalidatePath("/desk/dashboard");
    revalidatePath("/desk/activity");

    return {
      status: "converted",
      customerId: customer.id,
      isNewAccount,
      activationEmailSent,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't convert that lead.",
    };
  }
}
