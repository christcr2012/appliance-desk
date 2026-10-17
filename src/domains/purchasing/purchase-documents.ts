import { head } from "@vercel/blob";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";

/**
 * Receipts and invoices are private finance evidence (owner/admin only). The browser uploads each
 * page straight to private storage under `purchases/<folder>/<file>`; the folder is the form's random
 * draft key for a new purchase, or the purchase id when pages are added later. Nothing is trusted
 * until the exact object is confirmed in the configured private store, before any database lock.
 */

export const MAX_PURCHASE_DOCUMENTS = 12;
export const PURCHASE_FOLDER_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

export function purchaseUploadPrefix(folder: string): string {
  if (!PURCHASE_FOLDER_PATTERN.test(folder)) throw new Error("Invalid receipt upload folder.");
  return `purchases/${folder}`;
}

/** Throws a plain-English error unless every URL is a real private upload inside `purchases/<folder>/`. */
export async function verifyPurchaseUploads(folder: string, urls: readonly string[]): Promise<void> {
  if (!urls.length) return;
  const prefix = purchaseUploadPrefix(folder) + "/";
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Private receipt storage is not set up here, so receipts cannot be attached yet.");
  for (const url of urls) {
    const path = privatePhotoPathFromUrl(url, store.storeId);
    if (!path?.startsWith(prefix)) {
      throw new Error("Choose a receipt you uploaded for this purchase.");
    }
    try {
      const blob = await head(url, { token: store.token });
      if (!blob || blob.url !== url || blob.pathname !== path || blob.size <= 0) {
        throw new Error("missing");
      }
    } catch {
      throw new Error("A receipt page could not be verified in private storage. Upload it again before saving.");
    }
  }
}

/** True when a stored receipt URL is a purchase upload in the trusted private store (used when re-reading). */
export function isStoredPurchaseUpload(url: string): boolean {
  const store = getPrivatePhotoStore();
  const path = store ? privatePhotoPathFromUrl(url, store.storeId) : null;
  return !!path && path.startsWith("purchases/");
}
