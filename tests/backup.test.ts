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

// Every model the backup exports from, each returning a small fixture so
// we can assert the export actually reads real data rather than an empty
// shell. Kept in sync with BACKUP_TABLES in src/domains/backup/index.ts.
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

function makePrismaMock() {
  const model: Record<string, { findMany: () => Promise<unknown[]> }> = {};
  for (const table of BACKUP_TABLES) {
    model[table] = { findMany: vi.fn().mockResolvedValue(table === "customer" ? [{ id: "cust-1" }] : []) };
  }
  return model;
}

const prismaMock = makePrismaMock();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const sendEmailMock = vi.fn();
vi.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...args) }));

const getBusinessSettingsMock = vi.fn().mockResolvedValue({ publicEmail: "chris@example.com" });
vi.mock("@/domains/settings", () => ({ getBusinessSettings: () => getBusinessSettingsMock() }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const table of BACKUP_TABLES) {
    prismaMock[table]!.findMany = vi
      .fn()
      .mockResolvedValue(table === "customer" ? [{ id: "cust-1" }] : []);
  }
  getBusinessSettingsMock.mockResolvedValue({ publicEmail: "chris@example.com" });
  listMock.mockResolvedValue({ blobs: [] });
  putMock.mockResolvedValue({ url: "https://blob.example.com/backups/2026-09-29-123.json" });
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
    expect(parsed.tables.customer).toEqual([{ id: "cust-1" }]);
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
});

describe("sendBackupFailureAlertToChris", () => {
  it("emails Chris when the backup failed", async () => {
    const { sendBackupFailureAlertToChris } = await import("@/domains/backup");
    await sendBackupFailureAlertToChris({ ok: false, error: "connection reset" });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [args] = sendEmailMock.mock.calls[0] as [{ to: string; subject: string; text: string }];
    expect(args.to).toBe("chris@example.com");
    expect(args.subject).toMatch(/backup failed/i);
    expect(args.text).toContain("connection reset");
  });

  it("stays silent when the backup succeeded", async () => {
    const { sendBackupFailureAlertToChris } = await import("@/domains/backup");
    await sendBackupFailureAlertToChris({ ok: true, url: "https://blob.example.com/x.json" });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
