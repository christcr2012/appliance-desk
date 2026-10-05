import { describe, it, expect, vi, beforeEach } from "vitest";

// addAppliancePhoto (2026-09-28) — staff attach photos to a single
// appliance unit (see src/app/desk/inventory/[id]/appliance-detail-panel.tsx),
// separate from Photo.jobId (repair condition photos) and
// Photo.maintenanceRequestId (customer-submitted photos).

const photoCreate = vi.fn();
const auditLogCreate = vi.fn();

// The command now runs in one transaction: it re-checks the acting team member, locks the
// appliance row, then writes the photo and the audit entry together (R13).
const tx = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: "OWNER", archivedAt: null }) },
  appliance: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "app-1" }) },
  photo: { create: (...args: unknown[]) => photoCreate(...args) },
  auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
};
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

import { addAppliancePhoto } from "@/domains/inventory";

describe("addAppliancePhoto", () => {
  beforeEach(() => {
    photoCreate.mockReset().mockImplementation(({ data }) =>
      Promise.resolve({ id: "photo-1", ...data }),
    );
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("creates a Photo row tied to the appliance and logs it", async () => {
    const photo = await addAppliancePhoto("user-1", "app-1", {
      url: "https://blob.example.com/unit.jpg",
      altText: "Serial plate",
    });

    expect(photoCreate).toHaveBeenCalledWith({
      data: { applianceId: "app-1", url: "https://blob.example.com/unit.jpg", altText: "Serial plate" },
    });
    expect(photo.id).toBe("photo-1");
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "appliance.unit.photo.add",
        entityType: "Appliance",
        entityId: "app-1",
      },
    });
  });

  it("stores a null altText when none is given, rather than an empty string", async () => {
    await addAppliancePhoto("user-1", "app-1", { url: "https://blob.example.com/unit.jpg" });

    const data = photoCreate.mock.calls[0][0].data;
    expect(data.altText).toBeNull();
  });
});
