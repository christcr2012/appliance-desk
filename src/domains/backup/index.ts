import { BACKUP_TABLES } from "./manifest";
import { put } from "@vercel/blob";
import { getBackupStore } from "@/lib/photo-storage";
import { backupDigest, verifyBackupReadback, pruneBackups, backupPruneAttention, backupPruneRecovered } from "./artifacts";
import { failureExplanation, type FailureCode } from "@/domains/automation/failures";
import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import { getBusinessSettings } from "@/domains/settings";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { businessDateKey } from "@/lib/business-date";

const BACKUP_PREFIX = "backups/";


export type DatabaseBackupPayload = {
  formatVersion: 2;
  exportedAt: string;
  migrationId: string;
  appVersion: string;
  tables: Record<string, unknown[]>;
};

export type BackupResult = {
  ok: boolean;
  artifactId?: string;
  url?: string;
  tableCounts?: Record<string, number>;
  prunedCount?: number;
  pruneFailed?: number;
  captureMs?: number;
  bytes?: number;
  failureCode?: FailureCode;
  failureStage?: "config" | "capture" | "upload" | "readback";
  error?: string; // fixed allowlisted explanation, never raw provider or database text
};

function stageFailure(code: FailureCode, stage: NonNullable<BackupResult["failureStage"]>): BackupResult {
  return { ok: false, failureCode: code, failureStage: stage,
    error: failureExplanation(code).explain };
}

type BackupReadHook = (input: { table: string; index: number }) => void | Promise<void>;
let backupReadHookForTests: BackupReadHook | null = null;

/** Test-only seam used to prove REPEATABLE READ snapshot consistency. */
export function __setBackupReadHookForTests(hook: BackupReadHook | null): void {
  backupReadHookForTests = hook;
}

/** Read one restorable snapshot without contacting Blob storage. */
export async function buildDatabaseBackupSnapshot(): Promise<{
  payload: DatabaseBackupPayload;
  tableCounts: Record<string, number>;
}> {
  return prisma.$transaction(
    async (tx) => {
      const migrations = await tx.$queryRaw<Array<{ migration_name: string }>>`
        SELECT "migration_name"
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
        ORDER BY "finished_at" DESC, "started_at" DESC
        LIMIT 1
      `;
      const migrationId = migrations[0]?.migration_name;
      if (!migrationId) {
        throw new Error("No completed Prisma migration was found; refusing to create an unrestorable backup.");
      }

      const tableCounts: Record<string, number> = {};
      const tables: Record<string, unknown[]> = {};
      const delegates = tx as unknown as Record<string, { findMany?: () => Promise<unknown[]> }>;

      // Sequential reads inside one REPEATABLE READ transaction are deliberate:
      // every table is captured from the same PostgreSQL snapshot.
      for (let index = 0; index < BACKUP_TABLES.length; index += 1) {
        const table = BACKUP_TABLES[index]!;
        const delegate = delegates[table];
        if (!delegate?.findMany) throw new Error(`Backup delegate "${table}" is unavailable.`);
        const rows = await delegate.findMany();
        // OpsAgentKey credentials are deliberately excluded from backups.
        // Keep human/agent diagnostic notes, but clear their optional key FK
        // so restores never reference a credential absent from the archive.
        tables[table] = rows.map(row => {
          const result = { ...(row as Record<string, unknown>) };
          if (table === "systemIssueNote") result.authorKeyId = null;
          // Lossless decimal string snapshots for every Prisma BigInt scalar.
          for (const [key, value] of Object.entries(result))
            if (typeof value === "bigint") result[key] = value.toString();
          return result;
        });
        tableCounts[table] = rows.length;
        if (backupReadHookForTests && index < BACKUP_TABLES.length - 1) {
          await backupReadHookForTests({ table, index });
        }
      }

      return {
        payload: {
          formatVersion: 2,
          exportedAt: new Date().toISOString(),
          migrationId,
          appVersion: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
          tables,
        },
        tableCounts,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 120_000, maxWait: 20_000 },
  );
}

/** Exports one consistent business snapshot to a verified, private and paired recovery artifact.
 * Never treat successful upload as successful readback, or prune failure as capture failure.
 */
export async function exportDatabaseBackup(input: { runId?: string } = {}): Promise<BackupResult> {
  if (isNonProductionDeployment()) return stageFailure("CONFIG_MISSING", "config");
  const store = getBackupStore();
  if (!store) return stageFailure("CONFIG_MISSING", "config");

  const captureStartedAt = Date.now();
  let snapshot: Awaited<ReturnType<typeof buildDatabaseBackupSnapshot>>;
  try {
    snapshot = await buildDatabaseBackupSnapshot();
  } catch {
    return stageFailure("BACKUP_CAPTURE", "capture");
  }
  const captureMs = Date.now() - captureStartedAt;
  const bytes = Buffer.from(JSON.stringify(snapshot.payload), "utf8");
  const digest = backupDigest(bytes);
  const filename = `${BACKUP_PREFIX}${snapshot.payload.exportedAt.slice(0, 10)}-${Date.now()}.json`;
  let url: string;
  try {
    const blob = await put(filename, bytes, {
      access: "private",
      token: store.token,
      contentType: "application/json",
      addRandomSuffix: false,
    });
    const parsed = new URL(blob.url);
    if (blob.pathname !== filename || parsed.protocol !== "https:" ||
        parsed.hostname !== `${store.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com` ||
        decodeURIComponent(parsed.pathname) !== `/${filename}` ||
        parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
      return stageFailure("BACKUP_UPLOAD", "upload");
    }
    url = blob.url;
  } catch {
    return stageFailure("BACKUP_UPLOAD", "upload");
  }
  let artifact: { id: string };
  try {
    artifact = await prisma.backupArtifact.create({
      data: {
        kind: "DATABASE", state: "UPLOADED_UNVERIFIED", pathname: filename,
        formatVersion: snapshot.payload.formatVersion,
        runId: input.runId, migrationId: snapshot.payload.migrationId,
        appRevision: snapshot.payload.appVersion, sizeBytes: bytes.length,
        sha256: digest, tableCounts: snapshot.tableCounts,
      },
    });
  } catch {
    // The blob uploaded, but without a durable ledger it is not a verified backup.
    return stageFailure("BACKUP_UPLOAD", "upload");
  }

  let verified = false;
  try {
    verified = await verifyBackupReadback(filename, store.token, digest);
  } catch {
    verified = false;
  }
  if (!verified) {
    await prisma.backupArtifact.update({
      where: { id: artifact.id },
      data: { state: "FAILED", failureStage: "READBACK" },
    });
    return { ...stageFailure("BACKUP_READBACK", "readback"), artifactId: artifact.id, bytes: bytes.length, captureMs };
  }
  try {
    await prisma.backupArtifact.update({
      where: { id: artifact.id },
      data: { state: "VERIFIED", verifiedAt: new Date() },
    });
  } catch {
    return { ...stageFailure("BACKUP_READBACK", "readback"), artifactId: artifact.id,
      bytes: bytes.length, captureMs };
  }

  let prunedCount = 0, pruneFailed = 0;
  try {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" }, select: { backupRetentionDays: true },
    });
    prunedCount = await pruneBackups(new Date(), settings.backupRetentionDays, store.token);
    await backupPruneRecovered();
  } catch {
    pruneFailed = 1;
    await backupPruneAttention();
  }
  return { ok: true, artifactId: artifact.id, url, tableCounts: snapshot.tableCounts,
    captureMs, bytes: bytes.length, prunedCount, pruneFailed };
}

export async function sendBackupFailureAlertToChris(result: BackupResult): Promise<void> {
  if (result.ok) return;

  const settings = await getBusinessSettings();
  const notifyTo = process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;
  const day = businessDateKey(new Date());
  const delivery = await deliverMessage({
    idempotencyKey: `backup-failure-${day}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "backup-failure",
    customerFacing: false,
    recipient: { type: "Staff", address: notifyTo },
    subject: { type: "BackupRun", id: day },
    render: () => ({
      subject: "Appliance Desk: today's automatic backup failed",
      // MCP-1: never the raw error text (it can carry provider replies or private details). The reason and a
      // reference number are on the System health page.
      text: `The daily backup of your business data didn't complete today.\n\nThe reason and a reference number are on the System health page (Desk → System health → Daily backup).\n\nA verified extra safety copy was not made today. Existing recovery copies have not been changed by this report. Check the reason in System health and try again when private storage is ready.`,
    }),
  });
  if (!["ACCEPTED", "DELIVERED", "NOT_SENT"].includes(delivery.state)) {
    console.error("[backup] Failure alert delivery needs attention", delivery.deliveryId, delivery.state);
  }
}
