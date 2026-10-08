import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { BACKUP_MODEL_POLICY, BACKUP_TABLES } from "../src/domains/backup/manifest";
import type { DatabaseBackupPayload } from "../src/domains/backup";
import { verifySchemaHealth } from "../src/lib/schema-health";
import {
  autoincrementFields,
  dateTimeFieldsByDelegate,
  deriveRestoreTableOrder,
  nullableJsonFieldsByDelegate,
} from "./lib/table-order";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");
const SCHEMA_FILE = path.join(process.cwd(), "prisma", "schema.prisma");
const NEON_API = "https://console.neon.tech/api/v2";

function usage(): never {
  throw new Error("Usage: npx tsx scripts/restore-backup.ts <backup.json> --into <DATABASE_URL>");
}

function parseArgs(): { file: string; target: string } {
  const [file, flag, target, ...extra] = process.argv.slice(2);
  if (!file || flag !== "--into" || !target || extra.length > 0) usage();
  return { file, target };
}

function validatePayload(value: unknown): DatabaseBackupPayload {
  if (!value || typeof value !== "object") throw new Error("Backup file is not a JSON object.");
  const input = value as Partial<DatabaseBackupPayload>;
  if (input.formatVersion !== 2) throw new Error("Only backup formatVersion 2 can be restored.");
  if (
    typeof input.exportedAt !== "string" ||
    typeof input.migrationId !== "string" ||
    typeof input.appVersion !== "string" ||
    !input.tables ||
    typeof input.tables !== "object" ||
    Array.isArray(input.tables)
  ) {
    throw new Error("Backup metadata is incomplete.");
  }

  const expected = [...BACKUP_TABLES].sort();
  const actual = Object.keys(input.tables).sort();
  if (expected.length !== actual.length || expected.some((table, index) => table !== actual[index])) {
    throw new Error(
      "Backup table manifest does not match this checkout. Restore with the app commit recorded in appVersion.",
    );
  }
  for (const [table, rows] of Object.entries(input.tables)) {
    if (!Array.isArray(rows)) throw new Error(`Backup table "${table}" is not an array.`);
  }
  return input as DatabaseBackupPayload;
}

function normalizeNeonHost(host: string): string {
  const [first, ...rest] = host.toLowerCase().split(".");
  return [first?.replace(/-pooler$/, ""), ...rest].join(".");
}

async function neonJson(url: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Neon safety lookup failed with HTTP ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

async function assertSafeRestoreTarget(target: string): Promise<void> {
  const url = new URL(target);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Restore target must be a PostgreSQL connection string.");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return;
  if (!host.endsWith(".neon.tech")) {
    throw new Error("Restore refused: target must be localhost/127.0.0.1 or a verified Neon restore-* branch.");
  }

  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error(
      "Restore refused: Neon targets require NEON_API_KEY and NEON_PROJECT_ID so the branch name can be verified.",
    );
  }

  const endpointsPayload = await neonJson(
    `${NEON_API}/projects/${encodeURIComponent(projectId)}/endpoints`,
    apiKey,
  );
  const endpoints = Array.isArray(endpointsPayload.endpoints) ? endpointsPayload.endpoints : [];
  const normalizedTarget = normalizeNeonHost(host);
  const endpoint = endpoints.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const candidateHost = (candidate as { host?: unknown }).host;
    return typeof candidateHost === "string" && normalizeNeonHost(candidateHost) === normalizedTarget;
  }) as { branch_id?: unknown } | undefined;
  if (!endpoint || typeof endpoint.branch_id !== "string") {
    throw new Error("Restore refused: the Neon endpoint was not found in the configured project.");
  }

  const branchesPayload = await neonJson(
    `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches`,
    apiKey,
  );
  const branches = Array.isArray(branchesPayload.branches) ? branchesPayload.branches : [];
  const branch = branches.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return (candidate as { id?: unknown }).id === endpoint.branch_id;
  }) as { name?: unknown } | undefined;
  if (!branch || typeof branch.name !== "string" || !branch.name.startsWith("restore-")) {
    throw new Error("Restore refused: the Neon endpoint is not attached to a branch named restore-*.");
  }
  console.log(`[restore] Verified isolated Neon branch "${branch.name}".`);
}

async function assertEmptyDatabase(client: Client): Promise<void> {
  const result = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  if (result.rows.length > 0) {
    throw new Error(
      `Restore target is not empty (${result.rows.length} public table(s) found). Use a new empty restore database.`,
    );
  }
}

async function ensureMigrationTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function migrationNamesThrough(migrationId: string): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const index = names.indexOf(migrationId);
  if (index < 0) {
    throw new Error(
      `Backup migration "${migrationId}" is not present in this checkout. Use the recorded appVersion commit.`,
    );
  }
  return names.slice(0, index + 1);
}

async function applyMigrations(client: Client, migrationId: string): Promise<void> {
  await ensureMigrationTable(client);
  for (const name of await migrationNamesThrough(migrationId)) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations"
          ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
         VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
        [randomUUID(), checksum, name],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration "${name}" failed during restore.`, { cause: error });
    }
  }
}

function reviveRows(
  table: string,
  rows: unknown[],
  dateFields: Record<string, string[]>,
  nullableJsonFields: Record<string, string[]>,
): Record<string, unknown>[] {
  return rows.map((row, rowIndex) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Backup row ${rowIndex} in "${table}" is not an object.`);
    }
    const revived = { ...(row as Record<string, unknown>) };
    for (const field of dateFields[table] ?? []) {
      const value = revived[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== "string") {
        throw new Error(`Backup field "${table}.${field}" must be an ISO date string.`);
      }
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        throw new Error(`Backup field "${table}.${field}" contains an invalid date.`);
      }
      revived[field] = date;
    }
    for (const field of nullableJsonFields[table] ?? []) {
      if (revived[field] === null) revived[field] = Prisma.DbNull;
    }
    return revived;
  });
}

async function resetAutoincrementSequences(client: Client, schema: string): Promise<void> {
  for (const field of autoincrementFields(schema, BACKUP_MODEL_POLICY)) {
    if (!/^[A-Za-z_]\w*$/.test(field.model) || !/^[A-Za-z_]\w*$/.test(field.field)) {
      throw new Error("Unsafe identifier found while resetting restore sequences.");
    }
    const sequence = await client.query<{ sequence_name: string | null }>(
      "SELECT pg_get_serial_sequence($1, $2) AS sequence_name",
      [`"${field.model}"`, field.field],
    );
    const sequenceName = sequence.rows[0]?.sequence_name;
    if (!sequenceName) continue;
    const maximum = await client.query<{ maximum: string | null }>(
      `SELECT MAX("${field.field}")::text AS maximum FROM "${field.model}"`,
    );
    if (maximum.rows[0]?.maximum) {
      await client.query("SELECT setval($1::regclass, $2::bigint, true)", [
        sequenceName,
        maximum.rows[0].maximum,
      ]);
    } else {
      await client.query("SELECT setval($1::regclass, 1, false)", [sequenceName]);
    }
  }
}

async function restore(file: string, target: string): Promise<void> {
  await assertSafeRestoreTarget(target);
  const payload = validatePayload(JSON.parse(await readFile(file, "utf8")) as unknown);
  const schema = await readFile(SCHEMA_FILE, "utf8");
  const order = deriveRestoreTableOrder(schema, BACKUP_MODEL_POLICY);
  const dateFields = dateTimeFieldsByDelegate(schema, BACKUP_MODEL_POLICY);
  const nullableJsonFields = nullableJsonFieldsByDelegate(schema, BACKUP_MODEL_POLICY);

  const sql = new Client({ connectionString: target });
  await sql.connect();
  let prisma: PrismaClient | null = null;
  try {
    await assertEmptyDatabase(sql);
    await applyMigrations(sql, payload.migrationId);

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) });
    const delegates = prisma as unknown as Record<
      string,
      {
        deleteMany?: () => Promise<{ count: number }>;
        createMany?: (input: { data: Record<string, unknown>[] }) => Promise<{ count: number }>;
      }
    >;

    // Data migrations may seed business rows (for example the initial inspection
    // checklist). A recovery must reproduce the backup exactly, not merge those
    // seed rows with recovered state, so clear backed-up tables in reverse FK
    // order after schema migration and before loading the snapshot.
    for (const table of [...order].reverse()) {
      const delegate = delegates[table];
      if (!delegate?.deleteMany) throw new Error(`Restore delegate "${table}" cannot be cleared.`);
      await delegate.deleteMany();
    }

    const receiptLinks: Array<{ id: string; receiptPhotoId: string }> = [];
    for (const table of order) {
      const rows = payload.tables[table] ?? [];
      if (rows.length === 0) continue;
      const delegate = delegates[table];
      if (!delegate?.createMany) throw new Error(`Restore delegate "${table}" is unavailable.`);
      const data = reviveRows(table, rows, dateFields, nullableJsonFields);
      if (table === "appliance") {
        for (const row of data) {
          if (typeof row.acquisitionReceiptPhotoId === "string") {
            receiptLinks.push({ id: String(row.id), receiptPhotoId: row.acquisitionReceiptPhotoId });
            row.acquisitionReceiptPhotoId = null;
          }
        }
      }
      const result = await delegate.createMany({ data });
      if (result.count !== rows.length) {
        throw new Error(`Restore count mismatch for "${table}": expected ${rows.length}, wrote ${result.count}.`);
      }
    }

    // Restore the nullable Appliance -> Photo edge after both tables exist.
    for (const link of receiptLinks) {
      await prisma.appliance.update({
        where: { id: link.id },
        data: { acquisitionReceiptPhotoId: link.receiptPhotoId },
      });
    }

    await resetAutoincrementSequences(sql, schema);
    await verifySchemaHealth(prisma);
    console.log(
      `[restore] Restored backup from ${payload.exportedAt} (app ${payload.appVersion}, migration ${payload.migrationId}).`,
    );
    console.log(
      "[restore] Account, Session and Verification credentials are intentionally absent; users must reset passwords.",
    );
    console.log("[restore] Schema health check passed.");
  } finally {
    if (prisma) await prisma.$disconnect();
    await sql.end();
  }
}

async function main(): Promise<void> {
  const { file, target } = parseArgs();
  await restore(file, target);
}

main().catch((error) => {
  console.error("[restore] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
