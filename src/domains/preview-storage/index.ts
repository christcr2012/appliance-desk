import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { getServerSession } from "@/lib/session";

// Verified independent private store, created and connected to Preview only
// with owner approval on 2026-10-01. Never fall back to the production token.
export const PREVIEW_PRIVATE_STORE_ID = "store_6Sttks2ULJ8wG5hl";
const PRIVATE_HOST = "6sttks2ulj8wg5hl.private.blob.vercel-storage.com";

export type PreviewStorageResult = {
  status: "idle" | "passed" | "error";
  message?: string;
  fixturePath?: string;
  cleanupPending?: boolean;
};

export function previewStorageConfigured(): boolean {
  const token = process.env.PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN;
  return (
    process.env.VERCEL === "1" &&
    process.env.VERCEL_ENV === "preview" &&
    process.env.PREVIEW_PRIVATE_BLOB_STORE_ID === PREVIEW_PRIVATE_STORE_ID &&
    /^vercel_blob_rw_[^_]+_\S+$/.test(token ?? "") &&
    token?.split("_")[3]?.toLowerCase() ===
      PREVIEW_PRIVATE_STORE_ID.slice("store_".length).toLowerCase()
  );
}

/** Owner-only, input-free check. Each invocation owns a new small synthetic
 * file and cleans up exactly that pathname, including uncertain put failures.
 * Provider error text and access URLs are never returned to the browser. */
export async function verifyPreviewPrivateStorage(): Promise<PreviewStorageResult> {
  const session = await getServerSession();
  if (!session || session.user.role !== "OWNER") {
    return { status: "error", message: "Only the owner can run this check." };
  }
  if (!previewStorageConfigured()) {
    return { status: "error", message: "Verified private preview storage is not configured." };
  }

  const token = process.env.PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN!;
  const fixturePath = `preview-checks/${randomUUID()}.txt`;
  const content = `Appliance Desk synthetic preview storage check\n${fixturePath}\n`;
  const options = { token, abortSignal: AbortSignal.timeout(15_000) };
  let passed = false;
  let cleaned = false;
  try {
    const blob = await put(fixturePath, content, {
      ...options,
      access: "private",
      contentType: "text/plain",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    const url = new URL(blob.url);
    if (
      url.protocol !== "https:" || url.hostname !== PRIVATE_HOST ||
      url.pathname !== `/${fixturePath}` || url.search || url.hash ||
      url.username || url.password || url.port || blob.pathname !== fixturePath
    ) throw new Error("Unexpected storage target.");

    const read = await get(fixturePath, { ...options, access: "private", useCache: false });
    if (!read || read.statusCode !== 200 || read.blob.pathname !== fixturePath ||
      (await new Response(read.stream).text()) !== content) {
      throw new Error("Private read did not match.");
    }
    // No cookies, authorization header, signature, token or delegated URL.
    const anonymous = await fetch(blob.url, {
      cache: "no-store", redirect: "error", credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    });
    await anonymous.body?.cancel();
    passed = anonymous.status === 403;
  } catch {
    passed = false;
  } finally {
    try {
      await del(fixturePath, { token, abortSignal: AbortSignal.timeout(15_000) });
      cleaned = (await get(fixturePath, {
        token, access: "private", useCache: false,
        abortSignal: AbortSignal.timeout(10_000),
      })) === null;
    } catch {
      cleaned = false;
    }
  }
  if (!cleaned) {
    return { status: "error", fixturePath, cleanupPending: true,
      message: "Cleanup could not be verified. Keep this file name for follow-up; do not run another check yet." };
  }
  return passed
    ? { status: "passed", fixturePath,
        message: "Private write and read passed. Access without a token was refused. The test file was removed." }
    : { status: "error", fixturePath,
        message: "The storage check failed. The test file was removed." };
}
