"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  dismissWalkthrough,
  markStepDone,
  reopenStep,
  restoreWalkthrough,
  saveStepFile,
  saveStepNumber,
} from "@/domains/setup/guide";

export type StepSaveState = { status: "idle" } | { status: "error"; message: string } | { status: "saved" };

function refresh(walkthroughKey?: string) {
  revalidatePath("/desk/setup-guide");
  if (walkthroughKey) revalidatePath(`/desk/setup-guide/${walkthroughKey}`);
  revalidatePath("/desk/today");
  revalidatePath("/desk/paperwork");
}

export async function markStepDoneAction(walkthroughKey: string, stepKey: string): Promise<void> {
  const session = await requireRole("OWNER");
  await markStepDone(session.user.id, walkthroughKey, stepKey);
  refresh(walkthroughKey);
}

export async function reopenStepAction(walkthroughKey: string, stepKey: string): Promise<void> {
  const session = await requireRole("OWNER");
  await reopenStep(session.user.id, walkthroughKey, stepKey);
  refresh(walkthroughKey);
}

export async function dismissWalkthroughAction(walkthroughKey: string): Promise<void> {
  const session = await requireRole("OWNER");
  await dismissWalkthrough(session.user.id, walkthroughKey);
  refresh(walkthroughKey);
}

export async function restoreWalkthroughAction(walkthroughKey: string): Promise<void> {
  const session = await requireRole("OWNER");
  await restoreWalkthrough(session.user.id, walkthroughKey);
  refresh(walkthroughKey);
}

export async function saveStepNumberAction(
  walkthroughKey: string,
  stepKey: string,
  _previous: StepSaveState,
  formData: FormData,
): Promise<StepSaveState> {
  const session = await requireRole("OWNER");
  const value = formData.get("numberValue");
  if (typeof value !== "string" || value.trim() === "") {
    return { status: "error", message: "Type the number first." };
  }
  try {
    await saveStepNumber(session.user.id, walkthroughKey, stepKey, value);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "That number could not be saved.",
    };
  }
  refresh(walkthroughKey);
  return { status: "saved" };
}

export async function saveStepFileAction(
  walkthroughKey: string,
  stepKey: string,
  _previous: StepSaveState,
  formData: FormData,
): Promise<StepSaveState> {
  const session = await requireRole("OWNER");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file first." };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await saveStepFile(session.user.id, walkthroughKey, stepKey, {
      fileName: file.name,
      bytes,
      label: typeof formData.get("label") === "string" ? (formData.get("label") as string) || undefined : undefined,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "That file could not be saved.",
    };
  }
  refresh(walkthroughKey);
  return { status: "saved" };
}
