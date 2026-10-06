import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKUP_TABLES } from "@/domains/backup/manifest";
import { buildDatabaseBackupSnapshot } from "@/domains/backup";
import { verifySchemaHealth } from "@/lib/schema-health";

const run = promisify(execFile);
const restoreUrl = "postgresql://test:test@localhost:5432/appliance_desk_restore";
const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const enabled =
  process.env.CI === "true" &&
  parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("backup restore drill (real Postgres)", () => {
  let directory = "";
  let target: PrismaClient;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "appliance-desk-restore-"));
    target = new PrismaClient({ adapter: new PrismaPg({ connectionString: restoreUrl }) });
  });

  afterAll(async () => {
    if (target) await target.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("restores every backed-up table, omits credentials, and passes schema health", async () => {
    const snapshot = await buildDatabaseBackupSnapshot();
    const file = path.join(directory, "backup.json");
    await writeFile(file, JSON.stringify(snapshot.payload), "utf8");

    const { stdout, stderr } = await run(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", "scripts/restore-backup.ts", file, "--into", restoreUrl],
      { cwd: process.cwd(), env: process.env, maxBuffer: 10 * 1024 * 1024 },
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("Schema health check passed");

    const delegates = target as unknown as Record<string, { count?: () => Promise<number> }>;
    for (const table of BACKUP_TABLES) {
      const count = await delegates[table]!.count!();
      expect(count, table).toBe(snapshot.payload.tables[table]!.length);
    }

    expect(await target.account.count()).toBe(0);
    expect(await target.session.count()).toBe(0);
    expect(await target.verification.count()).toBe(0);
    expect(await target.webhookEvent.count()).toBe(snapshot.payload.tables.webhookEvent!.length);
    await verifySchemaHealth(target);

    const pg = new Client({ connectionString: restoreUrl });
    await pg.connect();
    try {
      for (const [model, field, delegate] of [
        ["Estimate", "estimateNumber", "estimate"],
        ["Invoice", "invoiceNumber", "invoice"],
      ] as const) {
        const rows = snapshot.payload.tables[delegate] as Array<Record<string, unknown>>;
        const maximum = Math.max(0, ...rows.map((row) => Number(row[field] ?? 0)));
        const next = await pg.query<{ value: string }>(
          \`SELECT nextval(pg_get_serial_sequence('"\${model}"', '\${field}'))::text AS value\`,
        );
        expect(Number(next.rows[0]!.value)).toBeGreaterThan(maximum);
      }
    } finally {
      await pg.end();
    }
  });
});
