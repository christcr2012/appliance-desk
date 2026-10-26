import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { recordProfessionalAnswer } from "@/domains/decisions";
import { decisionSubject } from "@/domains/decisions/registry";
import { decisionErrorMessage } from "@/domains/decisions/messages";
import {
  DecisionFileError,
  MAX_DECISION_FILE_BYTES,
  checkDecisionFile,
  decisionFileStorageReady,
  removeDecisionFile,
  storeDecisionFile,
} from "@/domains/decisions/attachments";
import { NO_STORE, guardDecisionRequest, jsonError } from "../guard";

export const runtime = "nodejs";

/**
 * DEC-1b "Enter their answer…": the professional's answer, optionally with their completed form (PDF or .docx,
 * checked by content, at most 4 MB, kept in private storage under decisions/{question}/). Owner only. If the answer
 * is refused, the file just stored is removed again.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await guardDecisionRequest(request, ["OWNER"], { write: true });
  if (!guard.ok) return guard.response;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_DECISION_FILE_BYTES + 64_000) {
    return jsonError("Choose a file of 4 MB or less.", 413);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("That form couldn't be read. Try again.", 400);
  }
  const text = (name: string, max: number) => {
    const value = form.get(name);
    return typeof value === "string" ? value.slice(0, max).trim() : "";
  };
  const subject = decisionSubject(text("id", 120));
  if (!subject) return jsonError("That question isn't in Decisions & reviews.", 400);
  const choice = text("option", 8);
  const index = Number(choice);
  const option = choice === "OTHER" ? null : Number.isInteger(index) ? subject.options[index] : undefined;
  if (option === undefined) return jsonError("Choose their answer.", 400);

  const file = form.get("file");
  let bytes: Uint8Array | null = null;
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_DECISION_FILE_BYTES) throw new DecisionFileError("Choose a file of 4 MB or less.");
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    const kind = bytes ? checkDecisionFile(bytes, ["pdf", "docx"]) : null;
    const keep = bytes && kind && decisionFileStorageReady();
    const attachmentUrl = keep ? await storeDecisionFile(subject.id, bytes!, kind!) : null;
    try {
      await recordProfessionalAnswer(guard.userId, subject.id, {
        value: option ? option.value : null,
        otherText: option ? null : text("otherText", 1000) || null,
        effectiveFrom: text("effectiveFrom", 10) || null,
        professionalName: text("professionalName", 200),
        professionalFirm: text("professionalFirm", 200) || null,
        answeredOn: text("answeredOn", 10),
        explanation: text("explanation", 4000) || null,
        attachmentUrl,
      }, "SCREEN");
    } catch (error) {
      if (attachmentUrl) await removeDecisionFile(attachmentUrl);
      throw error;
    }
    revalidatePath("/desk/settings/decisions");
    return NextResponse.json({
      ok: true,
      message: bytes && !attachmentUrl
        ? "Their answer was saved, but the form couldn't be kept because file storage isn't set up here."
        : "Their answer was saved.",
    }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(decisionErrorMessage(error), 400);
  }
}
