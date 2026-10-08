import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
const photoFindUnique = vi.fn();
const blobGet = vi.fn();
const filingPhotoFindFirst = vi.fn();

vi.mock("@/lib/session", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    photo: { findUnique: (...args: unknown[]) => photoFindUnique(...args) },
    taxFilingPeriod: { findFirst: (...args: unknown[]) => filingPhotoFindFirst(...args) },
  },
}));

vi.mock("@vercel/blob", () => ({
  get: (...args: unknown[]) => blobGet(...args),
}));

vi.mock("@/lib/photo-storage", () => ({
  getPrivatePhotoStore: () => ({ token: "private-token", storeId: "store_teststore" }),
  privatePhotoPathFromUrl: (source: string, storeId: string) => {
    try {
      const url = new URL(source);
      if (storeId === "store_teststore" &&
          url.hostname === "teststore.private.blob.vercel-storage.com") {
        return url.pathname.slice(1);
      }
    } catch { /* Invalid URL has no trusted private pathname. */ }
    return null;
  },
}));

import { GET } from "@/app/api/photos/[id]/route";

const privateUrl =
  "https://teststore.private.blob.vercel-storage.com/jobs/job-1/photo.jpg";

function requestPhoto(id = "photo-1") {
  return GET(new Request(`https://example.test/api/photos/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function photoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "photo-1",
    url: privateUrl,
    jobId: "job-1",
    applianceId: null,
    maintenanceRequestId: null,
    maintenanceRequest: null,
    ...overrides,
  };
}

function successfulBlob() {
  const bytes = new Uint8Array([1, 2, 3]);
  blobGet.mockResolvedValue({
    statusCode: 200,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    blob: {
      contentType: "image/jpeg",
      size: bytes.length,
    },
  });
}

describe("GET /api/photos/[id]", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    photoFindUnique.mockReset();
    filingPhotoFindFirst.mockReset().mockResolvedValue(null);
    blobGet.mockReset();
  });

  it("denies signed-out callers before looking up the photo", async () => {
    getServerSession.mockResolvedValue(null);
    const response = await requestPhoto();
    expect(response.status).toBe(401);
    expect(photoFindUnique).not.toHaveBeenCalled();
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("denies archived sessions before looking up the photo", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "staff-1", role: "STAFF", archivedAt: new Date() },
    });
    const response = await requestPhoto();
    expect(response.status).toBe(401);
    expect(photoFindUnique).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN", "STAFF"] as const)(
    "allows active %s operational access and proxies bytes through the app",
    async (role) => {
      getServerSession.mockResolvedValue({ user: { id: `${role}-1`, role } });
      photoFindUnique.mockResolvedValue(photoRow());
      successfulBlob();

      const response = await requestPhoto();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("cache-control")).toContain("private");
      expect(blobGet).toHaveBeenCalledWith(
        privateUrl,
        expect.objectContaining({
          token: "private-token",
          access: "private",
          useCache: true,
        }),
      );
    },
  );

  it.each(["STAFF", "CUSTOMER"] as const)(
    "refuses %s access to a private tax filing image with a known Photo ID",
    async role => {
      getServerSession.mockResolvedValue({ user: { id: role.toLowerCase(), role } });
      photoFindUnique.mockResolvedValue(photoRow({
        url: "https://teststore.private.blob.vercel-storage.com/tax-filings/period123/confirmation.jpg",
        jobId: null,
      }));
      expect((await requestPhoto()).status).toBe(404);
      expect(blobGet).not.toHaveBeenCalled();
    },
  );

  it.each(["OWNER", "ADMIN"] as const)(
    "allows %s to read a private tax filing confirmation image",
    async role => {
      getServerSession.mockResolvedValue({ user: { id: role.toLowerCase(), role } });
      photoFindUnique.mockResolvedValue(photoRow({
        url: "https://teststore.private.blob.vercel-storage.com/tax-filings/period123/confirmation.jpg",
        jobId: null,
      }));
      successfulBlob();
      expect((await requestPhoto()).status).toBe(200);
      expect(blobGet).toHaveBeenCalledOnce();
    },
  );

  it("denies STAFF access to a historically linked tax photo even under another private prefix", async () => {
    getServerSession.mockResolvedValue({ user: { id: "staff", role: "STAFF" } });
    photoFindUnique.mockResolvedValue(photoRow());
    filingPhotoFindFirst.mockResolvedValue({ id: "period-legacy" });
    expect((await requestPhoto()).status).toBe(404);
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("allows a customer to read only evidence attached to their own maintenance request", async () => {
    getServerSession.mockResolvedValue({ user: { id: "customer-user-1", role: "CUSTOMER" } });
    photoFindUnique.mockResolvedValue(
      photoRow({
        jobId: null,
        maintenanceRequestId: "request-1",
        maintenanceRequest: { customer: { userId: "customer-user-1" } },
      }),
    );
    successfulBlob();

    expect((await requestPhoto()).status).toBe(200);
    expect(blobGet).toHaveBeenCalledTimes(1);
  });

  it("returns scoped not-found to a different customer and never contacts Blob", async () => {
    getServerSession.mockResolvedValue({ user: { id: "customer-user-2", role: "CUSTOMER" } });
    photoFindUnique.mockResolvedValue(
      photoRow({
        jobId: null,
        maintenanceRequestId: "request-1",
        maintenanceRequest: { customer: { userId: "customer-user-1" } },
      }),
    );

    const response = await requestPhoto();

    expect(response.status).toBe(404);
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("does not let a customer use photo ids to read staff-only job evidence", async () => {
    getServerSession.mockResolvedValue({ user: { id: "customer-user-1", role: "CUSTOMER" } });
    photoFindUnique.mockResolvedValue(photoRow());

    expect((await requestPhoto()).status).toBe(404);
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("rejects a stored URL that does not belong to the configured private store", async () => {
    getServerSession.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
    photoFindUnique.mockResolvedValue(
      photoRow({ url: "https://public.example.test/leaked.jpg" }),
    );

    expect((await requestPhoto()).status).toBe(502);
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("does not disclose provider failures", async () => {
    getServerSession.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
    photoFindUnique.mockResolvedValue(photoRow());
    blobGet.mockRejectedValue(new Error("secret provider detail"));

    const response = await requestPhoto();

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret provider detail");
  });
});
