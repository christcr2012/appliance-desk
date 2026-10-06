import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Independent daily backup (Task flagged by the 2026-09-29 audit,
// docs/ROADMAP.md) — see src/domains/backup/index.ts.

const putMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

// Derive fixtures independently from the schema, not the export's table list.
const SCHEMA_MODELS = [...readFileSync("prisma/schema.prisma", "utf8").matchAll(/^model (\w+) \{/gm)]
  .map((match) => match[1]!);
const EXCLUDED_MODELS = ["Session", "Account", "Verification"];
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
  getBusinessSettingsMock.mockResolvedValue({ publicEmail: "chris@example.com" });
  deliverMessageMock.mockResolvedValue({ state: "ACCEPTED", deliveryId: "backup-alert", providerMessageId: "msg-1" });
  listMock.mockResolvedValue({ blobs: [] });
  putMock.mockResolvedValue({ url: "https://blob.example.com/backups/2026-09-29-123.json" });
});

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
    expect(result.url).toBe("https://blob.example.com/backups/2026-09-29-123.json");
    expect(result.tableCounts?.customer).toBe(1);

    for (const table of BACKUP_TABLES) {
      expect(prismaMock[table]!.findMany).toHaveBeenCalledTimes(1);
    }

    expect(putMock).toHaveBeenCalledTimes(1);
    const [filename, payload, options] = putMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(filename).toMatch(/^backups\/\d{4}-\d{2}-\d{2}-\d+\.json$/);
    expect(options.access).toBe("private");
    const parsed = JSON.parse(payload);
    expect(parsed.formatVersion).toBe(2);
    expect(parsed.migrationId).toBe("20261008010000_batch_e_messaging");
    expect(typeof parsed.appVersion).toBe("string");
    expect(new Date(parsed.exportedAt).toString()).not.toBe("Invalid Date");
    expect(parsed.tables.customer).toEqual([{ id: "cust-1" }]);
    expect(Object.keys(parsed.tables).sort()).toEqual([...BACKUP_TABLES].sort());
    for (const table of BACKUP_TABLES) {
      expect(parsed.tables[table]).toEqual([{ id: table === "customer" ? "cust-1" : `${table}-1` }]);
      expect(result.tableCounts?.[table]).toBe(1);
    }
    expect(transactionMock.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead" });
    for (const model of EXCLUDED_MODELS) {
      const table = model[0]!.toLowerCase() + model.slice(1);
      expect(prismaMock[table]!.findMany).not.toHaveBeenCalled();
    }
  });

  it("deletes backups older than the retention window and reports how many", async () => {
    listMock.mockResolvedValue({
      blobs: [
        { pathname: "backups/2020-01-01-1.json", url: "https://blob.example.com/backups/2020-01-01-1.json" },
        { pathname: "backups/2099-01-01-2.json", url: "https://blob.example.com/backups/2099-01-01-2.json" },
      ],
    });

    const { exportDatabaseBackup } = await import("@/domains/backup");
    const result = await exportDatabaseBackup();

    expect(result.prunedCount).toBe(1);
    expect(delMock).toHaveBeenCalledWith(["https://blob.example.com/backups/2020-01-01-1.json"]);
  });

  it("returns ok: false with the error message when a table read fails, without throwing", async () => {
    prismaMock.customer!.findMany = vi.fn().mockRejectedValue(new Error("connection reset"));

    const { exportDatabaseBackup } = await import("@/domains/backup");
    const result = await exportDatabaseBackup();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("connection reset");
    expect(putMock).not.toHaveBeenCalled();
  });
  it("does not upload or prune when a newly covered table cannot be read", async () => {
    prismaMock.purchaseOrderLineItem!.findMany = vi.fn().mockRejectedValue(new Error("purchase order read failed"));
    const { exportDatabaseBackup } = await import("@/domains/backup");
    expect(await exportDatabaseBackup()).toEqual({ ok: false, error: "purchase order read failed" });
    expect(putMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

});

describe("sendBackupFailureAlertToChris", () => {
  it("records one staff alert when the backup failed", async () => {
    const { sendBackupFailureAlertToChris } = await import("@/domains/backup");
    await sendBackupFailureAlertToChris({ ok: false, error: "connection reset" });

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
    expect(input.render().text).toContain("connection reset");
  });

  it("stays silent when the backup succeeded", async () => {
    const { sendBackupFailureAlertToChris } = await import("@/domains/backup");
    await sendBackupFailureAlertToChris({ ok: true, url: "https://blob.example.com/x.json" });

    expect(deliverMessageMock).not.toHaveBeenCalled();
  });
});

