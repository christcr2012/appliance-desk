import { isTestingEnvironment } from "./testing-environment";

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
  return /^(jobs|appliances|maintenance-requests|tax-exemptions|tax-filings|expenses|purchases|bank-statements|accounting-confirmations|feedback)\/[A-Za-z0-9_-]+\/[^/]+$/.test(
    pathname,
  );
}

/**
 * MCP-10a: app-feedback screenshots share the private store but are NEVER Photo records. They are only read through
 * /api/feedback-attachments (owner/admin or the report's own sender). Any address whose path is under feedback/ —
 * whatever the host — is refused as a job/appliance photo and by the general photo read route.
 */
export function isFeedbackPicturePath(value: string): boolean {
  let path = value;
  try {
    path = new URL(value).pathname;
  } catch {
    // not a URL: treat the value itself as a path
  }
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true; // unreadable address: refuse rather than guess
  }
  return /^\/*feedback\//i.test(decoded);
}

export function assertNotFeedbackPicture(url: string): void {
  if (isFeedbackPicturePath(url)) throw new Error("That picture belongs to an app feedback report and can't be attached here.");
}

export function getPublicPhotoWriteToken(): string | null {
  if (isTestingEnvironment()) return null;
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
  if (isTestingEnvironment()) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const storeId = process.env.TEST_PRIVATE_BLOB_STORE_ID;
    if (token && storeId && tokenStoreId(token)?.toLowerCase() === storeId.toLowerCase()) return { token, storeId };
    return null;
  }
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview") {
    const token = process.env.PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN;
    const storeId = process.env.PREVIEW_PRIVATE_BLOB_STORE_ID;
    if (
      token && storeId && /^store_[A-Za-z0-9]+$/.test(storeId) &&
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
