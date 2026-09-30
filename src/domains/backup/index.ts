import { put, list, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getBusinessSettings } from "@/domains/settings";
import { isNonProductionDeployment } from "@/lib/deployment-safety";

// Independent daily backup, on top of Neon's own point-in-time recovery
// (which only reaches back 6 hours on the plan this project is on —
// docs/ROADMAP.md, flagged 2026-09-29). This is a second, separate copy
// of every business record, stored in Vercel Blob (a different provider
// entirely), so a problem with Neon itself — an accidental mass-delete
// outside that 6-hour window, a billing lapse, an account issue — isn't
// the only copy of Chris's data. It's a plain JSON export, not a
// database file: restoring it means re-inserting the JSON with a script,
// not a one-click restore. That's an acceptable trade for a small
// business's first line of defense; a real disaster-recovery drill is a
// separate, bigger project (see docs/ROADMAP.md).
//
// Deliberately excludes 4 of the 35 tables in prisma/schema.prisma:
//   - Session, Account, Verification: better-auth's own login-session
//     bookkeeping. Ephemeral by design (a session backup would be stale
//     the moment it's restored) and contain nothing Chris would ever
//     need to recover — regenerated automatically the next time someone
//     signs in.
//   - WebhookEvent: Stripe's own webhook delivery log, kept only for
//     short-term debugging/idempotency, not a business record — Stripe
//     itself is the durable source of truth for what it sent.
// Every table that holds an actual business record — customers, leads,
// agreements, billing, appliances, notes, audit history — is included.
const BACKUP_TABLES = [
  "user",
  "customer",
  "referral",
  "serviceAddress",
  "lead",
  "leadApplianceRequest",
  "applianceType",
  "appliance",
  "applianceInspection",
  "partRecord",
  "rentalAgreement",
  "rentalLine",
  "applianceAssignment",
  "pricingRule",
  "signatureRecord",
  "deposit",
  "job",
  "jobAppliance",
  "maintenanceRequest",
  "invoice",
  "invoiceLineItem",
  "payment",
  "refund",
  "customerCredit",
  "businessSettings",
  "siteContent",
  "photo",
  "consentRecord",
  "customerNote",
  "customerContact",
  "auditLog",
] as const;

const BACKUP_PREFIX = "backups/";
const RETENTION_DAYS = 30;

export type BackupResult = {
  ok: boolean;
  url?: string;
  tableCounts?: Record<string, number>;
  prunedCount?: number;
  error?: string;
};

/** Exports every business-critical table to a single JSON file and
 * uploads it to Vercel Blob under backups/, then deletes any backup
 * older than RETENTION_DAYS so storage cost doesn't grow forever. Runs
 * once a day from /api/cron/backup. */
export async function exportDatabaseBackup(): Promise<BackupResult> {
  // Both export and retention delete use the same Blob credential.
  // Refuse before reading data or touching production backup files.
  if (isNonProductionDeployment()) {
    return { ok: false, error: "Backups are disabled outside production deployments." };
  }
  try {
    const entries = await Promise.all(
      BACKUP_TABLES.map(async (table) => {
        // Every model on the Prisma client exposes findMany() with this
        // same shape — cast is safe because BACKUP_TABLES is a literal
        // list of real model names checked against schema.prisma above.
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

    // "private" access, not "public": this file is a full copy of every
    // customer's name, contact info, address, and billing history — the
    // opposite of the appliance photos this same Blob store also holds
    // (those are meant to be publicly viewable). A private blob's URL
    // only works with an authenticated request, so restoring from it
    // later means downloading via the Vercel dashboard or the Blob API
    // with the account's token, not just knowing the URL.
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

/** Deletes backups older than RETENTION_DAYS. Backup filenames start
 * with an ISO date (YYYY-MM-DD), so this is a plain string comparison —
 * no need to parse anything. Returns how many were removed. */
async function pruneOldBackups(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffPrefix = cutoff.toISOString().slice(0, 10);

  const { blobs } = await list({ prefix: BACKUP_PREFIX });
  const stale = blobs.filter((blob) => {
    const name = blob.pathname.slice(BACKUP_PREFIX.length);
    const datePart = name.slice(0, 10);
    return datePart < cutoffPrefix;
  });

  if (stale.length === 0) return 0;
  await del(stale.map((blob) => blob.url));
  return stale.length;
}

/** Emails Chris only when something's actually wrong — a healthy daily
 * backup should be silent, same pattern as the late-fee digest
 * (src/domains/billing/late-fees.ts). */
export async function sendBackupFailureAlertToChris(result: BackupResult): Promise<void> {
  if (result.ok) return;

  const settings = await getBusinessSettings();
  const notifyTo = process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail;

  await sendEmail({
    to: notifyTo,
    subject: "Appliance Desk: today's automatic backup failed",
    text: `The daily backup of your business data didn't complete today.\n\nError: ${result.error ?? "Unknown error"}\n\nYour data itself is safe and untouched — this only means today's extra safety copy wasn't made. Neon (your database host) still keeps its own automatic recovery point, so nothing is at risk yet, but if this keeps happening it's worth having someone look into it.`,
  });
}
