import { describe, it, expect, vi, beforeEach } from "vitest";

// createMaintenanceRequestForUser's photo handling (2026-09-28) — a
// customer can attach photos when submitting a maintenance request (see
// src/app/account/maintenance/new-request-form.tsx). This checks the
// pure wiring (photoUrls -> a nested Photo `create`, blanks filtered out)
// with a mocked Prisma; the real-database version of this (actual rows,
// actual foreign keys) is tests/customer-isolation.test.ts, which runs
// only in CI (see that file's own comment on why).

const customerFindUnique = vi.fn();
const maintenanceRequestCreate = vi.fn();
const auditLogCreate = vi.fn();
const deliverMessage = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: (...args: unknown[]) => customerFindUnique(...args) },
    maintenanceRequest: { create: (...args: unknown[]) => maintenanceRequestCreate(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
}));

vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliverMessage(...args),
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: vi.fn().mockResolvedValue({ publicEmail: "ops@example.com" }),
}));

vi.mock("@/domains/agreements/active-appliances", () => ({
  ACTIVE_ASSIGNMENT_WHERE: {},
  getActiveApplianceOptionsForUser: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/photo-storage", () => ({
  getPrivatePhotoStore: () => ({ storeId: "store_abc123", token: "t" }),
  privatePhotoPathFromUrl: (value: string) => {
    const m = /^https:\/\/abc123\.private\.blob\.vercel-storage\.com\/(.+)$/.exec(value);
    return m ? m[1] : null;
  },
}));

import { createMaintenanceRequestForUser } from "@/domains/portal";

const A = "https://abc123.private.blob.vercel-storage.com/maintenance-requests/cust-1/a.jpg";
const B = "https://abc123.private.blob.vercel-storage.com/maintenance-requests/cust-1/b.jpg";

describe("createMaintenanceRequestForUser photo handling", () => {
  beforeEach(() => {
    customerFindUnique.mockReset().mockResolvedValue({
      id: "cust-1",
      user: { name: "Jane Doe", email: "jane@example.com" },
    });
    maintenanceRequestCreate.mockReset().mockImplementation(({ data }) =>
      Promise.resolve({ id: "req-1", priority: data.priority ?? "NORMAL", ...data }),
    );
    auditLogCreate.mockReset().mockResolvedValue({});
    deliverMessage.mockReset().mockResolvedValue({
      state: "ACCEPTED",
      deliveryId: "maintenance-alert",
      providerMessageId: "msg-1",
    });
  });

  it("nests photoUrls as a Photo create when photos are given", async () => {
    await createMaintenanceRequestForUser("user-1", {
      problem: "Leaking",
      photoUrls: [A, B],
    });

    const data = maintenanceRequestCreate.mock.calls[0][0].data;
    expect(data.photos).toEqual({
      create: [{ url: A }, { url: B }],
    });
  });

  it("filters out empty/falsy entries rather than creating a blank Photo row", async () => {
    await createMaintenanceRequestForUser("user-1", {
      problem: "Leaking",
      photoUrls: [A, ""],
    });

    const data = maintenanceRequestCreate.mock.calls[0][0].data;
    expect(data.photos).toEqual({ create: [{ url: A }] });
  });

  it("omits the photos key entirely when no photos are given (most requests)", async () => {
    await createMaintenanceRequestForUser("user-1", { problem: "General question" });

    const data = maintenanceRequestCreate.mock.calls[0][0].data;
    expect(data.photos).toBeUndefined();
  });

  it.each([
    "https://blob.example.com/a.jpg",
    "javascript:alert(1)",
    "https://abc123.private.blob.vercel-storage.com/maintenance-requests/cust-2/a.jpg",
    "https://abc123.private.blob.vercel-storage.com/expenses/cust-1/a.jpg",
  ])("refuses a photo that is not in the customer's own upload folder: %s", async (bad) => {
    await expect(
      createMaintenanceRequestForUser("user-1", { problem: "Leaking", photoUrls: [bad] }),
    ).rejects.toThrow(/wasn't uploaded through your account/);
    expect(maintenanceRequestCreate).not.toHaveBeenCalled();
  });
});
