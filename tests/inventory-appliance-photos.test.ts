import { describe, it, expect, vi, beforeEach } from "vitest";

// addAppliancePhoto (2026-09-28) — staff attach photos to a single
// appliance unit (see src/app/desk/inventory/[id]/appliance-detail-panel.tsx),
// separate from Photo.jobId (repair condition photos) and
// Photo.maintenanceRequestId (customer-submitted photos).

const photoCreate = vi.fn();
const auditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    photo: { create: (...args: unknown[]) => photoCreate(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
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
