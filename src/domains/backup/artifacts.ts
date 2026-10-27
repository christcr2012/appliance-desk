import { createHash } from "node:crypto";
import { del, get, list } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue, resolveSystemIssue } from "@/domains/system-issues";

export function backupDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyBackupReadback(pathname: string, token: string, digest: string): Promise<boolean> {
  const result = await get(pathname, {
    token, access: "private", useCache: false, abortSignal: AbortSignal.timeout(20_000),
  });
  if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname || !result.stream) return false;
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  return backupDigest(bytes) === digest;
}

const eligibleStates = ["VERIFIED", "UPLOADED_UNVERIFIED", "FAILED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MIN = 7, RETENTION_MAX = 365;

/** Retain both the newest verified database snapshot and the newest full recovery pair.
 * This is true even when they exceed the owner's retention setting by months.
 * Never prune based only on remote list order or a filename prefix.
 */
export async function pruneBackups(now: Date, retentionDays: number, token: string): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < RETENTION_MIN || retentionDays > RETENTION_MAX) {
    throw new Error("Backup retention must be between 7 and 365 days.");
  }
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const newestVerified = await prisma.backupArtifact.findFirst({
    where: { kind: "DATABASE", state: "VERIFIED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const newestComplete = await prisma.backupArtifact.findFirst({
    where: { kind: "DATABASE", state: "VERIFIED",
      mediaManifests: { some: { kind: "MEDIA_MANIFEST", state: "VERIFIED" } } },
    include: { mediaManifests: { where: { kind: "MEDIA_MANIFEST", state: "VERIFIED" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const protectedIds = new Set([newestVerified?.id, newestComplete?.id].filter((id): id is string => !!id));
  for (const manifest of newestComplete?.mediaManifests ?? []) protectedIds.add(manifest.id);

  const old = await prisma.backupArtifact.findMany({
    where: { state: { in: [...eligibleStates] }, createdAt: { lt: cutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  // Deletion is irreversible. Manifests go first, then their database parent.
  const candidates = old.filter(a => !protectedIds.has(a.id)).sort((a, b) =>
    Number(a.kind === "DATABASE") - Number(b.kind === "DATABASE") ||
    a.createdAt.getTime() - b.createdAt.getTime());
  let removed = 0;
  for (const artifact of candidates) {
    // Do not orphan any still-active media manifest when removing a database artifact.
    if (artifact.kind === "DATABASE") {
      const children = await prisma.backupArtifact.count({ where: {
        databaseArtifactId: artifact.id, state: { not: "PRUNED" },
      } });
      if (children > 0) continue;
    }
    await del(artifact.pathname, { token, abortSignal: AbortSignal.timeout(15_000) });
    await prisma.backupArtifact.update({
      where: { id: artifact.id },
      data: { state: "PRUNED", prunedAt: now },
    });
    removed++;
  }

  // Legacy files have no ledger row: bounded, paginated scan.
  // Never sweep without a known verified artifact protecting the recovery floor.
  if (newestVerified) {
    const oldest = await prisma.backupArtifact.findFirst({
      where: { kind: "DATABASE", state: "VERIFIED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const oldestDay = oldest?.createdAt.toISOString().slice(0, 10);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    let cursor: string | undefined;
    for (let pageNum = 0; pageNum < 20; pageNum++) {
      const page = await list({ prefix: "backups/", cursor, limit: 1000, token });
      for (const blob of page.blobs) {
        const relative = blob.pathname.slice("backups/".length);
        if (!/^\d{4}-\d{2}-\d{2}-/.test(relative)) continue;
        const fileDay = relative.slice(0, 10);
        if (fileDay >= cutoffDay || (oldestDay && fileDay >= oldestDay)) continue;
        const recorded = await prisma.backupArtifact.findUnique({
          where: { pathname: blob.pathname }, select: { id: true },
        });
        if (recorded) continue;
        await del(blob.pathname, { token });
        removed++;
      }
      if (!page.hasMore) break;
      if (!page.cursor) throw new Error("Backup storage did not return the next page.");
      cursor = page.cursor;
    }
  }
  return removed;
}

export async function backupPruneAttention(): Promise<void> {
  await recordSystemIssue({ kind: "BACKUP_RETENTION_ATTENTION" });
}
export async function backupPruneRecovered(): Promise<void> {
  await resolveSystemIssue("backup-prune", "SOURCE_SUCCEEDED");
}
