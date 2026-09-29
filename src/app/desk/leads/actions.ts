"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { updateLeadStatus, convertLeadToCustomer, createLeadManually } from "@/domains/leads";
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

const newLeadSchema = z.object({
  contactName: z.string().trim().min(2, "Enter their name").max(200),
  phone: z.string().trim().min(7, "Enter a valid phone number").max(20),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),
  isBusiness: z.boolean().optional(),
  isPropertyManager: z.boolean().optional(),
  addressLine1: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  zip: z.string().trim().max(10).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function createLeadAction(
  raw: Record<string, unknown>,
): Promise<{ status: "success"; leadId: string } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  let lead;
  try {
    lead = await createLeadManually(session.user.id, {
      contactName: data.contactName,
      phone: data.phone,
      email: data.email || null,
      companyName: data.companyName || null,
      isBusiness: data.isBusiness,
      isPropertyManager: data.isPropertyManager,
      addressLine1: data.addressLine1 || null,
      city: data.city || null,
      zip: data.zip || null,
      notes: data.notes || null,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that lead.",
    };
  }

  revalidatePath("/desk/leads");
  revalidatePath("/desk/dashboard");
  return { status: "success", leadId: lead.id };
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
