import { BACKUP_TABLES } from "./manifest";
import { put, list, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import { getBusinessSettings } from "@/domains/settings";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { businessDateKey } from "@/lib/business-date";

const BACKUP_PREFIX = "backups/";
const RETENTION_DAYS = 30;

export type BackupResult = {
  ok: boolean;
  url?: string;
  tableCounts?: Record<string, number>;
  prunedCount?: number;
  error?: string;
};

/** Exports every business-critical table to a single JSON file and uploads it
 * to Vercel Blob. Batch F owns snapshot consistency and restore drilling. */
export async function exportDatabaseBackup(): Promise<BackupResult> {
  if (isNonProductionDeployment()) {
    return { ok: false, error: "Backups are disabled outside production deployments." };
  }
  try {
    const entries = await Promise.all(
      BACKUP_TABLES.map(async (table) => {
        const rows = await (
          prisma[table] as { findMany: () => Promise<unknown[]> }
        ).findMany();
        return [table, rows] as const;
      }),
    );

    const tableCounts: Record<string, number> = {};
    const data: Record<string, unknown[]> = {};
    for (const [table, rows] of entries) {
      data[table] = rows;
      tableCounts[table] = rows.length;
    }

    const exportedAt = new Date().toISOString();
    const payload = JSON.stringify({ exportedAt, tables: data }, null, 0);
    const filename = `${BACKUP_PREFIX}${exportedAt.slice(0, 10)}-${Date.now()}.json`;
    const blob = await put(filename, payload, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });

    const prunedCount = await pruneOldBackups();
    return { ok: true, url: blob.url, tableCounts, prunedCount };
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
    idempotencyKey: `backup-failure-${day}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "backup-failure",
    customerFacing: false,
    recipient: { type: "Staff", address: notifyTo },
    subject: { type: "BackupRun", id: day },
    render: () => ({
      subject: "Appliance Desk: today's automatic backup failed",
      text: `The daily backup of your business data didn't complete today.\n\nError: ${result.error ?? "Unknown error"}\n\nYour data itself is safe and untouched — this only means today's extra safety copy wasn't made. Neon (your database host) still keeps its own automatic recovery point, so nothing is at risk yet, but if this keeps happening it's worth having someone look into it.`,
    }),
  });
  if (!["ACCEPTED", "DELIVERED", "NOT_SENT"].includes(delivery.state)) {
    console.error("[backup] Failure alert delivery needs attention", delivery.deliveryId, delivery.state);
  }
}
