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
const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
// CI exposes Postgres on 5432; Vercel Sandbox uses a randomly chosen loopback port.
// Reuse the disposable source connection credentials and port, never a fixed host/port.
// Separate throwaway target per drill; preflight can execute this file twice
// against the SAME disposable source cluster (related tests, then selected tests).
const restoreDatabaseName = "appliance_desk_restore_" + randomUUID().replaceAll("-", "").slice(0, 16);
const restoreTarget = new URL(databaseUrl ?? "postgresql://test@localhost:5432/appliance_desk_test");
restoreTarget.pathname = "/" + restoreDatabaseName;
const restoreUrl = restoreTarget.toString();
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
  const telecom = {
    account: "restore-com-account-" + tag,
    number: "restore-com-number-" + tag,
    point: "restore-com-point-" + tag,
    binding: "restore-com-binding-" + tag,
    delivery: "restore-com-delivery-" + tag,
    attempt: "restore-com-attempt-" + tag,
    consent: "restore-com-consent-" + tag,
    thread: "restore-com-thread-" + tag,
    message: "restore-com-message-" + tag,
    link: "restore-com-link-" + tag,
    readMarker: "restore-com-read-" + tag,
    revision: "restore-com-revision-" + tag,
    cursor: "restore-cost-cursor-" + tag,
    usage: "restore-cost-usage-" + tag,
    rate: "restore-cost-rate-" + tag,
    statement: "restore-cost-statement-" + tag,
    costBase: "restore-cost-base-" + tag,
    costRevision: "restore-cost-revision-" + tag,
  };
  const numberAddress = "+13035550189";



  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "appliance-desk-restore-"));
    // Enabled only for CI against local appliance_desk_test; never touches a hosted database.
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      await admin.query('CREATE DATABASE "' + restoreDatabaseName + '"');
    } finally {
      await admin.end();
    }
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

    // COM-L2 recovery proof: nonempty new lineage survives a full backup/restore.
    await prisma.telecomAccount.create({ data: {
      id: telecom.account, provider: "twilio", environment: "TEST",
      externalAccountId: telecom.account, label: "Restore fixture, never active",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: telecom.number, accountId: telecom.account, address: numberAddress,
      providerNumberId: telecom.number, isPrimary: true,
    } });
    await prisma.contactPoint.create({ data: {
      id: telecom.point, environment: "TEST", channel: "SMS", address: numberAddress,
    } });
    await prisma.contactBinding.create({ data: {
      id: telecom.binding, contactPointId: telecom.point, customerId: rdfFixture.customer,
      source: "STAFF",
    } });
    await prisma.consentRecord.create({ data: {
      id: telecom.consent, contactPointId: telecom.point, customerId: rdfFixture.customer,
      kind: "COM_TEST_EVIDENCE", purpose: "SMS_TRANSACTIONAL", action: "REVOKE",
      source: "STAFF_EVIDENCE", occurredAt: businessDateFromKey("2026-09-01")!,
    } });
    // COM-L3: template, thread, message, read cursor and link survive real restore.
    await prisma.communicationTemplateRevision.create({ data: {
      id: telecom.revision, key: "restore-only", revision: 1, channel: "SMS",
      purpose: "TRANSACTIONAL", body: "Isolated restore-only template", isCurrent: true,
      createdByUserId: rdfFixture.user,
    } });
    await prisma.messageDelivery.create({ data: {
      id: telecom.delivery, idempotencyKey: telecom.delivery,
      channel: "SMS", purpose: "TRANSACTIONAL", recipientType: "Customer",
      recipientId: rdfFixture.customer, recipientAddress: numberAddress, templateKey: "restore-only",
      telecomAccountId: telecom.account, environment: "TEST", templateRevisionId: telecom.revision,
    } });
    await prisma.messageAttempt.create({ data: {
      id: telecom.attempt, deliveryId: telecom.delivery, accountId: telecom.account,
      attemptNumber: 1, operationKey: telecom.attempt, requestHash: "restore-test-hash",
      state: "NOT_SENT",
    } });
    await prisma.messageDelivery.update({ where: { id: telecom.delivery },
      data: { currentAttemptId: telecom.attempt } });
    await prisma.communicationThread.create({ data: {
      id: telecom.thread, accountId: telecom.account, businessNumberId: telecom.number,
      externalContactPointId: telecom.point, customerId: rdfFixture.customer, resolution: "RESOLVED",
    } });
    await prisma.communicationMessage.create({ data: {
      id: telecom.message, threadId: telecom.thread, accountId: telecom.account,
      direction: "OUTBOUND", deliveryId: telecom.delivery,
      providerResourceId: telecom.message, bodyHash: "restore-only-body-hash",
      occurredAt: new Date("2026-10-09T12:00:00.000Z"),
    } });
    await prisma.communicationLink.create({ data: {
      id: telecom.link, messageId: telecom.message, entityType: "Invoice",
      entityId: rdfFixture.invoice, source: "WORKFLOW",
    } });
    await prisma.communicationReadMarker.create({ data: {
      id: telecom.readMarker, threadId: telecom.thread,
      userId: rdfFixture.user, lastReadMessageId: telecom.message,
    } });
    // COM-L10: nonempty exact decimal telemetry and revision links must
    // survive actual backup/restore, including the deferred self-reference.
    await prisma.telecomSyncCursor.create({ data: {
      id: telecom.cursor, accountId: telecom.account, resource: "USAGE",
      windowStart: new Date("2026-10-01T00:00:00Z"),
      windowEnd: new Date("2026-11-01T00:00:00Z"),
      nextPageToken: "next-provider-page",
    } });
    await prisma.telecomUsageSnapshot.create({ data: {
      id: telecom.usage, accountId: telecom.account, category: "sms",
      startDate: new Date("2026-10-09T00:00:00Z"),
      endDate: new Date("2026-10-09T00:00:00Z"),
      count: "1.0000000000", countUnit: "messages",
      usage: "0.0000000001", usageUnit: "unit",
      price: "-0.0000000001", currency: "USD",
      providerAsOf: new Date("2026-10-10T00:00:00Z"),
      payloadHash: "a".repeat(64), providerSource: "twilio-usage",
    } });
    await prisma.telecomRateVersion.create({ data: {
      id: telecom.rate, accountId: telecom.account, service: "SMS",
      category: "outbound", destinationKey: "US:ALL", senderType: "local",
      component: "base", rate: "0.0010000001", currency: "USD",
      unit: "message", source: "PRICING_API",
      effectiveFrom: new Date("2026-10-01T00:00:00Z"),
      fetchedAt: new Date("2026-10-09T00:00:00Z"),
    } });
    await prisma.telecomStatement.create({ data: {
      id: telecom.statement, accountId: telecom.account,
      externalId: "restore-only-statement", currency: "USD",
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-10-31T00:00:00Z"),
      issueDate: new Date("2026-11-01T00:00:00Z"),
      privateEvidenceStorageKey: "telecom-statements/restore-only/statement.pdf",
      evidenceHash: "b".repeat(64), invoiceTotalCents: 11,
    } });
    await prisma.communicationCostFact.create({ data: {
      id: telecom.costBase, accountId: telecom.account,
      messageAttemptId: telecom.attempt, rateVersionId: telecom.rate,
      sourceKey: "restore-cost-original", component: "SMS",
      classification: "PROVIDER_REPORTED", amount: "-0.0000000001",
      currency: "USD", occurredAt: new Date("2026-10-09T00:00:00Z"),
    } });
    await prisma.communicationCostFact.create({ data: {
      id: telecom.costRevision, accountId: telecom.account,
      sourceKey: "restore-cost-revised", component: "SMS",
      classification: "PROVIDER_REPORTED", amount: "-0.0000000002",
      currency: "USD", occurredAt: new Date("2026-10-09T00:00:00Z"),
      supersedesId: telecom.costBase,
    } });
  });

  afterAll(async () => {
    await prisma.communicationCostFact.deleteMany({
      where: { id: { in: [telecom.costBase, telecom.costRevision] } },
    });
    await prisma.telecomStatement.deleteMany({ where: { id: telecom.statement } });
    await prisma.telecomRateVersion.deleteMany({ where: { id: telecom.rate } });
    await prisma.telecomUsageSnapshot.deleteMany({ where: { id: telecom.usage } });
    await prisma.telecomSyncCursor.deleteMany({ where: { id: telecom.cursor } });
    await prisma.communicationReadMarker.deleteMany({ where: { id: telecom.readMarker } });
    await prisma.communicationLink.deleteMany({ where: { id: telecom.link } });
    await prisma.communicationMessage.deleteMany({ where: { id: telecom.message } });
    await prisma.communicationThread.deleteMany({ where: { id: telecom.thread } });
    await prisma.messageDelivery.updateMany({ where: { id: telecom.delivery },
      data: { currentAttemptId: null } });
    await prisma.messageAttempt.deleteMany({ where: { id: telecom.attempt } });
    await prisma.messageDelivery.deleteMany({ where: { id: telecom.delivery } });
    await prisma.communicationTemplateRevision.deleteMany({ where: { id: telecom.revision } });
    await prisma.consentRecord.deleteMany({ where: { id: telecom.consent } });
    await prisma.contactBinding.deleteMany({ where: { id: telecom.binding } });
    await prisma.contactPoint.deleteMany({ where: { id: telecom.point } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: telecom.number } });
    await prisma.telecomAccount.deleteMany({ where: { id: telecom.account } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { id: rdfFixture.record } });
    await prisma.retailDeliveryFeeRate.deleteMany({ where: { id: rdfFixture.rate } });
    await prisma.invoice.deleteMany({ where: { id: rdfFixture.invoice } });
    await prisma.customer.deleteMany({ where: { id: rdfFixture.customer } });
    await prisma.user.deleteMany({ where: { id: rdfFixture.user } });
    if (target) await target.$disconnect();
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      await admin.query('DROP DATABASE IF EXISTS "' + restoreDatabaseName + '" WITH (FORCE)');
    } finally {
      await admin.end();
    }
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
    expect(await target.telecomAccount.findUniqueOrThrow({ where: { id: telecom.account } }))
      .toMatchObject({ provider: "twilio", environment: "TEST", status: "UNCONFIGURED" });
    expect(await target.businessPhoneNumber.findUniqueOrThrow({ where: { id: telecom.number } }))
      .toMatchObject({ accountId: telecom.account, address: numberAddress, isPrimary: true });
    expect(await target.contactBinding.findUniqueOrThrow({ where: { id: telecom.binding } }))
      .toMatchObject({ contactPointId: telecom.point, customerId: rdfFixture.customer, source: "STAFF" });
    expect(await target.messageAttempt.findUniqueOrThrow({ where: { id: telecom.attempt } }))
      .toMatchObject({ deliveryId: telecom.delivery, accountId: telecom.account, state: "NOT_SENT", attemptNumber: 1 });
    expect(await target.messageDelivery.findUniqueOrThrow({ where: { id: telecom.delivery } }))
      .toMatchObject({ currentAttemptId: telecom.attempt, channel: "SMS" });
    expect(await target.communicationTemplateRevision.findUniqueOrThrow({ where: { id: telecom.revision } }))
      .toMatchObject({ key: "restore-only", revision: 1, body: "Isolated restore-only template" });
    expect(await target.communicationThread.findUniqueOrThrow({ where: { id: telecom.thread } }))
      .toMatchObject({ accountId: telecom.account, customerId: rdfFixture.customer, resolution: "RESOLVED" });
    expect(await target.communicationMessage.findUniqueOrThrow({ where: { id: telecom.message } }))
      .toMatchObject({ threadId: telecom.thread, deliveryId: telecom.delivery, direction: "OUTBOUND" });
    expect(await target.communicationReadMarker.findUniqueOrThrow({ where: { id: telecom.readMarker } }))
      .toMatchObject({ userId: rdfFixture.user, lastReadMessageId: telecom.message });
    expect(await target.communicationLink.findUniqueOrThrow({ where: { id: telecom.link } }))
      .toMatchObject({ messageId: telecom.message, entityType: "Invoice", entityId: rdfFixture.invoice });
    expect(await target.messageDelivery.findUniqueOrThrow({ where: { id: telecom.delivery } }))
      .toMatchObject({ currentAttemptId: telecom.attempt, templateRevisionId: telecom.revision });
    expect(await target.consentRecord.findUniqueOrThrow({ where: { id: telecom.consent } }))
      .toMatchObject({ contactPointId: telecom.point, action: "REVOKE", purpose: "SMS_TRANSACTIONAL" });
    expect(await target.telecomSyncCursor.findUniqueOrThrow({
      where: { id: telecom.cursor },
    })).toMatchObject({ nextPageToken: "next-provider-page" });
    expect((await target.telecomUsageSnapshot.findUniqueOrThrow({
      where: { id: telecom.usage },
    })).price?.toFixed(10)).toBe("-0.0000000001");
    expect((await target.telecomRateVersion.findUniqueOrThrow({
      where: { id: telecom.rate },
    })).rate.toFixed(10)).toBe("0.0010000001");
    expect(await target.telecomStatement.findUniqueOrThrow({
      where: { id: telecom.statement },
    })).toMatchObject({ invoiceTotalCents: 11, state: "DRAFT" });
    expect(await target.communicationCostFact.findUniqueOrThrow({
      where: { id: telecom.costRevision },
    })).toMatchObject({ supersedesId: telecom.costBase, accountId: telecom.account });
    expect((await target.communicationCostFact.findUniqueOrThrow({
      where: { id: telecom.costBase },
    })).amount.toFixed(10)).toBe("-0.0000000001");
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
