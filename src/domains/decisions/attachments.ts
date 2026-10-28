import { del, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { decisionAttachmentProblem } from "./rules";
import { decisionSubject } from "./registry";

/**
 * Completed professional forms kept with their answers (DEC-1b). Owner-only uploads: the server reads the file itself
 * and decides its type from its first bytes (a PDF or a Word .docx), never from the name or the browser's claim; at
 * most 4 MB; stored only in the private store under decisions/{question}/ with a random suffix. They are read back
 * only through /api/desk/decisions/attachments/{record} by the owner or an admin.
 */
export const MAX_DECISION_FILE_BYTES = 4 * 1024 * 1024;
/** A .docx is a zip: refuse ones that would unpack to more than this (a "zip bomb") or have too many parts. */
const MAX_DOCX_UNPACKED_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2000;

export type DecisionFileKind = "pdf" | "docx";
export const DECISION_FILE_TYPES: Record<DecisionFileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export class DecisionFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionFileError";
  }
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** The names inside a zip, read from its central directory; null when it isn't a readable, reasonable zip. */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) return null;
  // End of central directory: the last 22 bytes plus up to 65,535 bytes of comment.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (u32(bytes, at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) return null;
  const count = u16(bytes, end + 10);
  const size = u32(bytes, end + 12);
  const offset = u32(bytes, end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null; // zip64: not a normal Word file
  if (count > MAX_DOCX_ENTRIES || offset + size > end) return null;
  const names: string[] = [];
  let unpacked = 0;
  let at = offset;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || u32(bytes, at) !== 0x02014b50) return null;
    unpacked += u32(bytes, at + 24);
    if (unpacked > MAX_DOCX_UNPACKED_BYTES) return null;
    const nameLength = u16(bytes, at + 28);
    const extra = u16(bytes, at + 30);
    const comment = u16(bytes, at + 32);
    if (at + 46 + nameLength > end) return null;
    names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extra + comment;
  }
  return names;
}

/** What the file really is, from its content: a PDF, a Word .docx, or neither (null). */
export function sniffDecisionFile(bytes: Uint8Array): DecisionFileKind | null {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return "pdf";
  const names = zipEntryNames(bytes);
  if (names && names.includes("[Content_Types].xml") && names.includes("word/document.xml")) return "docx";
  return null;
}

/** Checks a chosen file before anything is stored. Returns its kind; throws a plain message otherwise. */
export function checkDecisionFile(bytes: Uint8Array, allowed: DecisionFileKind[]): DecisionFileKind {
  if (bytes.length === 0) throw new DecisionFileError("That file is empty.");
  if (bytes.length > MAX_DECISION_FILE_BYTES) throw new DecisionFileError("Choose a file of 4 MB or less.");
  const kind = sniffDecisionFile(bytes);
  if (!kind || !allowed.includes(kind)) {
    throw new DecisionFileError(allowed.length === 1 && allowed[0] === "docx"
      ? "Choose the completed Word (.docx) form. For a PDF or a scan, paste the answers as text instead."
      : "Choose a PDF or a Word (.docx) file.");
  }
  return kind;
}

/** True when this environment has the private store (CI and some previews don't). */
export function decisionFileStorageReady(): boolean {
  return getPrivatePhotoStore() !== null;
}

/** Stores a checked file under decisions/{subjectId}/ in the private store; returns its private address. */
export async function storeDecisionFile(subjectId: string, bytes: Uint8Array, kind: DecisionFileKind): Promise<string> {
  if (!/^[A-Z0-9-]+$/.test(subjectId)) throw new DecisionFileError("That question isn't in Decisions & reviews.");
  const store = getPrivatePhotoStore();
  if (!store) throw new DecisionFileError("File storage isn't set up here, so the completed form can't be kept.");
  const stored = await put(`decisions/${subjectId}/completed-form.${kind}`, Buffer.from(bytes), {
    token: store.token, access: "private", contentType: DECISION_FILE_TYPES[kind], addRandomSuffix: true,
    abortSignal: AbortSignal.timeout(15_000),
  });
  if (decisionAttachmentProblem(stored.url, store.storeId, subjectId)) {
    await removeDecisionFile(stored.url);
    throw new DecisionFileError("The completed form couldn't be stored. Try again.");
  }
  return stored.url;
}

/** Removes a file stored for an answer that was then refused (best effort; never throws). */
export async function removeDecisionFile(url: string): Promise<void> {
  const store = getPrivatePhotoStore();
  if (!store) return;
  try {
    await del(url, { token: store.token, abortSignal: AbortSignal.timeout(15_000) });
  } catch {
    // A leftover private file is harmless; the answer that would have used it was not saved.
  }
}

/** The stored form for a decision record, for the owner or an admin; null when there is none (or not theirs to see). */
export async function decisionAttachmentForViewer(
  actorId: string, recordId: string,
): Promise<{ pathname: string; kind: DecisionFileKind } | null> {
  if (!/^[a-z0-9]{10,40}$/i.test(recordId)) return null;
  const store = getPrivatePhotoStore();
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN", "ACCOUNTANT"]);
    const record = await tx.decisionRecord.findUnique({ where: { id: recordId }, select: { subjectId: true, attachmentUrl: true } });
    if (!record?.attachmentUrl || !store) return null;
    // ACCT-1: an accountant may only fetch a form kept with a CPA question — the same audience rule
    // their decision list follows (the latest send decides, else the question's own audience).
    if (actor.role === "ACCOUNTANT") {
      const subject = decisionSubject(record.subjectId);
      if (!subject) return null;
      const last = await tx.decisionRecord.findFirst({
        where: { subjectId: record.subjectId }, select: { kind: true, audience: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const audience = last?.kind === "SENT_TO_PROFESSIONAL" && ["OWNER", "CPA", "ATTORNEY", "TRANSLATOR"].includes(last.audience)
        ? last.audience : subject.audience;
      if (audience !== "CPA") return null;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(record.attachmentUrl).pathname.replace(/^\/+/, ""));
    } catch {
      return null;
    }
    // One imported form is kept with every answer it produced, so it may sit in another question's folder.
    const folder = /^decisions\/([A-Z0-9-]+)\/[^/]+$/.exec(pathname)?.[1];
    if (!folder || decisionAttachmentProblem(record.attachmentUrl, store.storeId, folder)) return null;
    return { pathname, kind: pathname.endsWith(".pdf") ? "pdf" : "docx" };
  });
}
