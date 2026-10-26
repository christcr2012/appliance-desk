"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { jobRoleScreens } from "@/lib/job-role-guard";
import {
  approveFiling,
  markFilingDoneElsewhere,
  markFilingNotApplicable,
  prepareFiling,
  resolveFiling,
  submitFiling,
} from "@/domains/compliance/filings";
import { saveBusinessFacts, ENTITY_TYPES, type EntityType } from "@/domains/compliance/profile";
import { obligationByKey } from "@/domains/compliance/registry";
import { getComplianceProfile } from "@/domains/compliance/profile";
import { businessDateKey } from "@/lib/business-date";

// CMP-1: Compliance screen actions. Reads are OWNER/ADMIN; approvals and
// submissions are OWNER-only in the domain. Staff job roles narrow by the
// Taxes screen (compliance rides the sales-tax screen), checked explicitly
// here like the Leads actions — a server action can be posted from anywhere.

export type ComplianceActionState = { error?: string; ok?: boolean };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

/**
 * Compliance rides the Taxes (sales-tax) job-role screen. A server action
 * can be posted from any page, so the screen is checked explicitly here —
 * the same lesson the Leads actions carry.
 */
async function requireTaxesScreen(user: { id: string; role: string }): Promise<void> {
  const screens = await jobRoleScreens(user.id, user.role);
  if (screens !== null && !screens.includes("sales-tax")) {
    throw new Error("Your job role doesn't include the Taxes screen.");
  }
}

export async function saveFactsAction(
  _prev: ComplianceActionState,
  formData: FormData,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    const entityType = String(formData.get("entityType") ?? "");
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
      return { error: "Choose the business type." };
    }
    const einField = formData.get("ein");
    const clearEin = formData.get("clearEin") === "on";
    const month = String(formData.get("sosReportMonth") ?? "").trim();
    const gvwr = String(formData.get("truckGvwrLbs") ?? "").trim();
    await saveBusinessFacts(user.id, {
      entityType: entityType as EntityType,
      ein: clearEin ? null : typeof einField === "string" && einField.trim() !== "" ? einField : undefined,
      sosReportMonth: month === "" ? null : Number(month),
      truckGvwrLbs: gvwr === "" ? null : Number(gvwr),
      employees: Number(String(formData.get("employees") ?? "0")) || 0,
      hasHomeOffice: formData.get("hasHomeOffice") === "on",
    });
    // New facts can make new obligations apply (or schedule ones that were
    // waiting on a fact) — refresh the filing rows right away.
    const { syncComplianceFilings } = await import("@/domains/compliance/filings");
    await syncComplianceFilings();
    revalidatePath("/desk/compliance");
    revalidatePath("/desk/compliance/facts");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** The SOS periodic report's guided preparation: the exact values to type. */
export async function prepareGuidedAction(filingId: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    await requireTaxesScreen(user);
    const { prisma } = await import("@/lib/prisma");
    const filing = await prisma.complianceFiling.findUnique({ where: { id: filingId } });
    if (!filing) return { error: "That filing no longer exists." };
    const obligation = obligationByKey(filing.obligationKey);
    if (filing.obligationKey !== "co.sos.periodic_report") {
      return {
        error: `This filing is prepared by ${obligation?.unit ?? "a later step"} — it isn't ready to prepare here yet.`,
      };
    }
    const profile = await getComplianceProfile();
    if (!profile.sosReportMonth) {
      return { error: "Add your LLC's report month in Business facts first." };
    }
    await prepareFiling(user.id, filingId, {
      what: "Colorado LLC periodic report, filed on the Secretary of State site",
      reportMonth: profile.sosReportMonth,
      fileBetween: `${businessDateKey(filing.actOn)} and ${businessDateKey(filing.dueOn)}`,
      fee: "$25, paid to the Secretary of State",
    });
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function approveAction(filingId: string, preparedHash: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await approveFiling(user.id, filingId, preparedHash);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function approveAndSubmitAction(
  filingId: string,
  preparedHash: string,
  confirmation: string,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await approveFiling(user.id, filingId, preparedHash);
    await submitFiling(user.id, filingId, confirmation || undefined);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function markSubmittedAction(
  filingId: string,
  confirmation: string,
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await submitFiling(user.id, filingId, confirmation || undefined);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function resolveAction(
  filingId: string,
  outcome: "ACCEPTED" | "REJECTED",
): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    await requireTaxesScreen(user);
    await resolveFiling(user.id, filingId, outcome);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function doneElsewhereAction(filingId: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER");
    await markFilingDoneElsewhere(user.id, filingId);
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function notApplicableAction(filingId: string, note: string): Promise<ComplianceActionState> {
  try {
    const { user } = await requireRole("OWNER", "ADMIN");
    await requireTaxesScreen(user);
    await markFilingNotApplicable(user.id, filingId, note || "Marked not needed.");
    revalidatePath(`/desk/compliance/${filingId}`);
    revalidatePath("/desk/compliance");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
