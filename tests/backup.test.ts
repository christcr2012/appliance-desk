import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Independent daily backup (Task flagged by the 2026-09-29 audit,
// docs/ROADMAP.md) — see src/domains/backup/index.ts.

const putMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
const getMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args),
  get: (...args: unknown[]) => getMock(...args),
}));

// Derive fixtures independently from the schema, not the export's table list.
const SCHEMA_MODELS = [...readFileSync("prisma/schema.prisma", "utf8").matchAll(/^model (\w+) \{/gm)]
  .map((match) => match[1]!);
const EXCLUDED_MODELS = ["Session", "Account", "Verification", "RateLimit", "TwoFactor", "OpsAgentKey", "TeamInvitation", "StoredFileCleanup"];
const BACKUP_TABLES = SCHEMA_MODELS.filter((model) => !EXCLUDED_MODELS.includes(model))
  .map((model) => model[0]!.toLowerCase() + model.slice(1));
const ALL_TABLES = SCHEMA_MODELS.map((model) => model[0]!.toLowerCase() + model.slice(1));

function makePrismaMock() {
  const model: Record<string, { findMany: () => Promise<unknown[]> }> = {};
  for (const table of ALL_TABLES) {
    model[table] = { findMany: vi.fn().mockResolvedValue([{ id: table === "customer" ? "cust-1" : `${table}-1` }]) };
  }
  return model;
}

const transactionMock = vi.fn();
const queryRawMock = vi.fn();
type PrismaMock = Record<string, { findMany: ReturnType<typeof vi.fn> }> & {
  $transaction: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
};
const prismaMock = {
  ...makePrismaMock(),
  $transaction: transactionMock,
  $queryRaw: queryRawMock,
} as PrismaMock;

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const deliverMessageMock = vi.fn();
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliverMessageMock(...args),
}));

const getBusinessSettingsMock = vi.fn().mockResolvedValue({ publicEmail: "chris@example.com" });
vi.mock("@/domains/settings", () => ({ getBusinessSettings: () => getBusinessSettingsMock() }));

beforeEach(() => {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([{ migration_name: "20261008010000_batch_e_messaging" }]);
  transactionMock.mockImplementation(
    async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
  );
  for (const table of ALL_TABLES) {
    prismaMock[table]!.findMany = vi
      .fn()
      .mockResolvedValue([{ id: table === "customer" ? "cust-1" : `${table}-1` }]);
  }
  vi.stubEnv("APP_ENV", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("BACKUP_BLOB_STORE_ID", "store_SyntheticBackup");
  vi.stubEnv("BACKUP_BLOB_READ_WRITE_TOKEN", ["vercel","blob","rw","SyntheticBackup","fake"].join("_"));
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", ["vercel","blob","rw","SyntheticPublic","fake"].join("_"));
  const ledger = prismaMock.backupArtifact! as unknown as Record<string, ReturnType<typeof vi.fn>>;
  ledger.create = vi.fn(async ({data}: {data: unknown}) => ({ id:"artifact-fixture", ...data as object }));
  ledger.update = vi.fn(async ({data}: {data: unknown}) => ({ id:"artifact-fixture", ...data as object }));
  ledger.findFirst = vi.fn(async () => null);
  ledger.findUnique = vi.fn(async () => null);
  ledger.count = vi.fn(async () => 0);
  ledger.findMany = vi.fn(async (query?: unknown) => query
    ? [] : [{ id:"backupArtifact-1" }]);
  (prismaMock.businessSettings! as unknown as Record<string, ReturnType<typeof vi.fn>>).findUniqueOrThrow =
    vi.fn(async () => ({ backupRetentionDays: 30 }));
  getBusinessSettingsMock.mockResolvedValue({ publicEmail: "chris@example.com" });
  deliverMessageMock.mockResolvedValue({ state: "ACCEPTED", deliveryId: "backup-alert", providerMessageId: "msg-1" });
  listMock.mockResolvedValue({ blobs: [], hasMore: false });
  putMock.mockImplementation(async (pathname: string) => ({
    pathname, url: `https://syntheticbackup.private.blob.vercel-storage.com/${pathname}`,
  }));
  getMock.mockImplementation(async (pathname: string) => ({
    statusCode: 200, blob: { pathname },
    stream: new Blob([putMock.mock.calls.at(-1)?.[1] as Uint8Array]).stream(),
  }));
});

afterEach(() => vi.unstubAllEnvs());

describe("backup schema policy", () => {
  it("requires an explicit export or exclusion decision for every schema model", async () => {
    const { BACKUP_MODEL_POLICY, BACKUP_TABLES: exportedTables } = await import("@/domains/backup/manifest");
    expect(Object.keys(BACKUP_MODEL_POLICY).sort()).toEqual([...SCHEMA_MODELS].sort());
    expect(Object.entries(BACKUP_MODEL_POLICY).filter(([, value]) => value === null).map(([key]) => key).sort())
      .toEqual([...EXCLUDED_MODELS].sort());
    expect([...exportedTables].sort()).toEqual([...BACKUP_TABLES].sort());
    expect(new Set(exportedTables).size).toBe(exportedTables.length);
  });
});

describe("exportDatabaseBackup", () => {
  it("reads every business table and uploads a single private JSON blob", async () => {
    const { exportDatabaseBackup } = await import("@/domains/backup");
    const result = await exportDatabaseBackup();

    expect(result.ok).toBe(true);
    expect(result.url).toMatch(/^https:\/\/syntheticbackup\.private\.blob\.vercel-storage\.com\/backups\//);
    expect(result.tableCounts?.customer).toBe(1);

    for (const table of BACKUP_TABLES) {
      expect(prismaMock[table]!.findMany).toHaveBeenCalled();
    }

    expect(putMock).toHaveBeenCalledTimes(1);
    const [filename, payload, options] = putMock.mock.calls[0] as [string, Uint8Array, Record<string, unknown>];
    expect(filename).toMatch(/^backups\/\d{4}-\d{2}-\d{2}-\d+\.json$/);
    expect(options.access).toBe("private");
    expect(options.token).toBe(["vercel","blob","rw","SyntheticBackup","fake"].join("_"));
    const parsed = JSON.parse(Buffer.from(payload).toString("utf8"));
    expect(parsed.formatVersion).toBe(2);
    expect(parsed.migrationId).toBe("20261008010000_batch_e_messaging");
    expect(typeof parsed.appVersion).toBe("string");
    expect(new Date(parsed.exportedAt).toString()).not.toBe("Invalid Date");
    expect(parsed.tables.customer).toEqual([{ id: "cust-1" }]);
    expect(Object.keys(parsed.tables).sort()).toEqual([...BACKUP_TABLES].sort());
    for (const table of BACKUP_TABLES) {
      const row = { id: table === "customer" ? "cust-1" : `${table}-1` };
      // Agent credential hashes never appear in exports, and restored notes
      // must not retain foreign keys to intentionally excluded private keys.
      expect(parsed.tables[table]).toEqual([table === "systemIssueNote"
        ? { ...row, authorKeyId: null } : row]);
      expect(result.tableCounts?.[table]).toBe(1);
    }
    expect(transactionMock.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead", timeout: 120_000, maxWait: 20_000 });
    for (const model of EXCLUDED_MODELS) {
      const table = model[0]!.toLowerCase() + model.slice(1);
      expect(prismaMock[table]!.findMany).not.toHaveBeenCalled();
    }
  });

  it("keeps a verified private copy when pruning legacy paths is not justified", async () => {
    listMock.mockResolvedValue({ blobs: [{ pathname: "backups/2020-01-01-old.json" }], hasMore: false });
    const { exportDatabaseBackup } = await import("@/domains/backup");
    const result = await exportDatabaseBackup();
    expect(result.ok).toBe(true);
    expect(result.prunedCount).toBe(0);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("returns ok: false with the error message when a table read fails, without throwing", async () => {
    prismaMock.customer!.findMany = vi.fn().mockRejectedValue(new Error("connection reset"));

    const { exportDatabaseBackup } = await import("@/domains/backup");
    const result = await exportDatabaseBackup();

    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("BACKUP_CAPTURE");
    expect(result.failureStage).toBe("capture");
    expect(JSON.stringify(result)).not.toContain("connection reset");
    expect(putMock).not.toHaveBeenCalled();
  });
  it("does not upload or prune when a newly covered table cannot be read", async () => {
    prismaMock.purchaseOrderLineItem!.findMany = vi.fn().mockRejectedValue(new Error("purchase order read failed"));
    const { exportDatabaseBackup } = await import("@/domains/backup");
    const failure = await exportDatabaseBackup();
    expect(failure).toMatchObject({ ok: false, failureCode: "BACKUP_CAPTURE", failureStage: "capture" });
    expect(JSON.stringify(failure)).not.toContain("purchase order read failed");
    expect(putMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

});

describe("sendBackupFailureAlertToChris", () => {
  it("records one staff alert when the backup failed", async () => {
    const { sendBackupFailureAlertToChris } = await import("@/domains/backup");
    // MCP-1 canary: the raw error (planted secret, email, phone) must never reach the email body.
    await sendBackupFailureAlertToChris({ ok: false, error: "connection reset sk_live_canary_x person@example.test 970-555-0142" });

    expect(deliverMessageMock).toHaveBeenCalledTimes(1);
    const [input] = deliverMessageMock.mock.calls[0] as [{
      idempotencyKey: string;
      recipient: { address: string };
      templateKey: string;
      render: () => { subject?: string; text: string };
    }];
    expect(input.recipient.address).toBe("chris@example.com");
    expect(input.templateKey).toBe("backup-failure");
    expect(input.idempotencyKey).toMatch(/^backup-failure-/);
    expect(input.render().subject).toMatch(/backup failed/i);
    const text = input.render().text;
    for (const leaked of ["connection reset", "sk_live_canary", "person@example.test", "555-0142"]) expect(text).not.toContain(leaked);
    expect(text).toContain("System health");
  });

  it("stays silent when the backup succeeded", async () => {
    const { sendBackupFailureAlertToChris } = await import("@/domains/backup");
    await sendBackupFailureAlertToChris({ ok: true, url: "https://blob.example.com/x.json" });

    expect(deliverMessageMock).not.toHaveBeenCalled();
  });
});

