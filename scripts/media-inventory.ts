import { createHash } from "node:crypto";
import { copy, del, get, list, put } from "@vercel/blob";
import { businessDateKey } from "../src/lib/business-date";
import { prisma } from "../src/lib/prisma";
import {
  getPrivatePhotoStore,
  privatePhotoPathFromUrl,
} from "../src/lib/photo-storage";
import {
  hasPrivacyDeletionTombstone,
  privacyDeletionTombstonePath,
} from "../src/domains/backup/media-deletion";

const PRIMARY_PREFIXES = ["jobs/", "appliances/", "maintenance-requests/"] as const;
const MEDIA_MANIFEST_SUFFIX = ".media.json";

export type MediaManifestEntry = {
  photoId: string;
  sourceUrl: string;
  sourcePath: string;
  size: number | null;
  sha256: string | null;
  sourceEtag: string | null;
  status: "COPIED" | "UNCHANGED" | "MISSING" | "TOMBSTONED";
  recoveryPath: string | null;
  recoveryUrl: string | null;
};

export type MediaRecoveryManifest = {
  formatVersion: 1;
  generatedAt: string;
  databaseBackupUrl: string;
  entries: MediaManifestEntry[];
  unreferenced: Array<{ pathname: string; url: string; tombstoned: boolean }>;
};

type ListedBlob = {
  pathname: string;
  url: string;
  uploadedAt?: Date;
};

async function listAll(prefix: string, token: string): Promise<ListedBlob[]> {
  const rows: ListedBlob[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    rows.push(...page.blobs);
    if (page.hasMore && !page.cursor) {
      throw new Error(`Blob listing for "${prefix}" reported more rows without a cursor.`);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return rows;
}

function blobPathFromUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com") ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Database backup URL is not a plain Vercel Blob URL.");
  }
  return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
}

async function readPrivateJson<T>(pathnameOrUrl: string, token: string): Promise<T | null> {
  const result = await get(pathnameOrUrl, {
    access: "private",
    token,
    useCache: false,
    abortSignal: AbortSignal.timeout(15_000),
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return JSON.parse(await new Response(result.stream).text()) as T;
}

async function latestPriorManifest(token: string): Promise<MediaRecoveryManifest | null> {
  const manifests = (await listAll("backups/", token))
    .filter((blob) => blob.pathname.endsWith(MEDIA_MANIFEST_SUFFIX))
    .sort((a, b) => {
      const bTime = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      const aTime = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      return bTime - aTime || b.pathname.localeCompare(a.pathname);
    });

  return manifests[0]
    ? readPrivateJson<MediaRecoveryManifest>(manifests[0].pathname, token)
    : null;
}

async function blobExists(pathname: string, token: string): Promise<boolean> {
  const page = await list({ prefix: pathname, token, limit: 1 });
  return page.blobs.some((blob) => blob.pathname === pathname);
}

async function readAndHash(
  urlOrPathname: string,
  token: string,
): Promise<{ size: number; sha256: string; etag: string; contentType: string } | null> {
  const result = await get(urlOrPathname, {
    access: "private",
    token,
    useCache: false,
    abortSignal: AbortSignal.timeout(20_000),
  });
  if (!result || result.statusCode !== 200 || !result.stream || result.blob.size === null) {
    return null;
  }

  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  return {
    size: result.blob.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    etag: result.blob.etag,
    contentType: result.blob.contentType ?? "application/octet-stream",
  };
}

function inventoryCounts(entries: MediaManifestEntry[], unreferenced: number): Record<string, number> {
  const counts = {
    referenced: entries.length,
    copied: 0,
    unchanged: 0,
    missing: 0,
    tombstoned: 0,
    unreferenced,
  };

  for (const entry of entries) {
    if (entry.status === "COPIED") counts.copied += 1;
    else if (entry.status === "UNCHANGED") counts.unchanged += 1;
    else if (entry.status === "MISSING") counts.missing += 1;
    else if (entry.status === "TOMBSTONED") counts.tombstoned += 1;
  }
  return counts;
}

export async function findLatestDatabaseBackupUrl(
  token = process.env.BLOB_READ_WRITE_TOKEN,
): Promise<string> {
  if (!token) throw new Error("Backup Blob storage is unavailable.");

  const backups = (await listAll("backups/", token))
    .filter(
      (blob) =>
        blob.pathname.endsWith(".json") &&
        !blob.pathname.endsWith(MEDIA_MANIFEST_SUFFIX),
    )
    .sort((a, b) => b.pathname.localeCompare(a.pathname));

  if (!backups[0]) throw new Error("No database backup exists for the media inventory.");
  return backups[0].url;
}

export async function runMediaInventoryAndCopy(input: {
  databaseBackupUrl?: string | null;
  now?: Date;
} = {}): Promise<{
  manifest: MediaRecoveryManifest;
  manifestUrl: string;
  counts: Record<string, number>;
}> {
  const store = getPrivatePhotoStore();
  if (!store) {
    throw new Error("Private photo storage is unavailable; media recovery copy was not run.");
  }
  const backupToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!backupToken) {
    throw new Error("Backup Blob storage is unavailable; media recovery manifest was not written.");
  }

  const databaseBackupUrl =
    input.databaseBackupUrl ?? (await findLatestDatabaseBackupUrl(backupToken));
  const backupPath = blobPathFromUrl(databaseBackupUrl);
  if (!backupPath.startsWith("backups/") || backupPath.endsWith(MEDIA_MANIFEST_SUFFIX)) {
    throw new Error("Media inventory requires a database backup under backups/.");
  }

  const now = input.now ?? new Date();
  const previous = await latestPriorManifest(backupToken);
  const previousByPath = new Map(
    (previous?.entries ?? [])
      .filter((entry) => entry.sha256 && entry.recoveryPath && entry.recoveryUrl)
      .map((entry) => [entry.sourcePath, entry]),
  );

  const tombstones = new Set(
    (await listAll("recovery/tombstones/", store.token)).map((blob) => blob.pathname),
  );

  const photos = await prisma.photo.findMany({
    select: { id: true, url: true },
    orderBy: { id: "asc" },
  });
  const referencedPaths = new Set<string>();
  const entries: MediaManifestEntry[] = [];

  for (const photo of photos) {
    const sourcePath = privatePhotoPathFromUrl(photo.url, store.storeId);
    if (!sourcePath) {
      throw new Error(`Photo ${photo.id} does not point at the configured private photo store.`);
    }
    referencedPaths.add(sourcePath);

    if (tombstones.has(privacyDeletionTombstonePath(sourcePath))) {
      entries.push({
        photoId: photo.id,
        sourceUrl: photo.url,
        sourcePath,
        size: null,
        sha256: null,
        sourceEtag: null,
        status: "TOMBSTONED",
        recoveryPath: null,
        recoveryUrl: null,
      });
      continue;
    }

    const source = await readAndHash(photo.url, store.token);
    if (!source) {
      if (await hasPrivacyDeletionTombstone(sourcePath, store.token)) {
        entries.push({
          photoId: photo.id,
          sourceUrl: photo.url,
          sourcePath,
          size: null,
          sha256: null,
          sourceEtag: null,
          status: "TOMBSTONED",
          recoveryPath: null,
          recoveryUrl: null,
        });
      } else {
        entries.push({
          photoId: photo.id,
          sourceUrl: photo.url,
          sourcePath,
          size: null,
          sha256: null,
          sourceEtag: null,
          status: "MISSING",
          recoveryPath: null,
          recoveryUrl: null,
        });
      }
      continue;
    }

    const prior = previousByPath.get(sourcePath);
    if (
      prior?.sha256 === source.sha256 &&
      prior.recoveryPath &&
      prior.recoveryUrl &&
      (await blobExists(prior.recoveryPath, store.token))
    ) {
      entries.push({
        photoId: photo.id,
        sourceUrl: photo.url,
        sourcePath,
        size: source.size,
        sha256: source.sha256,
        sourceEtag: source.etag,
        status: "UNCHANGED",
        recoveryPath: prior.recoveryPath,
        recoveryUrl: prior.recoveryUrl,
      });
      continue;
    }

    // The hash is part of the path so a changed photo can never overwrite the
    // bytes paired with an older database backup from the same month.
    const recoveryPath = `recovery/${businessDateKey(now).slice(0, 7)}/${source.sha256}/${sourcePath}`;
    const recovered = await copy(photo.url, recoveryPath, {
      access: "private",
      token: store.token,
      contentType: source.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      ifMatch: source.etag,
      abortSignal: AbortSignal.timeout(20_000),
    });
    const verifiedCopy = await readAndHash(recovered.url, store.token);
    if (
      !verifiedCopy ||
      verifiedCopy.sha256 !== source.sha256 ||
      verifiedCopy.size !== source.size
    ) {
      throw new Error(`Recovery copy verification failed for "${sourcePath}".`);
    }
    // Privacy deletion may race with inventory after the initial tombstone
    // listing. If a tombstone appeared, discard the just-selected recovery copy
    // and record intentional deletion rather than recoverable media.
    if (await hasPrivacyDeletionTombstone(sourcePath, store.token)) {
      await del(recovered.url, {
        token: store.token,
        abortSignal: AbortSignal.timeout(15_000),
      });
      entries.push({
        photoId: photo.id,
        sourceUrl: photo.url,
        sourcePath,
        size: null,
        sha256: null,
        sourceEtag: null,
        status: "TOMBSTONED",
        recoveryPath: null,
        recoveryUrl: null,
      });
      continue;
    }

    entries.push({
      photoId: photo.id,
      sourceUrl: photo.url,
      sourcePath,
      size: source.size,
      sha256: source.sha256,
      sourceEtag: source.etag,
      status: "COPIED",
      recoveryPath: recovered.pathname,
      recoveryUrl: recovered.url,
    });
  }

  const unreferenced: MediaRecoveryManifest["unreferenced"] = [];
  for (const prefix of PRIMARY_PREFIXES) {
    for (const blob of await listAll(prefix, store.token)) {
      if (referencedPaths.has(blob.pathname)) continue;
      unreferenced.push({
        pathname: blob.pathname,
        url: blob.url,
        tombstoned: tombstones.has(privacyDeletionTombstonePath(blob.pathname)),
      });
    }
  }
  unreferenced.sort((a, b) => a.pathname.localeCompare(b.pathname));

  const manifest: MediaRecoveryManifest = {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    databaseBackupUrl,
    entries,
    unreferenced,
  };
  const manifestPath = `${backupPath}${MEDIA_MANIFEST_SUFFIX}`;
  const written = await put(manifestPath, JSON.stringify(manifest), {
    access: "private",
    token: backupToken,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  const counts = inventoryCounts(entries, unreferenced.length);
  if (counts.missing > 0) {
    throw new Error(
      `Media inventory found ${counts.missing} referenced private object(s) missing. Review the paired media manifest.`,
    );
  }
  return { manifest, manifestUrl: written.url, counts };
}

export async function restoreMediaFromManifest(
  manifestUrl: string,
): Promise<{ restored: number; alreadyPresent: number; skippedTombstoned: number }> {
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Private photo storage is unavailable.");
  const backupToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!backupToken) throw new Error("Backup Blob storage is unavailable.");

  const manifest = await readPrivateJson<MediaRecoveryManifest>(manifestUrl, backupToken);
  if (!manifest || manifest.formatVersion !== 1) {
    throw new Error("Media recovery manifest is invalid.");
  }

  let restored = 0;
  let alreadyPresent = 0;
  let skippedTombstoned = 0;

  for (const entry of manifest.entries) {
    if (!entry.recoveryUrl || !entry.sha256 || entry.size === null) continue;

    // This check is intentionally live, not just the manifest's historical
    // status: a privacy deletion may have happened after this backup.
    if (await hasPrivacyDeletionTombstone(entry.sourcePath, store.token)) {
      skippedTombstoned += 1;
      continue;
    }

    const primary = await readAndHash(entry.sourceUrl, store.token);
    if (primary) {
      if (primary.sha256 !== entry.sha256 || primary.size !== entry.size) {
        throw new Error(
          `Primary object "${entry.sourcePath}" exists but differs from this recovery manifest; refusing to overwrite it.`,
        );
      }
      if (await hasPrivacyDeletionTombstone(entry.sourcePath, store.token)) {
        await del(entry.sourcePath, {
          token: store.token,
          abortSignal: AbortSignal.timeout(15_000),
        });
        skippedTombstoned += 1;
      } else {
        alreadyPresent += 1;
      }
      continue;
    }

    const recovery = await readAndHash(entry.recoveryUrl, store.token);
    if (
      !recovery ||
      recovery.sha256 !== entry.sha256 ||
      recovery.size !== entry.size
    ) {
      throw new Error(`Recovery copy hash mismatch for "${entry.sourcePath}".`);
    }

    await copy(entry.recoveryUrl, entry.sourcePath, {
      access: "private",
      token: store.token,
      contentType: recovery.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      ifMatch: recovery.etag,
      abortSignal: AbortSignal.timeout(20_000),
    });

    // A privacy deletion can begin between the pre-copy tombstone check and
    // this copy. Remove the just-restored object if that happened.
    if (await hasPrivacyDeletionTombstone(entry.sourcePath, store.token)) {
      await del(entry.sourcePath, {
        token: store.token,
        abortSignal: AbortSignal.timeout(15_000),
      });
      skippedTombstoned += 1;
      continue;
    }

    const restoredPrimary = await readAndHash(entry.sourcePath, store.token);
    if (
      !restoredPrimary ||
      restoredPrimary.sha256 !== entry.sha256 ||
      restoredPrimary.size !== entry.size
    ) {
      throw new Error(`Restored primary object "${entry.sourcePath}" failed hash verification.`);
    }
    restored += 1;
  }

  return { restored, alreadyPresent, skippedTombstoned };
}

export async function verifyMediaRecoverySample(
  manifestUrl: string,
  sampleSize = 3,
): Promise<{ checked: number; skippedTombstoned: number }> {
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Private photo storage is unavailable.");
  const backupToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!backupToken) throw new Error("Backup Blob storage is unavailable.");

  const manifest = await readPrivateJson<MediaRecoveryManifest>(manifestUrl, backupToken);
  if (!manifest || manifest.formatVersion !== 1) {
    throw new Error("Media recovery manifest is invalid.");
  }

  let checked = 0;
  let skippedTombstoned = 0;
  const wanted = Math.max(0, sampleSize);
  for (const entry of manifest.entries) {
    if (checked >= wanted) break;
    if (!entry.recoveryUrl || !entry.sha256 || entry.size === null) continue;

    if (await hasPrivacyDeletionTombstone(entry.sourcePath, store.token)) {
      skippedTombstoned += 1;
      continue;
    }

    const recovered = await readAndHash(entry.recoveryUrl, store.token);
    if (
      !recovered ||
      recovered.sha256 !== entry.sha256 ||
      recovered.size !== entry.size
    ) {
      throw new Error(`Recovery copy hash mismatch for "${entry.sourcePath}".`);
    }
    checked += 1;
  }

  return { checked, skippedTombstoned };
}

async function cli(): Promise<void> {
  const [command, manifestUrl, third, fourth, ...extra] = process.argv.slice(2);
  if (!manifestUrl || !["verify", "restore"].includes(command ?? "") || extra.length > 0) {
    throw new Error(
      "Usage: npx tsx scripts/media-inventory.ts verify <media-manifest-url> [sample-count]\n" +
        "   or: npx tsx scripts/media-inventory.ts restore <media-manifest-url> --confirm RESTORE",
    );
  }

  if (command === "restore") {
    if (third !== "--confirm" || fourth !== "RESTORE") {
      throw new Error("Media restore requires the explicit arguments --confirm RESTORE.");
    }
    const result = await restoreMediaFromManifest(manifestUrl);
    console.log(
      `Media restore passed (${result.restored} restored, ${result.alreadyPresent} already present, ${result.skippedTombstoned} privacy-tombstoned skipped).`,
    );
    return;
  }

  if (fourth !== undefined) {
    throw new Error("The verify command accepts only one optional sample count.");
  }
  const sampleSize = third === undefined ? 3 : Number(third);
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new Error("sample-count must be a non-negative integer.");
  }

  const result = await verifyMediaRecoverySample(manifestUrl, sampleSize);
  console.log(
    `Media recovery verification passed (${result.checked} checked, ${result.skippedTombstoned} tombstoned skipped).`,
  );
}

if (process.argv[1]?.endsWith("media-inventory.ts")) {
  cli()
    .catch((error) => {
      console.error(
        "[media-recovery] FAILED:",
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
