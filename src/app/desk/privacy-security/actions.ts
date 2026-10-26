"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  addVendor, closeIncident, determineIncident, markIncidentStepDone, markVendorReviewed, openIncident,
  recordAccessibilityComplaint, resolveAccessibilityComplaint, savePrivacySettings, setLegalHold,
  type IncidentStepKey,
} from "@/domains/security/actions";
import { RECOMMENDED_PRIVACY_SETTINGS } from "@/domains/security/actions";
import { businessDateFromKey } from "@/lib/business-date";

export type SecurityActionState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

const fail = (error: unknown): SecurityActionState => ({ status: "error", message: error instanceof Error ? error.message : "Couldn't save that." });
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");
const num = (fd: FormData, key: string) => Number(text(fd, key));
function dateOf(fd: FormData, key: string): Date {
  const value = text(fd, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Pick a date.");
  const date = businessDateFromKey(value);
  if (!date) throw new Error("Pick a date.");
  return date;
}
const refresh = () => { revalidatePath("/desk/privacy-security"); revalidatePath("/desk/today"); revalidatePath("/desk/tasks"); };

export async function openIncidentAction(_: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try { await openIncident(session.user.id, { summary: text(fd, "summary"), discoveredAt: dateOf(fd, "discoveredOn") }); refresh(); return { status: "success", message: "Recorded. Next, decide whether information was really exposed." }; } catch (e) { return fail(e); }
}
export async function determineIncidentAction(id: string, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try { await determineIncident(session.user.id, id, { determinedAt: dateOf(fd, "determinedOn"), residentsAffected: num(fd, "residents") }); refresh(); return { status: "success", message: "The clock is set. The deadlines are now on your To do list." }; } catch (e) { return fail(e); }
}
export async function stepDoneAction(id: string, step: IncidentStepKey, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try { await markIncidentStepDone(session.user.id, id, step, dateOf(fd, "doneOn")); refresh(); return { status: "success", message: "Recorded." }; } catch (e) { return fail(e); }
}
export async function closeIncidentAction(id: string, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try { await closeIncident(session.user.id, id, text(fd, "note")); refresh(); return { status: "success", message: "Closed." }; } catch (e) { return fail(e); }
}
export async function vendorReviewedAction(id: string, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try { await markVendorReviewed(session.user.id, id, dateOf(fd, "reviewedOn"), text(fd, "notes")); refresh(); return { status: "success", message: "Recorded." }; } catch (e) { return fail(e); }
}
export async function addVendorAction(_: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try { await addVendor(session.user.id, { name: text(fd, "name"), whatTheyDo: text(fd, "whatTheyDo"), dataTheyHold: text(fd, "dataTheyHold") }); refresh(); return { status: "success", message: "Added." }; } catch (e) { return fail(e); }
}
export async function legalHoldAction(hold: boolean, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try {
    let customerId = text(fd, "customerId");
    if (!customerId) {
      const email = text(fd, "email").trim().toLowerCase();
      const found = email ? await prisma.customer.findFirst({ where: { user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } }) : null;
      if (!found) throw new Error("No customer has that email address.");
      customerId = found.id;
    }
    await setLegalHold(session.user.id, customerId, hold, text(fd, "reason"));
    refresh();
    return { status: "success", message: hold ? "Legal hold is on." : "Legal hold lifted." };
  } catch (e) { return fail(e); }
}
export async function complaintAction(_: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try { await recordAccessibilityComplaint(session.user.id, { receivedAt: dateOf(fd, "receivedOn"), fromWho: text(fd, "fromWho"), description: text(fd, "description") }); refresh(); return { status: "success", message: "Recorded. The fix date is on your To do list." }; } catch (e) { return fail(e); }
}
export async function complaintResolvedAction(id: string, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try { await resolveAccessibilityComplaint(session.user.id, id, text(fd, "note")); refresh(); return { status: "success", message: "Marked fixed." }; } catch (e) { return fail(e); }
}
export async function settingsAction(restore: boolean, _: SecurityActionState, fd: FormData): Promise<SecurityActionState> {
  const session = await requireRole("OWNER");
  try {
    const next = restore ? RECOMMENDED_PRIVACY_SETTINGS : {
      retentionAgreementYears: num(fd, "retentionAgreementYears"), retentionTaxYears: num(fd, "retentionTaxYears"),
      retentionRefrigerantYears: num(fd, "retentionRefrigerantYears"), retentionLeadYears: num(fd, "retentionLeadYears"),
      retentionMessageYears: num(fd, "retentionMessageYears"), retentionPurgeEnabled: fd.get("retentionPurgeEnabled") === "on",
      faceMatchIdEnabled: fd.get("faceMatchIdEnabled") === "on", marketingTextStartHour: num(fd, "marketingTextStartHour"),
      marketingTextEndHour: num(fd, "marketingTextEndHour"), vendorReviewMonths: num(fd, "vendorReviewMonths"),
    };
    await savePrivacySettings(session.user.id, next);
    refresh();
    return { status: "success", message: restore ? "Back to the recommended values." : "Saved." };
  } catch (e) { return fail(e); }
}
