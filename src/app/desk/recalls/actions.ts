"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  confirmRecallMatch, decideSafetyIncident, markRecallNotOurs, markRecallRemedied, markSafetyIncident,
} from "@/domains/recalls/hold";
import { setRecallTerms } from "@/domains/recalls/reads";
import { requestFleetRecheck } from "@/domains/recalls/watch";

export type RecallActionState = { status: "idle" } | { status: "success"; message?: string } | { status: "error"; message: string };

const fail = (error: unknown, fallback: string): RecallActionState => ({
  status: "error",
  message: error instanceof Error ? error.message : fallback,
});

function refresh() {
  revalidatePath("/desk/recalls");
  revalidatePath("/desk/today");
  revalidatePath("/desk/inventory");
  revalidatePath("/desk/tasks");
}

export async function confirmRecallAction(matchId: string): Promise<RecallActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const { tasksCreated } = await confirmRecallMatch(session.user.id, matchId);
    refresh();
    return {
      status: "success",
      message: tasksCreated > 0
        ? `On hold. ${tasksCreated} customer${tasksCreated === 1 ? "" : "s"} added to your To do list to contact.`
        : "On hold. Nobody is renting it right now.",
    };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}

const reasonSchema = z.string().trim().min(1, "Say briefly why.").max(300);

export async function notOursRecallAction(matchId: string, reason: string): Promise<RecallActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Say briefly why." };
  try {
    await markRecallNotOurs(session.user.id, matchId, parsed.data);
    refresh();
    return { status: "success", message: "Marked as not ours." };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}

export async function remediedRecallAction(matchId: string, note: string): Promise<RecallActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = reasonSchema.safeParse(note);
  if (!parsed.success) return { status: "error", message: "Say what was done." };
  try {
    await markRecallRemedied(session.user.id, matchId, parsed.data);
    refresh();
    return { status: "success", message: "Fix recorded. The hold is off unless another recall still covers it." };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}

export async function checkWholeFleetAction(): Promise<RecallActionState> {
  await requireRole("OWNER", "ADMIN");
  try {
    await requestFleetRecheck();
    refresh();
    return { status: "success", message: "Okay. Tonight's check will look at your whole fleet, going back 15 years." };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}

export async function saveRecallTermsAction(applianceTypeId: string, raw: string): Promise<RecallActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await setRecallTerms(session.user.id, applianceTypeId, raw);
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}

const incidentSchema = z.object({
  description: z.string().trim().min(1, "Say briefly what happened.").max(1000),
  applianceId: z.string().trim().max(200).nullable().optional(),
  maintenanceRequestId: z.string().trim().max(200).nullable().optional(),
  jobId: z.string().trim().max(200).nullable().optional(),
});

export async function markSafetyIncidentAction(raw: unknown): Promise<RecallActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const parsed = incidentSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the details." };
  if (!parsed.data.maintenanceRequestId && !parsed.data.jobId && !parsed.data.applianceId) {
    return { status: "error", message: "This incident isn't tied to a repair request or visit." };
  }
  try {
    const result = await markSafetyIncident(session.user.id, parsed.data);
    refresh();
    return { status: "success", message: result.created ? "Marked. It's now on the owner's To do list." : "This was already marked." };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}

const decisionSchema = z.object({
  decision: z.enum(["REPORTED", "NOT_REPORTED"]),
  note: z.string().trim().min(1, "Add a short note.").max(500),
});

export async function decideSafetyIncidentAction(incidentId: string, raw: unknown): Promise<RecallActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the details." };
  try {
    await decideSafetyIncident(session.user.id, incidentId, parsed.data.decision, parsed.data.note);
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) {
    return fail(error, "Couldn't save that.");
  }
}
