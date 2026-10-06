import { BACKUP_TABLES } from "./manifest";
import { put, list, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import { getBusinessSettings } from "@/domains/settings";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { businessDateKey } from "@/lib/business-date";

const BACKUP_PREFIX = "backups/";
const RETENTION_DAYS = 30;

export type DatabaseBackupPayload = {
  formatVersion: 2;
  exportedAt: string;
  migrationId: string;
  appVersion: string;
  tables: Record<string, unknown[]>;
};

export type BackupResult = {
  ok: boolean;
  url?: string;
  tableCounts?: Record<string, number>;
  prunedCount?: number;
  error?: string;
};

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
      const migrations = await tx.$queryRaw<Array<{ migration_name: string }>>\`
        SELECT "migration_name"
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
        ORDER BY "finished_at" DESC, "started_at" DESC
        LIMIT 1
      \`;
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
        if (!delegate?.findMany) throw new Error(\`Backup delegate "\${table}" is unavailable.\`);
        const rows = await delegate.findMany();
        tables[table] = rows;
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
    { isolationLevel: "RepeatableRead" },
  );
}

/** Exports every business-critical table to one private, restorable JSON file. */
export async function exportDatabaseBackup(): Promise<BackupResult> {
  if (isNonProductionDeployment()) {
    return { ok: false, error: "Backups are disabled outside production deployments." };
  }
  try {
    const snapshot = await buildDatabaseBackupSnapshot();
    const filename = \`\${BACKUP_PREFIX}\${snapshot.payload.exportedAt.slice(0, 10)}-\${Date.now()}.json\`;
    const blob = await put(filename, JSON.stringify(snapshot.payload), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });

    const prunedCount = await pruneOldBackups();
    return { ok: true, url: blob.url, tableCounts: snapshot.tableCounts, prunedCount };
  } catch (error) {
    console.error("[backup] Export failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function pruneOldBackups(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffPrefix = cutoff.toISOString().slice(0, 10);

  const { blobs } = await list({ prefix: BACKUP_PREFIX });
  const stale = blobs.filter((blob) => {
    const name = blob.pathname.slice(BACKUP_PREFIX.length);
    return name.slice(0, 10) < cutoffPrefix;
  });

  if (stale.length === 0) return 0;
  await del(stale.map((blob) => blob.url));
  return stale.length;
}

export async function sendBackupFailureAlertToChris(result: BackupResult): Promise<void> {
  if (result.ok) return;

  const settings = await getBusinessSettings();
  const notifyTo = process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;
  const day = businessDateKey(new Date());
  const delivery = await deliverMessage({
    idempotencyKey: \`backup-failure-\${day}\`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "backup-failure",
    customerFacing: false,
    recipient: { type: "Staff", address: notifyTo },
    subject: { type: "BackupRun", id: day },
    render: () => ({
      subject: "Appliance Desk: today's automatic backup failed",
      text: \`The daily backup of your business data didn't complete today.\\n\\nError: \${result.error ?? "Unknown error"}\\n\\nYour data itself is safe and untouched — this only means today's extra safety copy wasn't made. Neon (your database host) still keeps its own automatic recovery point, so nothing is at risk yet, but if this keeps happening it's worth having someone look into it.\`,
    }),
  });
  if (!["ACCEPTED", "DELIVERED", "NOT_SENT"].includes(delivery.state)) {
    console.error("[backup] Failure alert delivery needs attention", delivery.deliveryId, delivery.state);
  }
}
