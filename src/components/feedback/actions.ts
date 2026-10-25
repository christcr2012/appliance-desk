"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getServerSession } from "@/lib/session";
import { readCustomerLanguage } from "@/domains/language";
import {
  FeedbackError, addFeedbackDetails, addFeedbackScreenshot, addInternalNote, closeMyFeedback, markDuplicate,
  reopenMyFeedback, replyToReporter, setFeedbackState, submitFeedback,
} from "@/domains/feedback";
import { FEEDBACK_STATES, type FeedbackStateName, type SubmitFeedbackInput } from "@/domains/feedback/rules";

// MCP-10a server actions. Who the person is always comes from their own session inside the domain functions, never
// from anything the browser sends; the domain re-checks ownership (reporters) or OWNER/ADMIN (triage) on every call.

export type FeedbackActionResult = { status: "success" } | { status: "error" | "conflict"; message: string };
export type SubmitActionResult =
  | { status: "success"; id: string; number: number; maxAttachments: number }
  | { status: "error"; message: string };
export type ScreenshotActionResult =
  | { status: "saved"; left: number }
  | { status: "unavailable" | "error"; message: string };

const FALLBACK = "That didn't go through. Your text is still here — please try again.";

function messageOf(error: unknown): { status: "error" | "conflict"; message: string } {
  if (error instanceof FeedbackError) return { status: error.conflict ? "conflict" : "error", message: error.message };
  if (error instanceof ZodError) return { status: "error", message: error.issues[0]?.message ?? FALLBACK };
  if (error instanceof Error && /no longer has access|Two-step|job role/i.test(error.message)) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: FALLBACK };
}

function refresh(id?: string) {
  revalidatePath("/account/feedback");
  revalidatePath("/desk/feedback/mine");
  revalidatePath("/desk/feedback");
  revalidatePath("/desk/today");
  if (id) {
    revalidatePath(`/account/feedback/${id}`);
    revalidatePath(`/desk/feedback/mine/${id}`);
    revalidatePath(`/desk/feedback/${id}`);
  }
}

async function run(action: () => Promise<unknown>, id?: string): Promise<FeedbackActionResult> {
  try {
    await action();
  } catch (error) {
    return messageOf(error);
  }
  refresh(id);
  return { status: "success" };
}

export async function submitFeedbackAction(raw: SubmitFeedbackInput): Promise<SubmitActionResult> {
  try {
    const session = await getServerSession();
    const requestHeaders = await headers();
    const language = session?.user?.role === "CUSTOMER" ? await readCustomerLanguage(session.user.id) : "en";
    const result = await submitFeedback(raw, { userAgent: requestHeaders.get("user-agent"), language });
    refresh(result.id);
    return { status: "success", ...result };
  } catch (error) {
    return { status: "error", message: messageOf(error).message };
  }
}

export async function addFeedbackScreenshotAction(reportId: string, form: FormData): Promise<ScreenshotActionResult> {
  try {
    const file = form.get("file");
    if (!(file instanceof Blob)) return { status: "error", message: "Choose a picture first." };
    const result = await addFeedbackScreenshot(reportId, file);
    if (result.status === "unavailable") return result;
    refresh(reportId);
    return { status: "saved", left: result.left };
  } catch (error) {
    return { status: "error", message: messageOf(error).message };
  }
}

export async function addFeedbackDetailsAction(id: string, version: number, body: string) {
  return run(() => addFeedbackDetails(id, version, body), id);
}

export async function closeMyFeedbackAction(id: string, version: number) {
  return run(() => closeMyFeedback(id, version), id);
}

export async function reopenMyFeedbackAction(id: string, version: number, why: string) {
  return run(() => reopenMyFeedback(id, version, why), id);
}

function stateOrNull(value: unknown): FeedbackStateName | null {
  return typeof value === "string" && (FEEDBACK_STATES as readonly string[]).includes(value) ? (value as FeedbackStateName) : null;
}

export async function replyToReporterAction(id: string, version: number, body: string, nextState: string | null) {
  return run(() => replyToReporter(id, version, body, stateOrNull(nextState)), id);
}

export async function addInternalNoteAction(id: string, body: string) {
  return run(() => addInternalNote(id, body), id);
}

export async function setFeedbackStateAction(id: string, version: number, toState: string, reason: string) {
  const to = stateOrNull(toState);
  if (!to) return { status: "error", message: "Choose a status." } satisfies FeedbackActionResult;
  return run(() => setFeedbackState(id, version, to, reason), id);
}

export async function markDuplicateAction(id: string, version: number, ofNumber: string) {
  const number = Number(String(ofNumber).replace("#", "").trim());
  return run(() => markDuplicate(id, version, number), id);
}
