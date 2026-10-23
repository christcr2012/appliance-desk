"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { paperworkInputSchema } from "@/domains/paperwork/schema";
import {
  addStarterChecklist,
  createPaperwork,
  deletePaperwork,
  markPaperworkDone,
  PAPERWORK_STALE_MESSAGE,
  updatePaperwork,
} from "@/domains/paperwork";

export type PaperworkFormState = { status: "idle" } | { status: "error"; message: string };

function formValues(formData: FormData) {
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    title: get("title"),
    groupName: get("groupName"),
    status: get("status"),
    whatItIs: get("whatItIs"),
    agency: get("agency"),
    officialUrl: get("officialUrl"),
    referenceNumber: get("referenceNumber"),
    startedOn: get("startedOn"),
    dueOn: get("dueOn"),
    remindDaysBefore: get("remindDaysBefore") || "30",
    repeatEveryMonths: get("repeatEveryMonths"),
    notes: get("notes"),
  };
}

function refresh() {
  revalidatePath("/desk/paperwork");
  revalidatePath("/desk/today");
}

export async function addStarterChecklistAction(): Promise<void> {
  const session = await requireRole("OWNER");
  await addStarterChecklist(session.user.id);
  refresh();
}

export async function createPaperworkAction(
  _previous: PaperworkFormState,
  formData: FormData,
): Promise<PaperworkFormState> {
  const session = await requireRole("OWNER");
  const parsed = paperworkInputSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  let id: string;
  try {
    id = await createPaperwork(session.user.id, parsed.data);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  refresh();
  redirect(`/desk/paperwork/${id}`);
}

export async function updatePaperworkAction(
  id: string,
  expectedVersion: number,
  _previous: PaperworkFormState,
  formData: FormData,
): Promise<PaperworkFormState> {
  const session = await requireRole("OWNER");
  const parsed = paperworkInputSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  try {
    await updatePaperwork(session.user.id, id, parsed.data, expectedVersion);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  refresh();
  redirect("/desk/paperwork");
}

export async function markPaperworkDoneAction(id: string, expectedVersion: number): Promise<void> {
  const session = await requireRole("OWNER");
  try {
    await markPaperworkDone(session.user.id, id, expectedVersion);
  } catch (error) {
    // A second click or another tab: the item already moved on, so show its current state instead of an error page.
    if (error instanceof Error && error.message === PAPERWORK_STALE_MESSAGE) redirect(`/desk/paperwork/${id}`);
    throw error;
  }
  refresh();
  redirect("/desk/paperwork");
}

export async function deletePaperworkAction(id: string): Promise<void> {
  const session = await requireRole("OWNER");
  await deletePaperwork(session.user.id, id);
  refresh();
  redirect("/desk/paperwork");
}
