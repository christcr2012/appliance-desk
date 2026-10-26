import { createHash } from "node:crypto";
import { previewToken, verifyToken } from "@/lib/preview-token";
import { applyAnswers, previewAnswers, type AnswerPreview, type ApplyResult, type ParsedAnswer } from "./index";
import { parseQuestionnaire } from "./parse";
import {
  DecisionFileError,
  checkDecisionFile,
  decisionFileStorageReady,
  removeDecisionFile,
  storeDecisionFile,
} from "./attachments";

/**
 * "Import a completed form" (DEC-1b, spec section 7). Owner only (previewAnswers / applyAnswers check it). A Word
 * file is read on the server with mammoth (raw text only — no pictures, no links followed, nothing run); a PDF or
 * a scan is pasted as text. Nothing changes until the owner presses Apply with the preview's confirm token.
 *
 * The completed form is kept in private storage at preview time, because the confirm token binds the answers to that
 * exact file. Its private address goes back to the screen only inside a signed, short-lived handle, so the screen
 * can't swap in a different file.
 */
const MAX_TEXT = 300_000;
const HANDLE = { label: "Form attachment", error: (message: string) => new DecisionFileError(message) };
const HANDLE_MINUTES = 30;

export type ImportPreview = {
  preview: AnswerPreview[];
  confirmToken: string;
  answers: ParsedAnswer[];
  unanswered: string[];
  /** Signed handle for the kept form, or null when no file was uploaded or it couldn't be kept here. */
  attachmentHandle: string | null;
  /** "KEPT", "NO_FILE", or "NOT_KEPT" (no private storage in this environment). */
  file: "KEPT" | "NO_FILE" | "NOT_KEPT";
};

async function docxText(bytes: Uint8Array): Promise<string> {
  checkDecisionFile(bytes, ["docx"]);
  const mammoth = (await import("mammoth")).default;
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value.slice(0, MAX_TEXT);
  } catch {
    throw new DecisionFileError("That Word file couldn't be read. Save it again as .docx, or paste the answers as text.");
  }
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function previewImportedForm(
  actorId: string, input: { file?: Uint8Array | null; text?: string | null },
): Promise<ImportPreview> {
  const file = input.file && input.file.length > 0 ? input.file : null;
  const pasted = typeof input.text === "string" ? input.text : "";
  if (!file && !pasted.trim()) throw new DecisionFileError("Choose the completed Word form, or paste the answers.");
  if (pasted.length > MAX_TEXT) throw new DecisionFileError("That text is too long. Paste only the answers.");
  const text = file ? await docxText(file) : pasted;
  const parsed = parseQuestionnaire(text);
  if (parsed.answers.length === 0) {
    throw new DecisionFileError(parsed.unanswered.length
      ? "No answers were filled in. Tick an answer (or write it on the answer sheet) and try again."
      : "No questions were found. Check that the codes in brackets, like [DQ-IN-35], are still in the text.");
  }
  // First a preview without the file, to know which questions it belongs with.
  let result = await previewAnswers(actorId, parsed.answers);
  let handle: string | null = null;
  let fileState: ImportPreview["file"] = file ? "NOT_KEPT" : "NO_FILE";
  const usable = result.preview.find((row) => row.status !== "INVALID");
  if (file && usable && decisionFileStorageReady()) {
    const url = await storeDecisionFile(usable.code, file, "docx");
    try {
      result = await previewAnswers(actorId, parsed.answers, { attachmentUrl: url });
    } catch (error) {
      await removeDecisionFile(url);
      throw error;
    }
    handle = previewToken({ v: 1, uid: actorId, url, ct: tokenHash(result.confirmToken),
      exp: Date.now() + HANDLE_MINUTES * 60_000 }, HANDLE);
    fileState = "KEPT";
  }
  return { preview: result.preview, confirmToken: result.confirmToken, answers: parsed.answers,
    unanswered: parsed.unanswered, attachmentHandle: handle, file: fileState };
}

function handleUrl(handle: string, actorId: string, confirmToken: string): string {
  const claim = verifyToken(handle, HANDLE) as { v?: unknown; uid?: unknown; url?: unknown; ct?: unknown; exp?: unknown } | null;
  if (!claim || claim.v !== 1 || claim.uid !== actorId || typeof claim.url !== "string" ||
      claim.ct !== tokenHash(confirmToken) || typeof claim.exp !== "number" || claim.exp < Date.now()) {
    throw new DecisionFileError("This preview has expired or isn't yours. Preview the answers again.");
  }
  return claim.url;
}

export async function applyImportedForm(
  actorId: string,
  input: { answers: ParsedAnswer[]; confirmToken: string; attachmentHandle?: string | null },
): Promise<ApplyResult> {
  if (!Array.isArray(input.answers) || typeof input.confirmToken !== "string" || !input.confirmToken) {
    throw new DecisionFileError("Preview the answers again before applying.");
  }
  const attachmentUrl = input.attachmentHandle ? handleUrl(input.attachmentHandle, actorId, input.confirmToken) : null;
  return applyAnswers(actorId, input.answers, input.confirmToken, { via: "IMPORT", attachmentUrl });
}
