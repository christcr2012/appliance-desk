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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: (...args: unknown[]) => customerFindUnique(...args) },
    maintenanceRequest: { create: (...args: unknown[]) => maintenanceRequestCreate(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: vi.fn().mockResolvedValue({ publicEmail: "ops@example.com" }),
}));

vi.mock("@/domains/agreements/active-appliances", () => ({
  ACTIVE_ASSIGNMENT_WHERE: {},
  getActiveApplianceOptionsForUser: vi.fn().mockResolvedValue([]),
}));

import { createMaintenanceRequestForUser } from "@/domains/portal";

describe("createMaintenanceRequestForUser photo handling", () => {
  beforeEach(() => {
    customerFindUnique.mockReset().mockResolvedValue({
      id: "cust-1",
      user: { name: "Jane Doe", email: "jane@example.com" },
    });
    maintenanceRequestCreate.mockReset().mockImplementation(({ data }) =>
      Promise.resolve({ id: "req-1", ...data }),
    );
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("nests photoUrls as a Photo create when photos are given", async () => {
    await createMaintenanceRequestForUser("user-1", {
      problem: "Leaking",
      photoUrls: ["https://blob.example.com/a.jpg", "https://blob.example.com/b.jpg"],
    });

    const data = maintenanceRequestCreate.mock.calls[0][0].data;
    expect(data.photos).toEqual({
      create: [{ url: "https://blob.example.com/a.jpg" }, { url: "https://blob.example.com/b.jpg" }],
    });
  });

  it("filters out empty/falsy entries rather than creating a blank Photo row", async () => {
    await createMaintenanceRequestForUser("user-1", {
      problem: "Leaking",
      photoUrls: ["https://blob.example.com/a.jpg", ""],
    });

    const data = maintenanceRequestCreate.mock.calls[0][0].data;
    expect(data.photos).toEqual({ create: [{ url: "https://blob.example.com/a.jpg" }] });
  });

  it("omits the photos key entirely when no photos are given (most requests)", async () => {
    await createMaintenanceRequestForUser("user-1", { problem: "General question" });

    const data = maintenanceRequestCreate.mock.calls[0][0].data;
    expect(data.photos).toBeUndefined();
  });
});
