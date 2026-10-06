import { createHash } from "node:crypto";
import { del, list, put } from "@vercel/blob";
const VERIFIED_PREVIEW_PRIVATE_STORE_ID = "store_6Sttks2ULJ8wG5hl";

function tokenStoreId(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split("_");
  if (parts.length < 5 || parts[0] !== "vercel" || parts[1] !== "blob" || parts[2] !== "rw") {
    return null;
  }
  return parts[3] ? `store_${parts[3]}` : null;
}

/** Catalog/appliance-type imagery is intentionally public marketing media. */
export function isPublicPhotoPath(pathname: string): boolean {
  return /^appliance-types\/[^/]+$/.test(pathname);
}

/** Every persisted operational/customer evidence path is private. */
export function isPrivatePhotoPath(pathname: string): boolean {
  return /^(jobs|appliances|maintenance-requests)\/[A-Za-z0-9_-]+\/[^/]+$/.test(
    pathname,
  );
}

export function getPublicPhotoWriteToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN ?? null;
}

/**
 * Return only an explicitly configured private-store credential.
 *
 * Preview has a previously verified independent private store. Production uses
 * a separate, intentionally named credential so the public catalog store can
 * never be selected by accident. Missing configuration fails closed.
 */
export function getPrivatePhotoStore():
  | { token: string; storeId: string }
  | null {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview") {
    const token = process.env.PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN;
    const storeId = process.env.PREVIEW_PRIVATE_BLOB_STORE_ID;
    if (
      storeId === VERIFIED_PREVIEW_PRIVATE_STORE_ID &&
      tokenStoreId(token)?.toLowerCase() === storeId.toLowerCase()
    ) {
      return { token: token!, storeId };
    }
    return null;
  }

  const token = process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN;
  const storeId = process.env.PRIVATE_PHOTO_BLOB_STORE_ID;
  if (
    token &&
    storeId &&
    /^store_[A-Za-z0-9]+$/.test(storeId) &&
    tokenStoreId(token)?.toLowerCase() === storeId.toLowerCase()
  ) {
    return { token, storeId };
  }

  return null;
}

export function privatePhotoReadPath(photoId: string): string {
  return `/api/photos/${encodeURIComponent(photoId)}`;
}


export function privatePhotoPathFromUrl(value: string, storeId: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const expectedHost = `${storeId.slice("store_".length).toLowerCase()}.private.blob.vercel-storage.com`;
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== expectedHost ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  return isPrivatePhotoPath(pathname) ? pathname : null;
}

export function privacyDeletionTombstonePath(sourcePath: string): string {
  const digest = createHash("sha256").update(sourcePath).digest("hex");
  return `recovery/tombstones/${digest}.json`;
}

async function listAllPrivateBlobs(
  prefix: string,
  token: string,
): Promise<Array<{ pathname: string; url: string }>> {
  const rows: Array<{ pathname: string; url: string }> = [];
  let cursor: string | undefined;

  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    rows.push(...page.blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return rows;
}

export async function hasPrivacyDeletionTombstone(
  sourcePath: string,
  token: string,
): Promise<boolean> {
  const pathname = privacyDeletionTombstonePath(sourcePath);
  const page = await list({ prefix: pathname, token, limit: 1 });
  return page.blobs.some((blob) => blob.pathname === pathname);
}

/**
 * Make privacy deletion recovery-safe.
 *
 * The tombstone is deterministic and idempotent, so retries may overwrite the
 * same evidence without changing its meaning. It is written before any byte is
 * deleted; therefore a recovery copy that races after our listing is still
 * permanently barred from later restore.
 */
export async function deletePrivatePhotoWithRecovery(
  sourceUrl: string,
  store: { token: string; storeId: string },
): Promise<void> {
  const sourcePath = privatePhotoPathFromUrl(sourceUrl, store.storeId);
  if (!sourcePath) {
    throw new Error("Private photo storage reference is invalid; privacy deletion was not fulfilled.");
  }

  await put(
    privacyDeletionTombstonePath(sourcePath),
    JSON.stringify({ formatVersion: 1, sourcePath, status: "PRIVACY_DELETED" }),
    {
      access: "private",
      token: store.token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );

  const suffix = `/${sourcePath}`;
  const recoveryUrls = (await listAllPrivateBlobs("recovery/", store.token))
    .filter((blob) => !blob.pathname.startsWith("recovery/tombstones/"))
    .filter((blob) => blob.pathname.endsWith(suffix))
    .map((blob) => blob.url);

  await del([sourceUrl, ...recoveryUrls], { token: store.token });
}
