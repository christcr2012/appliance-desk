"use server";

import { parseFollowUpKey } from "@/domains/leads/follow-up";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { jobRoleScreens, JobRoleScreenError } from "@/lib/job-role-guard";
import {
  updateLeadStatus,
  convertLeadToCustomer,
  createLeadManually,
  addLeadNote,
  logLeadContact,
  logLeadAttempt,
  updateLeadDetails,
  type LeadDetailsInput,
} from "@/domains/leads";
import { setLeadFollowUp } from "@/domains/leads/follow-up";
import { reassignLead } from "@/domains/leads/assignment";
import { bulkUpdateLeads, type BulkLeadKind, type BulkLeadResult } from "@/domains/leads/bulk";
import { mergeLeads } from "@/domains/leads/merge";
import { recordRealContact } from "@/domains/leads/contact";
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

/**
 * LD-1: check this actor's Leads screen directly. The job-role check inside
 * requireRole looks at the address the request was posted from, and a server
 * action can be posted to any page address — so a job role without Leads
 * (for example Driver) could otherwise run these actions from an allowed
 * page such as Today. null screens = no job-role limit (owner, or no role).
 */
async function requireLeadsScreen(session: {
  user: { id: string; role: string };
}): Promise<void> {
  const screens = await jobRoleScreens(session.user.id, session.user.role);
  if (screens !== null && !screens.includes("leads")) {
    throw new JobRoleScreenError();
  }
}

export async function updateLeadStatusAction(
  leadId: string,
  status: string,
  lostReason?: string,
  followUpKey?: string,
): Promise<LeadActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  if (
    !NON_CONVERTED_STATUSES.includes(status as (typeof NON_CONVERTED_STATUSES)[number])
  ) {
    return { status: "error", message: "That's not a valid status to set here." };
  }

  try {
    // W-6: check the follow-up date first so a bad date never leaves the lead half-updated.
    const followUpOn = status === "CONTACTED" && followUpKey ? parseFollowUpKey(followUpKey, new Date()) : null;
    // LD-1: status, follow-up date and first contact move in one transaction.
    await updateLeadStatus(
      session.user.id,
      leadId,
      status as Exclude<LeadStatus, "CONVERTED">,
      lostReason,
      followUpOn,
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
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

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
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

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

export async function addLeadNoteAction(
  leadId: string,
  body: string,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  try {
    await addLeadNote(leadId, session.user.id, body);
    await recordRealContact(leadId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save that note.",
    };
  }

  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/growth");
  return { status: "success" };
}

/**
 * AR-4b: "Log a contact…" — kind CONTACTED ("I reached them") records a real
 * outbound contact: the lead leaves "New" and a follow-up date can then be
 * set. Kind ATTEMPT ("Tried, no answer") never counts as contact, so a new
 * lead stays new; its optional follow-up date is a plan, set in the same
 * save. `followUpKey` (YYYY-MM-DD) is optional for both kinds.
 */
export async function logLeadContactAction(
  leadId: string,
  kind: "CONTACTED" | "ATTEMPT",
  body: string,
  followUpKey?: string | null,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  try {
    const followUpOn =
      followUpKey === undefined ? undefined : followUpKey === null ? null : parseFollowUpKey(followUpKey, new Date());
    if (kind === "ATTEMPT") {
      await logLeadAttempt(session.user.id, leadId, body, followUpOn);
    } else {
      await logLeadContact(session.user.id, leadId, body, followUpOn);
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save that contact.",
    };
  }

  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/leads");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}

/** AR-4b: the follow-up sheet on a contacted lead (LD-1 setLeadFollowUp). Undo calls this again with the old date. */
export async function setLeadFollowUpAction(
  leadId: string,
  expectedVersion: number,
  dateKey: string | null,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  try {
    await setLeadFollowUp(session.user.id, leadId, expectedVersion, dateKey);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save that follow-up date.",
    };
  }

  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/leads");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}

/** AR-4b: "Assign to…" (LD-1 reassignLead; the domain keeps it owner/admin). */
export async function reassignLeadAction(
  leadId: string,
  toUserId: string | null,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  try {
    await reassignLead(session.user.id, leadId, toUserId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't assign that lead.",
    };
  }

  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/leads");
  return { status: "success" };
}

/** AR-4b: the lead record's "What they want" edit sheet (LEADS.md 3.7). */
export async function updateLeadDetailsAction(
  leadId: string,
  input: LeadDetailsInput,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  try {
    await updateLeadDetails(session.user.id, leadId, input);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't save those changes.",
    };
  }

  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/leads");
  return { status: "success" };
}

/** AR-4b: the duplicate banner's merge (LEADS.md 3.4) — lands on the kept lead. */
export async function mergeLeadsAction(
  keepId: string,
  mergeId: string,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");
  await requireLeadsScreen(session);

  try {
    await mergeLeads(session.user.id, keepId, mergeId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't merge those leads.",
    };
  }

  revalidatePath("/desk/leads");
  revalidatePath(`/desk/leads/${mergeId}`);
  redirect(`/desk/leads/${keepId}`);
}

/** AR-4b: the queue's bulk bar — each lead in its own transaction, per-lead failures reported. */
export async function bulkLeadAction(
  kind: BulkLeadKind,
  ids: string[],
  payload: { toUserId?: string | null; dateKey?: string | null; reason?: string },
): Promise<{ status: "success"; result: BulkLeadResult } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);

  try {
    const result = await bulkUpdateLeads(session.user.id, kind, ids, payload);
    revalidatePath("/desk/leads");
    revalidatePath("/desk/dashboard");
    return { status: "success", result };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't update those leads.",
    };
  }
}

/** Supply the missing account email without overwriting existing identity. */
export async function addLeadEmailAction(leadId: string, rawEmail: string): Promise<LeadActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await requireLeadsScreen(session);
  const parsed = z.string().trim().email("Enter a valid email address.").max(254).safeParse(rawEmail);
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };
  try {
    await prisma.$transaction(async tx => {
      const changed = await tx.lead.updateMany({
        where: { id: leadId, status: { not: "CONVERTED" }, OR: [{ email: null }, { email: "" }] },
        data: { email: parsed.data.toLowerCase(), emailLower: parsed.data.toLowerCase() },
      });
      if (changed.count !== 1) throw new Error("This lead changed. Refresh before adding an email.");
      await tx.auditLog.create({ data: { userId: session.user.id, action: "lead.email", entityType: "Lead", entityId: leadId, newValue: { email: parsed.data.toLowerCase() } } });
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save the email." };
  }
  revalidatePath(`/desk/leads/${leadId}`);
  revalidatePath("/desk/leads");
  return { status: "success" };
}
