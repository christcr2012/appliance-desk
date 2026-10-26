import { createHash } from "node:crypto";
import { AutomationFailure } from "@/domains/automation/failures";
import { backupDigest, verifyBackupReadback } from "./artifacts";
import { copy, get, list, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import {
  getPrivatePhotoStore,
  getBackupStore,
  checkPrivateStoreReady,
  privatePhotoPathFromUrl,
} from "@/lib/photo-storage";
import {
  privacyDeletionTombstonePath,
  hasPrivacyDeletionTombstone,
} from "@/domains/backup/media-deletion";
import { privateBlobUrl } from "@/domains/feedback/media";

const PRIMARY_PREFIXES = ["jobs/", "appliances/", "maintenance-requests/", "feedback/"] as const;
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
  token = getBackupStore()?.token,
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
  databaseArtifactId?: string;
  databaseBackupUrl?: string | null;
  now?: Date;
} = {}): Promise<{
  manifest: MediaRecoveryManifest;
  manifestUrl: string;
  counts: Record<string, number>;
}> {
  const store = getPrivatePhotoStore();
  if (!store || (await checkPrivateStoreReady()) !== "READY") {
    throw new AutomationFailure("MEDIA_STORE_NOT_READY", "media-copy");
  }
  const backupToken = getBackupStore()?.token;
  if (!backupToken) {
    throw new Error("Backup Blob storage is unavailable; media recovery manifest was not written.");
  }

  if (!input.databaseArtifactId) throw new AutomationFailure("BACKUP_CAPTURE", "media-pair");
  const artifact = await prisma.backupArtifact.findUnique({ where: { id: input.databaseArtifactId } });
  if (!artifact || artifact.kind !== "DATABASE" || artifact.state !== "VERIFIED") {
    throw new AutomationFailure("BACKUP_CAPTURE", "media-pair");
  }
  const databaseBackupUrl = input.databaseBackupUrl ||
    `https://${getBackupStore()?.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com/${artifact.pathname}`;
  const backupStore = getBackupStore();
  if (!backupStore || new URL(databaseBackupUrl).hostname !==
      `${backupStore.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com` ||
      blobPathFromUrl(databaseBackupUrl) !== artifact.pathname) {
    throw new AutomationFailure("BACKUP_CAPTURE", "media-pair");
  }
  const backupPath = blobPathFromUrl(databaseBackupUrl);
  if (!backupPath.startsWith("backups/") || backupPath.endsWith(MEDIA_MANIFEST_SUFFIX)) {
    throw new Error("Media inventory requires a database backup under backups/.");
  }

  try {
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

  const photoRows = await prisma.photo.findMany({
    select: { id: true, url: true },
    orderBy: { id: "asc" },
  });
  // MCP-10a: app-feedback screenshots live in the same private store (feedback/<report>/<id>.webp) but in their own
  // table. Live ones are copied too; a removed one (privacy deletion) is skipped, and its tombstone blocks a restore.
  const feedbackRows = await prisma.feedbackAttachment.findMany({
    where: { deletedAt: null },
    select: { id: true, pathname: true },
    orderBy: { id: "asc" },
  });
  const photos = [
    ...photoRows,
    ...feedbackRows.map((row) => ({ id: `feedback:${row.id}`, url: privateBlobUrl(store.storeId, row.pathname) })),
  ];
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
    const recoveryPath = `recovery/${now.toISOString().slice(0, 7)}/${source.sha256}/${sourcePath}`;
    if (await hasPrivacyDeletionTombstone(sourcePath, store.token)) {
      entries.push({ photoId: photo.id, sourceUrl: photo.url, sourcePath, size: null, sha256: null,
        sourceEtag: null, status: "TOMBSTONED", recoveryPath: null, recoveryUrl: null });
      continue;
    }
    const recovered = await copy(photo.url, recoveryPath, {
      access: "private",
      token: store.token,
      contentType: source.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    const verifiedCopy = await readAndHash(recovered.url, store.token);
    if (
      !verifiedCopy ||
      verifiedCopy.sha256 !== source.sha256 ||
      verifiedCopy.size !== source.size
    ) {
      throw new Error(`Recovery copy verification failed for "${sourcePath}".`);
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
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  const written = await put(manifestPath, manifestBytes, {
    access: "private",
    token: backupToken,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  const counts = inventoryCounts(entries, unreferenced.length);
  const verified = await verifyBackupReadback(manifestPath, backupToken, backupDigest(manifestBytes));
  const complete = verified && counts.missing === 0;
  await prisma.backupArtifact.create({ data: {
    kind: "MEDIA_MANIFEST", state: complete ? "VERIFIED" : "FAILED",
    databaseArtifactId: artifact.id, pathname: manifestPath, formatVersion: manifest.formatVersion,
    sizeBytes: manifestBytes.length, sha256: backupDigest(manifestBytes),
    verifiedAt: complete ? new Date() : undefined,
    failureStage: !verified ? "READBACK" : !complete ? "MISSING_MEDIA" : undefined,
    photoCounts: counts,
  } });
  if (!complete) throw new AutomationFailure("MEDIA_COPY", verified ? "media-missing" : "media-readback");
  return { manifest, manifestUrl: written.url, counts };
  } catch (cause) {
    if (cause instanceof AutomationFailure) throw cause;
    throw new AutomationFailure("MEDIA_COPY", "media-copy", { cause });
  }
}

export async function restoreMediaFromManifest(
  manifestUrl: string,
): Promise<{ restored: number; alreadyPresent: number; skippedTombstoned: number }> {
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Private photo storage is unavailable.");
  const backupToken = getBackupStore()?.token;
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
    if (await blobExists(privacyDeletionTombstonePath(entry.sourcePath), store.token)) {
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
      alreadyPresent += 1;
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
    });

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
  const backupToken = getBackupStore()?.token;
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

    if (await blobExists(privacyDeletionTombstonePath(entry.sourcePath), store.token)) {
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

