import { describe, it, expect, vi, beforeEach } from "vitest";

// The upload route (src/app/api/uploads/photo/route.ts) has exactly one
// piece of custom logic worth testing: it must refuse to hand out a Blob
// upload token to anyone who isn't signed in as OWNER/ADMIN staff — that's
// what keeps the (publicly-readable) Blob store from being an open upload
// target for a stranger who finds the URL. The actual token-minting is
// @vercel/blob's own handleUpload, mocked out here.

const getServerSession = vi.fn();
const handleUpload = vi.fn();

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

describe("POST /api/uploads/photo", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    handleUpload.mockReset();
  });

  it("refuses to mint a token when nobody is signed in", async () => {
    getServerSession.mockResolvedValue(null);

    const response = await POST(fakeRequest({ type: "blob.generate-client-token" }));

    expect(response.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("refuses a signed-in CUSTOMER (only staff can upload)", async () => {
    getServerSession.mockResolvedValue({ user: { role: "CUSTOMER" } });

    const response = await POST(fakeRequest({ type: "blob.generate-client-token" }));

    expect(response.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("mints a token for a signed-in OWNER", async () => {
    getServerSession.mockResolvedValue({ user: { role: "OWNER" } });
    handleUpload.mockResolvedValue({ type: "blob.generate-client-token", clientToken: "tok" });

    const response = await POST(fakeRequest({ type: "blob.generate-client-token" }));

    expect(response.status).toBe(200);
    expect(handleUpload).toHaveBeenCalledTimes(1);
  });

  it("mints a token for a signed-in ADMIN", async () => {
    getServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    handleUpload.mockResolvedValue({ type: "blob.generate-client-token", clientToken: "tok" });

    const response = await POST(fakeRequest({ type: "blob.generate-client-token" }));

    expect(response.status).toBe(200);
    expect(handleUpload).toHaveBeenCalledTimes(1);
  });

  it("caps the allowed content types and size when generating a token", async () => {
    getServerSession.mockResolvedValue({ user: { role: "OWNER" } });
    handleUpload.mockResolvedValue({ type: "blob.generate-client-token", clientToken: "tok" });

    await POST(fakeRequest({ type: "blob.generate-client-token" }));

    const options = handleUpload.mock.calls[0][0];
    const tokenOptions = await options.onBeforeGenerateToken();
    expect(tokenOptions.allowedContentTypes).toEqual(
      expect.arrayContaining(["image/jpeg", "image/png"]),
    );
    expect(tokenOptions.maximumSizeInBytes).toBeGreaterThan(0);
  });
});
