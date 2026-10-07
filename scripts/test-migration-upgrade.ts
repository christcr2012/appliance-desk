// Existing CI covers a clean install. This proves upgrades with business data
// already present, in a second throwaway DB; never touches CI's main fixtures.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { verifySchemaHealth } from "../src/lib/schema-health";
import { backfillReceipts } from "./backfill-receipts";
import { migrationUpgradeTarget } from "./lib/migration-upgrade-safety";
import {
  prepareUpgradeBaseline,
  UPGRADE_BASELINE,
} from "./lib/migration-upgrade-baseline";

async function main() {
  const target = migrationUpgradeTarget({
    CI: process.env.CI,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    DIRECT_URL: process.env.DIRECT_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  });
  const root = process.cwd();
  const database = `appliance_desk_upgrade_test_${randomBytes(8).toString("hex")}`;
  const upgradedTarget = new URL(target);
  upgradedTarget.pathname = `/${database}`;
  const admin = new pg.Client({ connectionString: target.toString() });
  let fixtureClient: pg.Client | undefined;
  let schemaClient: PrismaClient | undefined;
  let temporary: string | undefined;
  let created = false;

  function deploy(config: string) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--config",
        config,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          DIRECT_URL: upgradedTarget.toString(),
          DATABASE_URL: upgradedTarget.toString(),
        },
        stdio: "inherit",
        timeout: 120_000,
      },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Migration upgrade deployment failed.");
  }

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    temporary = await mkdtemp(path.join(root, ".migration-upgrade-"));
    const migrations = path.join(temporary, "migrations");
    await prepareUpgradeBaseline(root, migrations);
    const baselineConfig = path.join(temporary, "prisma.config.ts");
    await writeFile(
      baselineConfig,
      `import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: env("DIRECT_URL") } });\n`,
    );
    deploy(baselineConfig);

    fixtureClient = new pg.Client({ connectionString: upgradedTarget.toString() });
    await fixtureClient.connect();
    const initial = await fixtureClient.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );
    assert.deepEqual(
      initial.rows.map((row) => row.migration_name),
      [UPGRADE_BASELINE],
    );

    // Synthetic records exercise old types, money, links and dates before
    // later ALTERs. Uppercase SUCCEEDED is intentional historical input.
    await fixtureClient.query(`
      INSERT INTO "User" (id,email,"emailVerified",name,"updatedAt") VALUES
        ('upgrade-user','upgrade@example.test','2026-09-26T12:00:00Z','Upgrade Customer',now()),
        ('upgrade-unverified','unverified@example.test',NULL,'Unverified',now());
      INSERT INTO "Customer" (id,"userId",phone,"updatedAt") VALUES ('upgrade-customer','upgrade-user','555-0100',now());
      INSERT INTO "ServiceAddress" (id,"customerId",line1,city,zip,"updatedAt") VALUES ('upgrade-address','upgrade-customer','123 Test Street','Greeley','80631',now());
      INSERT INTO "ApplianceType" (id,name,slug,"monthlyPriceCents","updatedAt") VALUES ('upgrade-type','Upgrade Washer','upgrade-washer',6000,now());
      INSERT INTO "Appliance" (id,"assetNumber","applianceTypeId","acquisitionCostCents",notes,"updatedAt") VALUES ('upgrade-appliance','UPGRADE-001','upgrade-type',25500,'Preserve condition evidence',now());
      INSERT INTO "RentalAgreement" (id,"customerId","serviceAddressId","depositCents","updatedAt") VALUES ('upgrade-agreement','upgrade-customer','upgrade-address',9000,now());
      INSERT INTO "RentalLine" (id,"agreementId",label,"monthlyPriceCents") VALUES ('upgrade-line','upgrade-agreement','Washer',6000);
      INSERT INTO "Job" (id,type,"customerId","serviceAddressId","agreementId","scheduledAt","updatedAt") VALUES ('upgrade-job','DELIVERY','upgrade-customer','upgrade-address','upgrade-agreement','2026-11-01T08:30:00Z',now());
      INSERT INTO "JobAppliance" (id,"jobId","applianceId") VALUES ('upgrade-job-appliance','upgrade-job','upgrade-appliance');
      INSERT INTO "Invoice" (id,"customerId","agreementId","amountDueCents","amountPaidCents","updatedAt") VALUES ('upgrade-invoice','upgrade-customer','upgrade-agreement',12000,3500,now());
      INSERT INTO "Payment" (id,"invoiceId","amountCents",method,status) VALUES ('upgrade-payment','upgrade-invoice',3500,'cash','SUCCEEDED');
    `);

    async function snapshot() {
      const result = await fixtureClient!.query(`SELECT
        u.id, u.email, u."emailVerified", c.phone,
        a."assetNumber", a."acquisitionCostCents", a.notes,
        t."monthlyPriceCents" AS "typePrice", r."depositCents", l."monthlyPriceCents" AS "linePrice",
        j."scheduledAt", i."amountDueCents", i."amountPaidCents", p."amountCents"
        FROM "User" u JOIN "Customer" c ON c."userId"=u.id
        JOIN "RentalAgreement" r ON r."customerId"=c.id
        JOIN "RentalLine" l ON l."agreementId"=r.id
        JOIN "Job" j ON j."agreementId"=r.id AND j."serviceAddressId"=r."serviceAddressId"
        JOIN "JobAppliance" ja ON ja."jobId"=j.id
        JOIN "Appliance" a ON a.id=ja."applianceId"
        JOIN "ApplianceType" t ON t.id=a."applianceTypeId"
        JOIN "Invoice" i ON i."agreementId"=r.id AND i."customerId"=c.id
        JOIN "Payment" p ON p."invoiceId"=i.id WHERE u.id='upgrade-user'`);
      assert.equal(result.rows.length, 1, "Upgrade must preserve all fixture links.");
      return result.rows[0];
    }

    const before = await snapshot();
    for (const migration of [
      "20260926151500_verification_updated_at",
      "20260926163000_user_email_verified_boolean",
    ]) {
      await cp(
        path.join(root, "prisma/migrations", migration),
        path.join(migrations, migration),
        { recursive: true },
      );
    }
    deploy(baselineConfig);
    assert.deepEqual(await snapshot(), { ...before, emailVerified: true });
    const converted = await fixtureClient.query(
      'SELECT "emailVerified" FROM "User" WHERE id=$1',
      ["upgrade-unverified"],
    );
    assert.equal(converted.rows[0].emailVerified, false);

    for (const migration of await readdir(path.join(root, "prisma/migrations"), {
      withFileTypes: true,
    })) {
      if (
        migration.isDirectory() &&
        migration.name < "20261001190000_staff_task_assignment"
      ) {
        await cp(
          path.join(root, "prisma/migrations", migration.name),
          path.join(migrations, migration.name),
          { recursive: true },
        );
      }
    }
    deploy(baselineConfig);
    await fixtureClient.query(
      `INSERT INTO "StaffTask" (id,note,"dueDate","createdByUserId","customerId") VALUES ('upgrade-task','Preserve follow-up','2026-11-02','upgrade-user','upgrade-customer')`,
    );

    const preGClosedUpdatedAt = new Date("2026-10-02T15:30:00Z");
    await fixtureClient.query(
      'UPDATE "RentalAgreement" SET status=\'CANCELLED\', "endDate"=NULL, "updatedAt"=$1 WHERE id=\'upgrade-agreement\'',
      [preGClosedUpdatedAt],
    );

    deploy(path.join(root, "prisma.config.ts"));
    const closedAgreement = await fixtureClient.query(
      'SELECT "closedAt" FROM "RentalAgreement" WHERE id=\'upgrade-agreement\'',
    );
    assert.equal(
      closedAgreement.rows[0].closedAt.toISOString(),
      preGClosedUpdatedAt.toISOString(),
      "Batch G must backfill a previously cancelled agreement from updatedAt when endDate is null",
    );
    const preservedTask = await fixtureClient.query(
      `SELECT note,"dueDate","customerId","assigneeUserId",priority,version FROM "StaffTask" WHERE id='upgrade-task'`,
    );
    assert.deepEqual(preservedTask.rows[0], {
      note: "Preserve follow-up",
      dueDate: new Date("2026-11-02"),
      customerId: "upgrade-customer",
      assigneeUserId: null,
      priority: "NORMAL",
      version: 1,
    });

    const after = await snapshot();
    assert.deepEqual(after, { ...before, emailVerified: true });
    const unverified = await fixtureClient.query(
      'SELECT "emailVerified" FROM "User" WHERE id=$1',
      ["upgrade-unverified"],
    );
    assert.equal(unverified.rows[0].emailVerified, true);

    const history = await fixtureClient.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
    );
    const expected = (
      await readdir(path.join(root, "prisma/migrations"), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      history.rows.map((row) => row.migration_name),
      expected,
    );

    schemaClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: upgradedTarget.toString() }),
    });
    await verifySchemaHealth(schemaClient);

    const backfill = await backfillReceipts(schemaClient);
    assert.equal(backfill.paymentsLinked, 1);
    assert.equal(backfill.receiptsCreated, 1);
    const linked = await schemaClient.payment.findUniqueOrThrow({
      where: { id: "upgrade-payment" },
      include: { receipt: true },
    });
    assert.ok(linked.receiptId, "Historical succeeded payment must be linked to a receipt.");
    assert.equal(linked.receipt?.amountCents, 3500);
    assert.equal(linked.receipt?.source, "MANUAL");

    const repeatedBackfill = await backfillReceipts(schemaClient);
    assert.equal(repeatedBackfill.paymentsLinked, 0);
    assert.equal(repeatedBackfill.receiptsCreated, 0);
    assert.equal(await schemaClient.receipt.count({ where: { customerId: "upgrade-customer" } }), 1);

    // Deploy retry must be a no-op for records and migration history.
    deploy(path.join(root, "prisma.config.ts"));
    assert.deepEqual(await snapshot(), after);
    const repeated = await fixtureClient.query(
      'SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    assert.equal(repeated.rows[0].count, expected.length);
    await verifySchemaHealth(schemaClient);
    console.log(
      `[migration-upgrade] ${expected.length} migrations verified; records, links, money, receipt backfill and retry preserved.`,
    );
  } finally {
    await schemaClient?.$disconnect();
    await fixtureClient?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
