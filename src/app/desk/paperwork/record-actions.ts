"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { RECORD_FILE_MAX_BYTES } from "@/domains/paperwork/rules";
import {
  archiveRecord,
  attachRecordFile,
  clearRecordNumber,
  registerUploadedRecordFile,
  removeRecordFile,
  renewRecord,
  updatePaperworkAdminKinds,
} from "@/domains/paperwork/records";
import { PAPERWORK_STALE_MESSAGE } from "@/domains/paperwork";

export type RecordActionState = { status: "idle" } | { status: "error"; message: string };

function refresh(recordId?: string) {
  revalidatePath("/desk/paperwork");
  if (recordId) revalidatePath(`/desk/paperwork/${recordId}`);
  revalidatePath("/desk/today");
}

function plainError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Small files (≤ 900 KB) arrive with the form; larger PDFs use the direct-to-store path below. */
export async function uploadRecordFileAction(
  recordId: string,
  _previous: RecordActionState,
  formData: FormData,
): Promise<RecordActionState> {
  const session = await requireRole("OWNER");
  const file = formData.get("file");
  const label = formData.get("label");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file first." };
  }
  if (file.size > RECORD_FILE_MAX_BYTES) {
    return {
      status: "error",
      message:
        "That file is too large to attach this way. PDFs up to 15 MB can be added with the large-file option; photos need to be under 900 KB.",
    };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await attachRecordFile(session.user.id, recordId, {
      fileName: file.name,
      bytes,
      label: typeof label === "string" ? label : null,
    });
  } catch (error) {
    return { status: "error", message: plainError(error, "That file could not be saved.") };
  }
  refresh(recordId);
  return { status: "idle" };
}

/** Registers a large PDF the browser uploaded straight to the private store (token-gated by the upload route). */
export async function registerRecordFileAction(
  recordId: string,
  input: { pathname: string; fileName: string; label?: string | null },
): Promise<RecordActionState> {
  const session = await requireRole("OWNER");
  try {
    await registerUploadedRecordFile(session.user.id, recordId, input);
  } catch (error) {
    return { status: "error", message: plainError(error, "That file could not be saved.") };
  }
  refresh(recordId);
  return { status: "idle" };
}

export async function removeRecordFileAction(recordId: string, fileId: string): Promise<void> {
  const session = await requireRole("OWNER");
  await removeRecordFile(session.user.id, recordId, fileId);
  refresh(recordId);
}

export async function renewRecordAction(
  recordId: string,
  expectedVersion: number,
  _previous: RecordActionState,
  formData: FormData,
): Promise<RecordActionState> {
  const session = await requireRole("OWNER");
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" && value !== "" ? value : null;
  };
  try {
    await renewRecord(session.user.id, recordId, {
      expiresOn: get("expiresOn"),
      dueOn: get("dueOn"),
      expectedVersion,
    });
  } catch (error) {
    if (error instanceof Error && error.message === PAPERWORK_STALE_MESSAGE) {
      redirect(`/desk/paperwork/${recordId}`);
    }
    return { status: "error", message: plainError(error, "That renewal could not be saved.") };
  }
  refresh(recordId);
  redirect(`/desk/paperwork/${recordId}`);
}

export async function clearRecordNumberAction(recordId: string): Promise<void> {
  const session = await requireRole("OWNER");
  await clearRecordNumber(session.user.id, recordId);
  refresh(recordId);
  redirect(`/desk/paperwork/${recordId}`);
}

export async function archiveRecordAction(recordId: string, expectedVersion: number): Promise<void> {
  const session = await requireRole("OWNER");
  try {
    await archiveRecord(session.user.id, recordId, expectedVersion);
  } catch (error) {
    if (error instanceof Error && error.message === PAPERWORK_STALE_MESSAGE) {
      redirect(`/desk/paperwork/${recordId}`);
    }
    throw error;
  }
  refresh(recordId);
  redirect("/desk/paperwork");
}

export async function updateAdminKindsAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  const kinds = formData.getAll("adminKind").map((v) => String(v));
  await updatePaperworkAdminKinds(session.user.id, kinds);
  refresh();
}
