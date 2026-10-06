import { createHash } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import { privatePhotoPathFromUrl } from "@/lib/photo-storage";

const IO_TIMEOUT_MS = 15_000;

export function privacyDeletionTombstonePath(sourcePath: string): string {
  const digest = createHash("sha256").update(sourcePath).digest("hex");
  return `recovery/tombstones/${digest}.json`;
}

async function listAllRecoveryBlobs(
  token: string,
): Promise<Array<{ pathname: string; url: string }>> {
  const rows: Array<{ pathname: string; url: string }> = [];
  let cursor: string | undefined;

  do {
    const page = await list({
      prefix: "recovery/",
      token,
      cursor,
      limit: 1000,
      abortSignal: AbortSignal.timeout(IO_TIMEOUT_MS),
    });
    rows.push(...page.blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url })));
    if (page.hasMore && !page.cursor) {
      throw new Error("Private recovery listing reported more rows without a cursor.");
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return rows;
}

export async function hasPrivacyDeletionTombstone(
  sourcePath: string,
  token: string,
): Promise<boolean> {
  const pathname = privacyDeletionTombstonePath(sourcePath);
  const page = await list({
    prefix: pathname,
    token,
    limit: 1,
    abortSignal: AbortSignal.timeout(IO_TIMEOUT_MS),
  });
  return page.blobs.some((blob) => blob.pathname === pathname);
}

/**
 * Write a durable tombstone before removing bytes. Recovery always treats the
 * tombstone as authoritative, so a racing or historical recovery copy can
 * never resurrect customer media after privacy fulfillment.
 */
export async function deletePrivatePhotoWithRecovery(
  sourceUrl: string,
  store: { token: string; storeId: string },
): Promise<void> {
  const sourcePath = privatePhotoPathFromUrl(sourceUrl, store.storeId);
  if (!sourcePath) {
    throw new Error("Private photo storage reference is invalid; privacy deletion was not fulfilled.");
  }

  const tombstonePath = privacyDeletionTombstonePath(sourcePath);
  await put(
    tombstonePath,
    JSON.stringify({
      formatVersion: 1,
      sourcePath,
      status: "PRIVACY_DELETED",
      deletedAt: new Date().toISOString(),
    }),
    {
      access: "private",
      token: store.token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      abortSignal: AbortSignal.timeout(IO_TIMEOUT_MS),
    },
  );

  const suffix = `/${sourcePath}`;
  const recoveryUrls = (await listAllRecoveryBlobs(store.token))
    .filter((blob) => !blob.pathname.startsWith("recovery/tombstones/"))
    .filter((blob) => blob.pathname.endsWith(suffix))
    .map((blob) => blob.url);

  await del([sourceUrl, ...recoveryUrls], {
    token: store.token,
    abortSignal: AbortSignal.timeout(IO_TIMEOUT_MS),
  });
}
