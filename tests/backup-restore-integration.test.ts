import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";

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
  const tag = randomUUID();
  const rdfFixture = { user: "restore-rdf-user-" + tag, customer: "restore-rdf-customer-" + tag,
    invoice: "restore-rdf-invoice-" + tag, rate: "restore-rdf-rate-" + tag, record: "restore-rdf-record-" + tag };


  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "appliance-desk-restore-"));
    target = new PrismaClient({ adapter: new PrismaPg({ connectionString: restoreUrl }) });
    await prisma.user.create({ data: { id: rdfFixture.user, email: tag + "@example.test", role: "OWNER" } });
    await prisma.customer.create({ data: { id: rdfFixture.customer, userId: rdfFixture.user, referralCode: "RESTORE-" + tag } });
    await prisma.invoice.create({ data: { id: rdfFixture.invoice, customerId: rdfFixture.customer, amountDueCents: 0 } });
    await prisma.retailDeliveryFeeRate.create({ data: { id: rdfFixture.rate,
      effectiveOn: businessDateFromKey("1900-01-01")!, amountCents: 31, enteredByUserId: rdfFixture.user } });
    await prisma.retailDeliveryFeeRecord.create({ data: { id: rdfFixture.record,
      saleKey: "restore:" + tag, invoiceId: rdfFixture.invoice, rateId: rdfFixture.rate,
      deliveredOn: businessDateFromKey("2026-07-01")!, saleOn: businessDateFromKey("2026-06-30")!,
      status: "READY", amountCents: 31, collectedFromCustomer: false } });

  });

  afterAll(async () => {
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { id: rdfFixture.record } });
    await prisma.retailDeliveryFeeRate.deleteMany({ where: { id: rdfFixture.rate } });
    await prisma.invoice.deleteMany({ where: { id: rdfFixture.invoice } });
    await prisma.customer.deleteMany({ where: { id: rdfFixture.customer } });
    await prisma.user.deleteMany({ where: { id: rdfFixture.user } });
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

    expect(await target.retailDeliveryFeeRate.findUniqueOrThrow({ where: { id: rdfFixture.rate } })).toMatchObject({
      enteredByUserId: rdfFixture.user, amountCents: 31, effectiveOn: businessDateFromKey("1900-01-01"),
    });
    expect(await target.retailDeliveryFeeRecord.findUniqueOrThrow({ where: { id: rdfFixture.record } })).toMatchObject({
      invoiceId: rdfFixture.invoice, rateId: rdfFixture.rate, status: "READY", amountCents: 31,
      saleOn: businessDateFromKey("2026-06-30"), deliveredOn: businessDateFromKey("2026-07-01"),
      collectedFromCustomer: false,
    });
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
          `SELECT nextval(pg_get_serial_sequence('"${model}"', '${field}'))::text AS value`,
        );
        expect(Number(next.rows[0]!.value)).toBeGreaterThan(maximum);
      }
    } finally {
      await pg.end();
    }
  });
});
