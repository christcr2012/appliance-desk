import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { applyImportedForm, previewImportedForm } from "@/domains/decisions/import";
import { decisionErrorMessage } from "@/domains/decisions/messages";
import { MAX_DECISION_FILE_BYTES } from "@/domains/decisions/attachments";
import type { ParsedAnswer } from "@/domains/decisions";
import { NO_STORE, guardDecisionRequest, jsonError } from "../guard";

export const runtime = "nodejs";

/**
 * DEC-1b "Import a completed form". Owner only.
 * - multipart (file = completed .docx, or text = pasted answers) → the preview table and its confirm token.
 * - JSON { answers, confirmToken, attachmentHandle } → applies exactly what was previewed (or refuses).
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await guardDecisionRequest(request, ["OWNER"], { write: true });
  if (!guard.ok) return guard.response;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_DECISION_FILE_BYTES + 400_000) {
    return jsonError("Choose a file of 4 MB or less.", 413);
  }
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("application/json")) {
      const body = await request.json() as { answers?: unknown; confirmToken?: unknown; attachmentHandle?: unknown };
      const result = await applyImportedForm(guard.userId, {
        answers: Array.isArray(body.answers) ? body.answers as ParsedAnswer[] : [],
        confirmToken: typeof body.confirmToken === "string" ? body.confirmToken : "",
        attachmentHandle: typeof body.attachmentHandle === "string" ? body.attachmentHandle : null,
      });
      revalidatePath("/desk/settings/decisions");
      return NextResponse.json(result, { headers: NO_STORE });
    }
    const form = await request.formData();
    const file = form.get("file");
    const text = form.get("text");
    const bytes = file instanceof File && file.size > 0
      ? (file.size > MAX_DECISION_FILE_BYTES ? null : new Uint8Array(await file.arrayBuffer()))
      : undefined;
    if (bytes === null) return jsonError("Choose a file of 4 MB or less.", 413);
    const preview = await previewImportedForm(guard.userId, {
      file: bytes ?? null,
      text: bytes ? null : typeof text === "string" ? text : null,
    });
    return NextResponse.json(preview, { headers: NO_STORE });
  } catch (error) {
    return jsonError(decisionErrorMessage(error, "That form couldn't be read. Try again."), 400);
  }
}
