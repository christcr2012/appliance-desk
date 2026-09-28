"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { sendCustomerActivationEmail } from "@/domains/leads";
import { getCustomerById, createCustomerDirectly } from "@/domains/customers";
import {
  addCustomerNote,
  addCustomerContact,
  deleteCustomerContact,
  type NewCustomerContactInput,
} from "@/domains/customers/timeline";

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

export type NewCustomerActionState =
  | { status: "idle" }
  | {
      status: "success";
      customerId: string;
      isNewAccount: boolean;
      activationEmailSent: boolean;
      // The just-created address rows, in the same order as the
      // addresses submitted — lets a caller (e.g. the rental builder
      // wizard) move straight to picking one without a second lookup.
      serviceAddresses: { id: string; line1: string; city: string; state: string; zip: string }[];
    }
  | { status: "error"; message: string };

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Street address is required."),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "City is required."),
  state: z.string().trim().max(2).optional().or(z.literal("")),
  zip: z.string().trim().min(5, "A valid ZIP code is required.").max(10),
});

const newCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z
    .string()
    .trim()
    .email("A valid email is required — the customer signs in with it."),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  isBusiness: z.boolean(),
  isPropertyManager: z.boolean(),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),
  // A household customer usually has exactly one property; a property
  // manager can list several right away instead of adding them one at a
  // time later — either way, at least one address keeps a brand-new
  // customer from sitting with nothing to schedule a job or agreement
  // against.
  addresses: z.array(addressSchema).min(1, "Add at least one property."),
});

export type NewCustomerInput = z.infer<typeof newCustomerSchema>;

/** Chris adding a customer directly (2026-09-27) — see
 * src/domains/customers' createCustomerDirectly for why this exists
 * and how it shares its account-creation rules with lead conversion. */
export async function createCustomerAction(
  input: NewCustomerInput,
): Promise<NewCustomerActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newCustomerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  try {
    const { customer, serviceAddresses, isNewAccount, activationEmailSent } =
      await createCustomerDirectly(session.user.id, {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || undefined,
        isBusiness: parsed.data.isBusiness,
        isPropertyManager: parsed.data.isPropertyManager,
        companyName: parsed.data.companyName || undefined,
        addresses: parsed.data.addresses.map((a) => ({
          line1: a.line1,
          line2: a.line2 || undefined,
          city: a.city,
          state: a.state || undefined,
          zip: a.zip,
        })),
      });

    revalidatePath("/desk/customers");
    revalidatePath("/desk/activity");

    return {
      status: "success",
      customerId: customer.id,
      isNewAccount,
      activationEmailSent,
      serviceAddresses: serviceAddresses.map((a) => ({
        id: a.id,
        line1: a.line1,
        city: a.city,
        state: a.state,
        zip: a.zip,
      })),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that customer.",
    };
  }
}

export type AddNoteState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

/** Quick action on a customer's own page — a call, something they said,
 * a reminder for next time. Notes are never edited or deleted once
 * saved (see the CustomerNote model's own comment for why), so this is
 * the only write this feature has. */
export async function addCustomerNoteAction(
  customerId: string,
  body: string,
): Promise<AddNoteState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await addCustomerNote(customerId, session.user.id, body);
    revalidatePath(`/desk/customers/${customerId}`);
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save that note.",
    };
  }
}

const contactSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  role: z.string().trim().max(100).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type AddContactState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

/** A second (or third) person Chris might need to reach for this
 * account — a site manager, an accounts-payable contact — distinct from
 * the customer's own login. See the CustomerContact model's own comment. */
export async function addCustomerContactAction(
  customerId: string,
  input: NewCustomerContactInput,
): Promise<AddContactState> {
  await requireRole("OWNER", "ADMIN");

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  try {
    await addCustomerContact(customerId, {
      name: parsed.data.name,
      role: parsed.data.role || undefined,
      phone: parsed.data.phone || undefined,
      email: parsed.data.email || undefined,
      notes: parsed.data.notes || undefined,
    });
    revalidatePath(`/desk/customers/${customerId}`);
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that contact.",
    };
  }
}

export async function deleteCustomerContactAction(
  customerId: string,
  contactId: string,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  await requireRole("OWNER", "ADMIN");

  try {
    await deleteCustomerContact(customerId, contactId);
    revalidatePath(`/desk/customers/${customerId}`);
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't remove that contact.",
    };
  }
}
