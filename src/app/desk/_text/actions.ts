"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { recordStaffTextConsent, sendWorkflowText, CONSENT_METHODS, type ConsentMethod } from "@/domains/messaging/workflow-text";
import { saveServiceReportingSettings } from "@/domains/messaging/telecom-reporting-settings";
import { approveWorkflowWording, saveWorkflowQuietHours, setWorkflowTextEnabled } from "@/domains/messaging/workflow-text-settings";

export type TextActionState = { ok: boolean; message: string } | null;
const str = (form: FormData, name: string) => { const v = form.get(name); return typeof v === "string" ? v : ""; };
const plain = (e: unknown) => (e instanceof Error ? e.message : "That did not work. Try again.");

/** Send one previewed text. The screen sends back only ids and the fingerprint of the text the person read. */
export async function sendTextAction(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  // Staff may send only the visit texts for a job assigned to them; the send function itself enforces that.
  const actor = await requireRole("OWNER", "ADMIN", "STAFF");
  const path = str(form, "path");
  try {
    const result = await sendWorkflowText(actor.user.id, {
      family: str(form, "family"), subjectId: str(form, "subjectId"), clientToken: str(form, "clientToken"),
      expectedTextHash: str(form, "textHash"), sendAgain: form.get("sendAgain") === "yes" });
    if (path.startsWith("/desk/")) revalidatePath(path);
    if (result.kind === "BLOCKED") return { ok: false, message: result.blockers.map((b) => b.message).join(" ") };
    if (result.kind === "CHANGED") return { ok: false, message: result.message };
    return { ok: result.kind === "ACCEPTED", message: result.message };
  } catch (e) { return { ok: false, message: plain(e) }; }
}

export async function recordTextConsentAction(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  const actor = await requireRole("OWNER", "ADMIN");
  const method = str(form, "method");
  if (!Object.hasOwn(CONSENT_METHODS, method)) return { ok: false, message: "Choose how they agreed." };
  const leadId = str(form, "leadId"); const customerId = str(form, "customerId");
  if (!leadId === !customerId) return { ok: false, message: "That record was not found." };
  try {
    const r = await recordStaffTextConsent(actor.user.id, {
      principal: leadId ? { leadId } : { customerId }, method: method as ConsentMethod });
    const path = str(form, "path"); if (path.startsWith("/desk/")) revalidatePath(path);
    return { ok: true, message: r.recorded ? "Saved. You can send the text now." : "Permission was already on file." };
  } catch (e) { return { ok: false, message: plain(e) }; }
}

export async function approveWordingAction(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  const actor = await requireRole("OWNER");
  try {
    const r = await approveWorkflowWording(actor.user.id, { family: str(form, "family"), body: str(form, "body") });
    revalidatePath("/desk/settings/telecom");
    return { ok: true, message: r.changed ? "Wording approved." : "That wording was already approved." };
  } catch (e) { return { ok: false, message: plain(e) }; }
}

export async function setTextEnabledAction(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  const actor = await requireRole("OWNER");
  try {
    await setWorkflowTextEnabled(actor.user.id, { family: str(form, "family"), enabled: str(form, "enabled") === "yes",
      expectedVersion: Number(str(form, "version")) });
    revalidatePath("/desk/settings/telecom");
    return { ok: true, message: str(form, "enabled") === "yes" ? "Switched on." : "Switched off." };
  } catch (e) { return { ok: false, message: plain(e) }; }
}

export async function saveQuietHoursAction(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  const actor = await requireRole("OWNER");
  try {
    const restore = str(form, "restore") === "yes";
    const minute = (name: string) => { const [h, m] = str(form, name).split(":").map(Number); return h * 60 + m; };
    await saveWorkflowQuietHours(actor.user.id, { expectedVersion: Number(str(form, "version")),
      quietHours: restore ? null : { startMinute: minute("start"), endMinute: minute("end") } });
    revalidatePath("/desk/settings/telecom");
    return { ok: true, message: restore ? "Restored the recommended quiet hours." : "Quiet hours saved." };
  } catch (e) { return { ok: false, message: plain(e) }; }
}

/** Owner-only: customer counts for the what-if forecast and how much history is needed. Blank customer counts restores the recommended values. */
export async function saveServiceReportingAction(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  const actor = await requireRole("OWNER");
  try {
    const version = Number(str(form, "version"));
    if (str(form, "restore") === "yes") {
      await saveServiceReportingSettings(actor.user.id, { settings: null, expectedVersion: version });
      revalidatePath("/desk/settings/telecom"); revalidatePath("/desk/reports");
      return { ok: true, message: "Recommended values restored." };
    }
    const counts = str(form, "scenarios").split(/[\s,]+/).filter(Boolean).map(Number);
    await saveServiceReportingSettings(actor.user.id, { expectedVersion: version, settings: {
      forecastScenarios: counts, minForecastCustomerDays: Number(str(form, "minDays")), minRateSample: Number(str(form, "minSample")) } });
    revalidatePath("/desk/settings/telecom"); revalidatePath("/desk/reports");
    return { ok: true, message: "Saved." };
  } catch (e) { return { ok: false, message: plain(e) }; }
}
