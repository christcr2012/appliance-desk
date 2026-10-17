import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  asset: null as null | { id: string; state: string; storageKey: string },
  upload: vi.fn(),
  activeUser: { id: "u1" } as { id: string } | null,
}));

vi.mock("@/lib/session", () => ({ getServerSession: async () => mocks.session }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    websiteAsset: { findUnique: async () => mocks.asset },
    user: { findFirst: async () => mocks.activeUser },
  },
}));
vi.mock("@/domains/site-content/assets", async (orig) => {
  const real = await orig<typeof import("@/domains/site-content/assets")>();
  return { ...real, uploadWebsiteAsset: mocks.upload };
});

import { MAX_OUTPUT_SIDE, processUploadedImage, sniffImageType } from "@/domains/site-content/image-processing";
import { MemoryAssetStore, setWebsiteAssetStoreForTests, websiteAssetKey } from "@/domains/site-content/asset-store";
import { SiteContentError } from "@/domains/site-content/types";
import { assetIdFromPublicPath, draftAssetPath, publicAssetPath } from "@/domains/site-content/asset-paths";
import { GET as publicGet } from "@/app/api/site-media/[assetId]/route";
import { GET as previewGet } from "@/app/api/desk/site-media/[assetId]/route";
import { POST as uploadPost } from "@/app/api/desk/website-assets/route";

const solid = (w: number, h: number, format: "jpeg" | "png" | "webp") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } })[format]().toBuffer();

beforeEach(() => {
  mocks.session = null; mocks.asset = null; mocks.upload.mockReset(); mocks.activeUser = { id: "u1" };
  setWebsiteAssetStoreForTests(null);
});

describe("V-C2 image processing", () => {
  it("accepts real JPEG, PNG and WebP and returns a WebP", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const out = await processUploadedImage(await solid(300, 200, format));
      expect(sniffImageType(out.bytes)).toBe("webp");
      expect(out.mimeType).toBe("image/webp");
      expect(out.width).toBe(300);
      expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("is deterministic: the same picture gives the same bytes and hash", async () => {
    const input = await solid(400, 300, "jpeg");
    const a = await processUploadedImage(input);
    const b = await processUploadedImage(input);
    expect(a.sha256).toBe(b.sha256);
  });
  it("shrinks very large pictures and never enlarges small ones", async () => {
    const big = await processUploadedImage(await solid(4000, 1000, "png"));
    expect(Math.max(big.width, big.height)).toBe(MAX_OUTPUT_SIDE);
    const small = await processUploadedImage(await solid(100, 80, "png"));
    expect(small.width).toBe(100);
  });
  it("strips metadata such as location and camera, and applies orientation", async () => {
    const withExifCheck = await sharp(await solid(300, 100, "jpeg")).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-owner" } } }).jpeg().toBuffer();
    expect((await sharp(withExifCheck).metadata()).orientation).toBe(6);
    const out = await processUploadedImage(withExifCheck);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(out.bytes.toString("latin1")).not.toContain("secret-owner");
    expect(out.width).toBe(100); // rotated 90 degrees
    expect(out.height).toBe(300);
  });
  it("refuses SVG, HTML, empty, wrong bytes with a .jpg name, oversize and huge-pixel files", async () => {
    const reject = async (bytes: Uint8Array, text: RegExp) => {
      await expect(processUploadedImage(bytes)).rejects.toThrow(SiteContentError);
      await expect(processUploadedImage(bytes)).rejects.toThrow(text);
    };
    await reject(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /JPEG, PNG or WebP/);
    await reject(Buffer.from("<html><script>alert(1)</script></html>"), /JPEG, PNG or WebP/);
    await reject(new Uint8Array(0), /empty/);
    await reject(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(11 * 1024 * 1024)]), /10 MB/);
    await reject(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), /could not be read/);
    await reject(await sharp({ create: { width: 5000, height: 5001, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer(), /24 megapixels|could not be read/);
  });
});

describe("V-C2 storage and paths", () => {
  it("makes server-side keys only", () => {
    expect(websiteAssetKey("abc_123")).toBe("website-assets/abc_123.webp");
    expect(() => websiteAssetKey("../evil")).toThrow();
  });
  it("round-trips public paths", () => {
    expect(assetIdFromPublicPath(publicAssetPath("abc123"))).toBe("abc123");
    expect(assetIdFromPublicPath("/api/site-media/../x")).toBeNull();
    expect(draftAssetPath("abc")).toBe("/api/desk/site-media/abc");
  });
  it("memory store reads back what was written", async () => {
    const store = new MemoryAssetStore();
    await store.put("website-assets/a.webp", Buffer.from("xyz"), "image/webp");
    const file = await store.read("website-assets/a.webp");
    expect(file?.size).toBe(3);
    expect(await store.read("website-assets/missing.webp")).toBeNull();
  });
});

describe("V-C2 serving routes", () => {
  const call = (fn: typeof publicGet, id: string) => fn(new Request("http://x/"), { params: Promise.resolve({ assetId: id }) });
  async function withFile() {
    const store = new MemoryAssetStore();
    await store.put("website-assets/a1.webp", Buffer.from("webpbytes"), "image/webp");
    setWebsiteAssetStoreForTests(store);
  }
  it("public route serves only PUBLIC pictures, with safe headers and no token", async () => {
    await withFile();
    mocks.asset = { id: "a1", state: "PUBLIC", storageKey: "website-assets/a1.webp" };
    const ok = await call(publicGet, "a1");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toContain("immutable");
    for (const state of ["DRAFT", "RETIRED"]) {
      mocks.asset = { id: "a1", state, storageKey: "website-assets/a1.webp" };
      expect((await call(publicGet, "a1")).status).toBe(404);
    }
    mocks.asset = null;
    expect((await call(publicGet, "a1")).status).toBe(404);
    expect((await call(publicGet, "../etc")).status).toBe(404);
  });
  it("preview route needs an active owner/admin and is never cached", async () => {
    await withFile();
    mocks.asset = { id: "a1", state: "DRAFT", storageKey: "website-assets/a1.webp" };
    for (const session of [null, { user: { id: "u1", role: "STAFF" } }, { user: { id: "u1", role: "CUSTOMER" } }]) {
      mocks.session = session;
      expect((await call(previewGet, "a1")).status).toBe(404);
    }
    mocks.session = { user: { id: "u1", role: "OWNER" } };
    mocks.activeUser = null;
    expect((await call(previewGet, "a1")).status).toBe(404);
    mocks.activeUser = { id: "u1" };
    const ok = await call(previewGet, "a1");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    mocks.asset = { id: "a1", state: "RETIRED", storageKey: "website-assets/a1.webp" };
    expect((await call(previewGet, "a1")).status).toBe(404);
  });
  it("storage not configured gives a plain 503, not a crash", async () => {
    mocks.asset = { id: "a1", state: "PUBLIC", storageKey: "website-assets/a1.webp" };
    expect((await call(publicGet, "a1")).status).toBe(503);
  });
});

describe("V-C2 upload route", () => {
  const form = (file: File) => { const f = new FormData(); f.set("file", file); return new Request("http://x/", { method: "POST", body: f }); };
  it("refuses everyone but owner/admin", async () => {
    for (const session of [null, { user: { id: "u", role: "STAFF" } }, { user: { id: "u", role: "CUSTOMER" } }]) {
      mocks.session = session;
      expect((await uploadPost(form(new File(["x"], "a.jpg")))).status).toBe(403);
    }
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("owner uploads: gets an id and a preview path; problems are plain messages", async () => {
    mocks.session = { user: { id: "u", role: "OWNER" } };
    mocks.upload.mockResolvedValueOnce({ id: "id1", width: 3, height: 2, byteSize: 9, reused: false });
    const ok = await uploadPost(form(new File(["x"], "a.jpg")));
    expect(ok.status).toBe(201);
    expect((await ok.json()).asset.previewPath).toBe("/api/desk/site-media/id1");
    mocks.upload.mockRejectedValueOnce(new SiteContentError("Please upload a JPEG, PNG or WebP picture."));
    const bad = await uploadPost(form(new File(["x"], "a.svg")));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("JPEG, PNG or WebP");
    const huge = new Request("http://x/", { method: "POST", headers: { "content-length": String(50 * 1024 * 1024) }, body: "x" });
    expect((await uploadPost(huge)).status).toBe(413);
    const none = await uploadPost(new Request("http://x/", { method: "POST", body: new FormData() }));
    expect(none.status).toBe(400);
  });
});

