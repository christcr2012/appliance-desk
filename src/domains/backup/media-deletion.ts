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
export async function deletePrivatePhotosWithRecovery(
  sourceUrls: string[],
  store: { token: string; storeId: string },
  context: { privacyRequestId?: string; deletedAt?: Date } = {},
): Promise<void> {
  if (sourceUrls.length === 0) return;

  // Validate the complete set before the first external side effect. An invalid
  // record must not let privacy fulfillment delete only some of the files.
  const sources = sourceUrls.map((sourceUrl) => {
    const sourcePath = privatePhotoPathFromUrl(sourceUrl, store.storeId);
    if (!sourcePath) {
      throw new Error(
        "Private photo storage reference is invalid; privacy deletion was not fulfilled.",
      );
    }
    return { sourceUrl, sourcePath };
  });

  const recoveryBlobs = await listAllRecoveryBlobs(store.token);
  const deletedAt = (context.deletedAt ?? new Date()).toISOString();

  // Tombstone every path before deleting any bytes. If a provider call fails
  // afterward, old recovery bytes can remain, but restore is still permanently
  // barred from recreating these paths.
  for (const source of sources) {
    await put(
      privacyDeletionTombstonePath(source.sourcePath),
      JSON.stringify({
        formatVersion: 1,
        sourcePath: source.sourcePath,
        status: "PRIVACY_DELETED",
        deletedAt,
        privacyRequestId: context.privacyRequestId ?? null,
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
  }

  const deleteUrls = new Set(sources.map((source) => source.sourceUrl));
  for (const source of sources) {
    const suffix = `/${source.sourcePath}`;
    for (const blob of recoveryBlobs) {
      if (
        !blob.pathname.startsWith("recovery/tombstones/") &&
        blob.pathname.endsWith(suffix)
      ) {
        deleteUrls.add(blob.url);
      }
    }
  }

  await del([...deleteUrls], {
    token: store.token,
    abortSignal: AbortSignal.timeout(IO_TIMEOUT_MS),
  });
}

export async function deletePrivatePhotoWithRecovery(
  sourceUrl: string,
  store: { token: string; storeId: string },
): Promise<void> {
  await deletePrivatePhotosWithRecovery([sourceUrl], store);
}
