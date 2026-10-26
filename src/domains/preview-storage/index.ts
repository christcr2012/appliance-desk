import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { getServerSession } from "@/lib/session";

// Preview uses only a private store explicitly configured for this environment.
// Never put its identifier in this public repository or fall back to production.

export type PreviewStorageResult = {
  status: "idle" | "passed" | "error";
  message?: string;
  fixturePath?: string;
  cleanupPending?: boolean;
};

function configuredPreviewPrivateStore(): { token: string; storeId: string } | null {
  const token = process.env.PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN;
  const storeId = process.env.PREVIEW_PRIVATE_BLOB_STORE_ID;
  if (
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "preview" ||
    !token || !storeId ||
    !/^store_[A-Za-z0-9]+$/.test(storeId) ||
    !/^vercel_blob_rw_[A-Za-z0-9]+_\S+$/.test(token) ||
    token.split("_")[3]?.toLowerCase() !== storeId.slice("store_".length).toLowerCase()
  ) return null;
  return { token, storeId };
}

export function previewStorageConfigured(): boolean {
  return configuredPreviewPrivateStore() !== null;
}

/** Owner-only, input-free check. Each invocation owns a new small synthetic
 * file and cleans up exactly that pathname, including uncertain put failures.
 * Provider error text and access URLs are never returned to the browser. */
export async function verifyPreviewPrivateStorage(): Promise<PreviewStorageResult> {
  const session = await getServerSession();
  if (!session || session.user.role !== "OWNER") {
    return { status: "error", message: "Only the owner can run this check." };
  }
  const store = configuredPreviewPrivateStore();
  if (!store) {
    return { status: "error", message: "Verified private preview storage is not configured." };
  }

  const { token } = store;
  const expectedHost = `${store.storeId.slice("store_".length).toLowerCase()}.private.blob.vercel-storage.com`;
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
      url.protocol !== "https:" || url.hostname !== expectedHost ||
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
