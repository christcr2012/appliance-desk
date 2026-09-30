import { describe, it, expect, vi, beforeEach } from "vitest";

// The upload route (src/app/api/uploads/photo/route.ts) has exactly one
// piece of custom logic worth testing: it must refuse to hand out a Blob
// upload token to anyone who isn't signed in at all — that's what keeps
// the (publicly-readable) Blob store from being an open upload target for
// a stranger who finds the URL. Any signed-in role (staff or customer) is
// allowed, since both Settings/job photos (staff) and a customer's own
// maintenance-request photo use this same route. The actual token-minting
// is @vercel/blob's own handleUpload, mocked out here.

const getServerSession = vi.fn();
const handleUpload = vi.fn();
const customer = vi.fn();
const job = vi.fn();
const appliance = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findFirst: (...args: unknown[]) => customer(...args) },
    job: { findUnique: (...args: unknown[]) => job(...args) },
    appliance: { findFirst: (...args: unknown[]) => appliance(...args) },
  },
}));

vi.mock("@/lib/session", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: (...args: unknown[]) => handleUpload(...args),
}));

import { POST } from "@/app/api/uploads/photo/route";

function fakeRequest(body: unknown) {
  return new Request("https://example.com/api/uploads/photo", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function uploadRequest(pathname: string) {
  return fakeRequest({
    type: "blob.generate-client-token",
    payload: { pathname, multipart: false, clientPayload: null },
  });
}

describe("POST /api/uploads/photo", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    handleUpload.mockReset();
    customer.mockReset().mockResolvedValue({ id: "customer-1" });
    job.mockReset().mockResolvedValue({ id: "job-1" });
    appliance.mockReset().mockResolvedValue({ id: "appliance-1" });
  });

  it("refuses to mint a token when nobody is signed in", async () => {
    getServerSession.mockResolvedValue(null);

    const response = await POST(
      fakeRequest({ type: "blob.generate-client-token" }),
    );

    expect(response.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("mints a token for a signed-in CUSTOMER (they need this for maintenance-request photos)", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "CUSTOMER" },
    });
    handleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "tok",
    });

    const response = await POST(
      uploadRequest("maintenance-requests/customer-1/photo.jpg"),
    );

    expect(response.status).toBe(200);
    expect(handleUpload).toHaveBeenCalledTimes(1);
    expect(customer).toHaveBeenCalledWith({
      where: { id: "customer-1", userId: "user-1", archivedAt: null },
      select: { id: true },
    });
  });

  it("mints a token for a signed-in OWNER", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    handleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "tok",
    });

    const response = await POST(uploadRequest("appliance-types/photo.jpg"));

    expect(response.status).toBe(200);
    expect(handleUpload).toHaveBeenCalledTimes(1);
  });

  it("mints a token for a signed-in ADMIN", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    });
    handleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "tok",
    });

    const response = await POST(uploadRequest("appliance-types/photo.jpg"));

    expect(response.status).toBe(200);
    expect(handleUpload).toHaveBeenCalledTimes(1);
  });

  it("caps the allowed content types and size when generating a token", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    handleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "tok",
    });

    await POST(uploadRequest("appliance-types/photo.jpg"));

    const options = handleUpload.mock.calls[0][0];
    const tokenOptions = await options.onBeforeGenerateToken(
      "appliance-types/photo.jpg",
    );
    expect(tokenOptions.allowedContentTypes).toEqual(
      expect.arrayContaining(["image/jpeg", "image/png"]),
    );
    expect(tokenOptions.maximumSizeInBytes).toBeGreaterThan(0);
    expect(tokenOptions.addRandomSuffix).toBe(true);
    expect(tokenOptions.allowOverwrite).toBe(false);
    await expect(
      options.onBeforeGenerateToken("backups/photo.jpg"),
    ).rejects.toThrow("Upload path changed");
  });

  it("rejects a removed account without invoking storage or database providers", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "u-1", role: "OWNER", archivedAt: new Date() },
    });
    expect(
      (await POST(uploadRequest("appliance-types/photo.jpg"))).status,
    ).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
    expect(customer).not.toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
  });

  it.each([
    "appliance-types/photo.jpg",
    "jobs/job-1/photo.jpg",
    "appliances/a-1/photo.jpg",
    "backups/photo.jpg",
  ])("customer cannot upload to %s", async (pathname) => {
    getServerSession.mockResolvedValue({
      user: { id: "u-1", role: "CUSTOMER" },
    });
    expect((await POST(uploadRequest(pathname))).status).toBe(403);
    expect(handleUpload).not.toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
    expect(appliance).not.toHaveBeenCalled();
  });

  it("denies another customer's maintenance path", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "u-1", role: "CUSTOMER" },
    });
    customer.mockResolvedValue(null);
    expect(
      (await POST(uploadRequest("maintenance-requests/customer-2/photo.jpg")))
        .status,
    ).toBe(403);
    expect(customer).toHaveBeenCalledWith({
      where: { id: "customer-2", userId: "u-1", archivedAt: null },
      select: { id: true },
    });
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it.each([
    "backups/photo.jpg",
    "/appliance-types/photo.jpg",
    "appliance-types/../photo.jpg",
    "appliance-types/..",
    "appliance-types/.",
    "appliance-types/",
    "appliance-types/%2e%2e.jpg",
    "jobs/job-1/../photo.jpg",
    "jobs/../photo.jpg",
    "appliance-types/back\\slash.jpg",
    "appliance-types/control\u0000.jpg",
  ])(
    "rejects arbitrary or malformed path %s before provider calls",
    async (pathname) => {
      getServerSession.mockResolvedValue({
        user: { id: "owner-1", role: "OWNER" },
      });
      expect((await POST(uploadRequest(pathname))).status).toBe(403);
      expect(handleUpload).not.toHaveBeenCalled();
      expect(job).not.toHaveBeenCalled();
      expect(appliance).not.toHaveBeenCalled();
      expect(customer).not.toHaveBeenCalled();
    },
  );

  it("retains ordinary spaces and Unicode in phone photo names", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    handleUpload.mockResolvedValue({ clientToken: "token" });
    expect(
      (await POST(uploadRequest("appliance-types/Washer façade 1.jpg"))).status,
    ).toBe(200);
  });

  it("retains staff job photos but denies inventory and website uploads", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "staff-1", role: "STAFF" },
    });
    handleUpload.mockResolvedValue({ clientToken: "token" });
    expect((await POST(uploadRequest("jobs/job-1/photo.jpg"))).status).toBe(
      200,
    );
    expect(job).toHaveBeenCalledWith({
      where: { id: "job-1" },
      select: { id: true },
    });
    handleUpload.mockClear();
    for (const pathname of [
      "appliance-types/photo.jpg",
      "appliances/a-1/photo.jpg",
    ]) {
      expect((await POST(uploadRequest(pathname))).status).toBe(403);
    }
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("rejects a missing job and an archived appliance", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    job.mockResolvedValue(null);
    appliance.mockResolvedValue(null);
    expect((await POST(uploadRequest("jobs/missing/photo.jpg"))).status).toBe(
      403,
    );
    expect(
      (await POST(uploadRequest("appliances/archived/photo.jpg"))).status,
    ).toBe(403);
    expect(appliance).toHaveBeenCalledWith({
      where: { id: "archived", archivedAt: null },
      select: { id: true },
    });
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { type: "blob.upload-completed", payload: {} },
    { type: "blob.generate-client-token" },
  ])("handles malformed or unsupported body %#", async (body) => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    expect((await POST(fakeRequest(body))).status).toBe(400);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("handles invalid JSON with a controlled response", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    const response = await POST(
      new Request("https://example.test/api/uploads/photo", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid photo upload request.",
    });
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("does not disclose provider errors or credentials", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "owner-1", role: "OWNER" },
    });
    handleUpload.mockRejectedValue(
      new Error("provider detail: private-credential"),
    );
    const response = await POST(uploadRequest("appliance-types/photo.jpg"));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-credential");
  });
});
