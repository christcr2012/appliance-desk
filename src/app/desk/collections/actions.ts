"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  createCollectionPickup, customerObjected, recordCourtOrder, recordDecision, recordPickupConsent,
  recordSmallClaimsFiling, saveLadder, sendNotice, skipNotice,
} from "@/domains/collections/actions";
import { RECOMMENDED_LADDER } from "@/domains/collections/rules";

export type CollectionActionState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

const fail = (error: unknown): CollectionActionState => ({
  status: "error",
  message: error instanceof Error ? error.message : "Couldn't save that.",
});

function refresh(agreementId?: string) {
  revalidatePath("/desk/collections");
  if (agreementId) revalidatePath(`/desk/collections/${agreementId}`);
  revalidatePath("/desk/today");
  revalidatePath("/desk/tasks");
}

export async function sendNoticeAction(stepId: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const result = await sendNotice(session.user.id, stepId);
    refresh();
    return result.sent ? { status: "success", message: result.message } : { status: "error", message: result.message };
  } catch (error) {
    refresh();
    return fail(error);
  }
}

export async function skipNoticeAction(stepId: string, reason: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await skipNotice(session.user.id, stepId, reason);
    refresh();
    return { status: "success", message: "Skipped." };
  } catch (error) {
    return fail(error);
  }
}

export async function decisionAction(stepId: string, agreementId: string, choice: "PAYMENT_PLAN" | "PICKUP" | "SMALL_CLAIMS" | "WAIT", note: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await recordDecision(session.user.id, stepId, choice, note);
    refresh(agreementId);
    return { status: "success", message: "Saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function consentAction(agreementId: string, how: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await recordPickupConsent(session.user.id, agreementId, { how });
    refresh(agreementId);
    return { status: "success", message: "Recorded. You can now make the pickup visit." };
  } catch (error) {
    return fail(error);
  }
}

export async function courtOrderAction(agreementId: string, note: string, orderedOn: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const date = new Date(`${orderedOn}T12:00:00-06:00`);
    if (Number.isNaN(date.getTime())) return { status: "error", message: "Pick the date of the order." };
    await recordCourtOrder(session.user.id, agreementId, { orderedOn: date, note });
    refresh(agreementId);
    return { status: "success", message: "Court order recorded." };
  } catch (error) {
    return fail(error);
  }
}

export async function pickupAction(agreementId: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await createCollectionPickup(session.user.id, agreementId);
    refresh(agreementId);
    revalidatePath("/desk/jobs");
    return { status: "success", message: "Pickup visit created. Schedule it from Jobs." };
  } catch (error) {
    return fail(error);
  }
}

export async function objectedAction(agreementId: string, note: string): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  try {
    await customerObjected(session.user.id, agreementId, note);
    refresh(agreementId);
    revalidatePath("/desk/jobs");
    return { status: "success", message: "Recorded. The visit is ended with nothing taken, and small claims is on your To do." };
  } catch (error) {
    return fail(error);
  }
}

export async function filingAction(agreementId: string, input: { county: string; filedOn: string; amountDollars: string; feeDollars: string }): Promise<CollectionActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const filedOn = new Date(`${input.filedOn}T12:00:00-06:00`);
    if (Number.isNaN(filedOn.getTime())) return { status: "error", message: "Pick the date you filed." };
    const amountCents = Math.round(Number(input.amountDollars) * 100);
    const feeCents = Math.round(Number(input.feeDollars) * 100);
    if (!Number.isFinite(amountCents) || !Number.isFinite(feeCents)) return { status: "error", message: "Use dollar amounts like 125.00." };
    await recordSmallClaimsFiling(session.user.id, { agreementId, county: input.county, filedOn, amountCents, feeCents });
    refresh(agreementId);
    return { status: "success", message: "Recorded. The court's monthly and yearly limits now count it." };
  } catch (error) {
    return fail(error);
  }
}

export async function ladderAction(_previous: CollectionActionState, form: FormData): Promise<CollectionActionState> {
  const session = await requireRole("OWNER");
  try {
    const restore = form.get("operation") === "restore";
    const num = (name: string) => Number(String(form.get(name) ?? "").trim());
    const days = restore ? RECOMMENDED_LADDER : { secondNotice: num("secondNotice"), finalNotice: num("finalNotice"), decision: num("decision") };
    await saveLadder(session.user.id, days);
    refresh();
    revalidatePath("/desk/settings");
    return { status: "success", message: `Saved: second notice on day ${days.secondNotice}, final notice on day ${days.finalNotice}, your decision on day ${days.decision}.` };
  } catch (error) {
    return fail(error);
  }
}
