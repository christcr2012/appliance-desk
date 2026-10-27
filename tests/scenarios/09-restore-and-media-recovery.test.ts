// PLAN scenario 9 (BATCH-F WU-F3): the business is rebuilt from its backups on a SEPARATE disposable database by the real
// restore script. Row counts and the key money totals match, provider-state rows come back, login credentials and sessions do not,
// the restore refuses any target that is not local, and private photos are recovered from the media manifest with matching
// hashes. The photo store is an in-memory fake; nothing here touches a hosted database, storage or provider.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Stored = { bytes: Uint8Array; contentType: string; etag: string };
const PRIVATE_TOKEN = ["vercel_blob_rw_", "test_syntheticvalue"].join("");
const BACKUP_TOKEN = ["vercel_blob_rw_", "backup_syntheticvalue"].join("");
const hostFor = (token: string) => (token === PRIVATE_TOKEN ? "test.private.blob.vercel-storage.com" : "backup.private.blob.vercel-storage.com");
const fake = vi.hoisted(() => ({ stores: new Map<string, Map<string, Stored>>() }));
const storeOf = (token: string) => {
  let store = fake.stores.get(token);
  if (!store) fake.stores.set(token, (store = new Map()));
  return store;
};
const pathOf = (value: string) => {
  try { return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, "")); } catch { return value; }
};
const urlOf = (token: string, pathname: string) => `https://${hostFor(token)}/${pathname}`;
const bytesOf = (value: unknown): Uint8Array => (typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer));
const etagOf = (bytes: Uint8Array) => `etag-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

vi.mock("@vercel/blob", () => {
  const meta = (token: string, pathname: string, item: Stored) => ({
    pathname, url: urlOf(token, pathname), downloadUrl: `${urlOf(token, pathname)}?download=1`, size: item.bytes.byteLength,
    uploadedAt: new Date("2026-10-06T00:00:00Z"), etag: item.etag, contentType: item.contentType, contentDisposition: "", cacheControl: "",
  });
  return {
    list: async (options: { prefix?: string; token?: string } = {}) => ({
      blobs: [...storeOf(options.token ?? "").entries()].filter(([p]) => p.startsWith(options.prefix ?? "")).sort(([a], [b]) => a.localeCompare(b)).map(([p, item]) => meta(options.token ?? "", p, item)),
      hasMore: false, cursor: undefined,
    }),
    get: async (value: string, options: { token?: string }) => {
      const token = options.token ?? "";
      const pathname = pathOf(value);
      const item = storeOf(token).get(pathname);
      if (!item) return null;
      return { statusCode: 200, stream: new Blob([item.bytes as BlobPart]).stream(), headers: new Headers(), blob: meta(token, pathname, item) };
    },
    put: async (pathname: string, body: unknown, options: { token?: string; contentType?: string; allowOverwrite?: boolean }) => {
      const token = options.token ?? "";
      if (storeOf(token).has(pathname) && options.allowOverwrite === false) throw new Error("fake Blob destination already exists");
      const bytes = bytesOf(body);
      const item = { bytes, contentType: options.contentType ?? "application/octet-stream", etag: etagOf(bytes) };
      storeOf(token).set(pathname, item);
      return meta(token, pathname, item);
    },
    copy: async (from: string, to: string, options: { token?: string; contentType?: string; allowOverwrite?: boolean }) => {
      const token = options.token ?? "";
      const source = storeOf(token).get(pathOf(from));
      if (!source) throw new Error(`fake Blob source missing: ${from}`);
      if (storeOf(token).has(to) && options.allowOverwrite === false) throw new Error("fake Blob destination already exists");
      const item = { bytes: new Uint8Array(source.bytes), contentType: options.contentType ?? source.contentType, etag: source.etag };
      storeOf(token).set(to, item);
      return meta(token, to, item);
    },
    del: async (values: string | string[], options: { token?: string }) => {
      for (const value of Array.isArray(values) ? values : [values]) storeOf(options.token ?? "").delete(pathOf(value));
    },
  };
});

import { BACKUP_TABLES } from "@/domains/backup/manifest";
import { buildDatabaseBackupSnapshot } from "@/domains/backup";
import { verifySchemaHealth } from "@/lib/schema-health";
import { prisma } from "@/lib/prisma";
import { restoreMediaFromManifest, runMediaInventoryAndCopy, verifyMediaRecoverySample } from "../../scripts/media-inventory";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const run = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const restoreDatabaseName = `appliance_desk_restore_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const restoreTarget = new URL(databaseUrl ?? "postgresql://test@localhost:5432/appliance_desk_test");
restoreTarget.pathname = `/${restoreDatabaseName}`;
const restoreUrl = restoreTarget.toString();
const enabled = process.env.CI === "true" && parsed !== null && ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("scenario 9: restore from backup and media recovery", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ids = { user: `sc9-user-${tag}`, customer: `sc9-customer-${tag}`, op: `sc9-op-${tag}`, openInvoice: `sc9-inv-open-${tag}`, backupArtifact: `sc9-backup-${tag}`, paidInvoice: `sc9-inv-paid-${tag}` };
  const photoIds = [`sc9-photo-a-${tag}`, `sc9-photo-b-${tag}`];
  const photoPaths = [`jobs/sc9${tag.slice(0, 12)}/before.jpg`, `maintenance-requests/sc9${tag.slice(0, 12)}/after.png`];
  const photoBytes = ["scenario nine photo alpha", "scenario nine photo bravo"].map(bytesOf);
  const saved: Record<string, string | undefined> = {};
  let directory = "";
  let target: PrismaClient;
  let snapshot: Awaited<ReturnType<typeof buildDatabaseBackupSnapshot>>;
  let backupFile = "";

  beforeAll(async () => {
    for (const key of ["PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", "PRIVATE_PHOTO_BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "BACKUP_BLOB_STORE_ID", "BACKUP_BLOB_READ_WRITE_TOKEN", "VERCEL", "VERCEL_ENV"]) saved[key] = process.env[key];
    process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN = PRIVATE_TOKEN;
    process.env.PRIVATE_PHOTO_BLOB_STORE_ID = "store_test";
    process.env.BLOB_READ_WRITE_TOKEN = BACKUP_TOKEN;
    process.env.BACKUP_BLOB_STORE_ID = "store_backup";
    process.env.BACKUP_BLOB_READ_WRITE_TOKEN = BACKUP_TOKEN;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    directory = await mkdtemp(path.join(tmpdir(), "appliance-desk-sc9-"));
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try { await admin.query(`CREATE DATABASE "${restoreDatabaseName}"`); } finally { await admin.end(); }
    target = new PrismaClient({ adapter: new PrismaPg({ connectionString: restoreUrl }) });

    // The business as it stands: a customer who owes one bill and has paid another, a login with a session, a provider operation
    // that is still unresolved, and two private photos whose bytes live in the photo store.
    await prisma.user.create({ data: { id: ids.user, email: `${tag}@example.test`, name: "SC9 Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: ids.customer, userId: ids.user, referralCode: `S9${tag.slice(0, 14)}` } });
    await prisma.account.create({ data: { userId: ids.user, accountId: ids.user, providerId: "credential", password: "scenario-hash" } });
    await prisma.session.create({ data: { userId: ids.user, token: `sc9-session-${tag}`, expiresAt: new Date(Date.now() + 3_600_000) } });
    await prisma.invoice.create({ data: { id: ids.openInvoice, customerId: ids.customer, status: "OPEN", amountDueCents: 6000, lineItems: { create: { kind: "RENTAL", description: "SC9 open", amountCents: 6000 } } } });
    await prisma.invoice.create({ data: { id: ids.paidInvoice, customerId: ids.customer, status: "PAID", amountDueCents: 4000, amountPaidCents: 4000, lineItems: { create: { kind: "RENTAL", description: "SC9 paid", amountCents: 4000 } } } });
    await prisma.payment.create({ data: { invoiceId: ids.paidInvoice, amountCents: 4000, method: "check", status: "SUCCEEDED" } });
    await prisma.receipt.create({ data: { customerId: ids.customer, source: "MANUAL", amountCents: 4000, method: "check", receivedOn: new Date() } });
    await prisma.customerCredit.create({ data: { customerId: ids.customer, amountCents: 1500, remainingCents: 1500, reason: "sc9" } });
    await prisma.providerOperation.create({ data: { id: ids.op, kind: "SUBSCRIPTION_CREATE", subjectType: "RentalAgreement", subjectId: `sc9-agreement-${tag}`, idempotencyKey: `sc9-op-key-${tag}`, status: "UNKNOWN", attempts: 2, lastError: "provider outcome unknown" } });
    // A media manifest can only belong to a hash-verified database artifact.
    // Keep the fake ledger row in the disposable snapshot and remove it on cleanup.
    await prisma.backupArtifact.create({ data: {
      id: ids.backupArtifact,
      kind: "DATABASE", state: "VERIFIED",
      pathname: "backups/sc9-" + tag + ".json",
      formatVersion: 2, sizeBytes: 42, sha256: "a".repeat(64),
      verifiedAt: new Date("2026-10-06T08:00:00Z"),
    } });
    for (const [i, pathname] of photoPaths.entries()) {
      storeOf(PRIVATE_TOKEN).set(pathname, { bytes: photoBytes[i], contentType: i === 0 ? "image/jpeg" : "image/png", etag: etagOf(photoBytes[i]) });
      await prisma.photo.create({ data: { id: photoIds[i], url: urlOf(PRIVATE_TOKEN, pathname) } });
    }
  }, 60_000);
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.backupArtifact.deleteMany({ where: { databaseArtifactId: ids.backupArtifact } });
    await prisma.backupArtifact.deleteMany({ where: { id: ids.backupArtifact } });
    await prisma.photo.deleteMany({ where: { id: { in: photoIds } } });
    await prisma.providerOperation.deleteMany({ where: { id: ids.op } });
    await prisma.customerCredit.deleteMany({ where: { customerId: ids.customer } });
    await prisma.receipt.deleteMany({ where: { customerId: ids.customer } });
    await prisma.payment.deleteMany({ where: { invoiceId: ids.paidInvoice } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { customerId: ids.customer } } });
    await prisma.invoice.deleteMany({ where: { customerId: ids.customer } });
    await prisma.session.deleteMany({ where: { userId: ids.user } });
    await prisma.account.deleteMany({ where: { userId: ids.user } });
    await prisma.customer.deleteMany({ where: { id: ids.customer } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    if (target) await target.$disconnect();
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try { await admin.query(`DROP DATABASE IF EXISTS "${restoreDatabaseName}" WITH (FORCE)`); } finally { await admin.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 60_000);

  it("rebuilds the business on a separate database: every table, the money totals, provider state; not credentials", async () => {
    snapshot = await buildDatabaseBackupSnapshot();
    backupFile = path.join(directory, "backup.json");
    await writeFile(backupFile, JSON.stringify(snapshot.payload), "utf8");
    const { stdout, stderr } = await run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/restore-backup.ts", backupFile, "--into", restoreUrl], { cwd: process.cwd(), env: process.env, maxBuffer: 10 * 1024 * 1024 });
    expect(stderr).toBe("");
    expect(stdout).toContain("Schema health check passed");

    const delegates = target as unknown as Record<string, { count?: () => Promise<number> }>;
    for (const table of BACKUP_TABLES) expect(await delegates[table]!.count!(), table).toBe(snapshot.payload.tables[table]!.length);

    // The key totals match to the cent between the live data and the rebuilt copy.
    const totals = async (db: PrismaClient | typeof prisma) => ({
      invoiced: (await db.invoice.aggregate({ where: { customerId: ids.customer }, _sum: { amountDueCents: true, amountPaidCents: true } }))._sum,
      payments: (await db.payment.aggregate({ where: { invoiceId: ids.paidInvoice }, _sum: { amountCents: true } }))._sum.amountCents,
      receipts: (await db.receipt.aggregate({ where: { customerId: ids.customer }, _sum: { amountCents: true } }))._sum.amountCents,
      credit: (await db.customerCredit.aggregate({ where: { customerId: ids.customer }, _sum: { remainingCents: true } }))._sum.remainingCents,
    });
    const live = await totals(prisma);
    expect(live).toEqual({ invoiced: { amountDueCents: 10000, amountPaidCents: 4000 }, payments: 4000, receipts: 4000, credit: 1500 });
    expect(await totals(target)).toEqual(live);

    // Provider state comes back as it was (an unresolved operation stays unresolved, so nothing is blindly repeated)...
    expect(await target.providerOperation.findUniqueOrThrow({ where: { id: ids.op } })).toMatchObject({ status: "UNKNOWN", attempts: 2, idempotencyKey: `sc9-op-key-${tag}` });
    // ...but login credentials and sessions are never copied into a backup.
    expect(await target.account.count()).toBe(0);
    expect(await target.session.count()).toBe(0);
    expect(JSON.stringify(snapshot.payload)).not.toContain("scenario-hash");
    expect(JSON.stringify(snapshot.payload)).not.toContain(`sc9-session-${tag}`);
    expect((await target.user.findUniqueOrThrow({ where: { id: ids.user } })).email).toBe(`${tag}@example.test`);
    await verifySchemaHealth(target);
  }, 240_000);

  it("refuses a target that is not this machine, before reading or writing anything", async () => {
    await expect(
      run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/restore-backup.ts", backupFile, "--into", "postgresql://postgres:pw@db.example.com:5432/appliance_desk_restore_x"], { cwd: process.cwd(), env: process.env }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Restore refused") });
  }, 120_000);

  it("copies the private photos with their hashes, then brings them back after the originals are lost", async () => {
    const backupUrl = urlOf(BACKUP_TOKEN, `backups/sc9-${tag}.json`);
    const result = await runMediaInventoryAndCopy({
      databaseArtifactId: ids.backupArtifact,
      databaseBackupUrl: backupUrl,
      now: new Date("2026-10-06T09:00:00Z"),
    });
    const mine = result.manifest.entries.filter((e) => photoIds.includes(e.photoId));
    expect(mine).toHaveLength(2);
    for (const [i, entry] of photoIds.map((id) => mine.find((e) => e.photoId === id)!).entries()) {
      expect(entry).toMatchObject({ status: "COPIED", sourcePath: photoPaths[i], size: photoBytes[i].byteLength, sha256: sha(photoBytes[i]) });
      expect(storeOf(PRIVATE_TOKEN).get(entry.recoveryPath!)!.bytes).toEqual(photoBytes[i]);
    }
    expect((await verifyMediaRecoverySample(result.manifestUrl, mine.length)).checked).toBe(mine.length);

    // Disaster: the originals disappear; the manifest puts back exactly the same bytes.
    for (const pathname of photoPaths) storeOf(PRIVATE_TOKEN).delete(pathname);
    const restored = await restoreMediaFromManifest(result.manifestUrl);
    expect(restored.restored).toBeGreaterThanOrEqual(2);
    for (const [i, pathname] of photoPaths.entries()) expect(sha(storeOf(PRIVATE_TOKEN).get(pathname)!.bytes)).toBe(sha(photoBytes[i]));
    // Running it again changes nothing.
    expect((await restoreMediaFromManifest(result.manifestUrl)).restored).toBe(0);
  }, 120_000);
});
