import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

// canUploadPhoto refuses feedback/ before it would ever query the database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { cleanScreenshot, feedbackAttachmentPath, MAX_SCREENSHOT_BYTES, screenshotTypeFromBytes } from "@/domains/feedback/media";
import { isPrivatePhotoPath, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import { canUploadPhoto } from "@/domains/uploads";
import { fitInside, SHRINK_STEPS, TARGET_BYTES } from "@/components/feedback/shrink-image";

// MCP-10a: screenshots are only real PNG/JPEG/WebP pictures, size- and pixel-limited, re-made without location data,
// stored in the private store under feedback/, and never uploadable with a browser storage token.

async function png(width = 40, height = 30) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
}

describe("screenshots are checked by their first bytes", () => {
  it("recognises PNG, JPEG and WebP whatever the file is called", async () => {
    expect(screenshotTypeFromBytes(await png())).toBe("png");
    expect(screenshotTypeFromBytes(await sharp(await png()).jpeg().toBuffer())).toBe("jpeg");
    expect(screenshotTypeFromBytes(await sharp(await png()).webp().toBuffer())).toBe("webp");
  });
  it("accepts a PNG even when the browser said it was a JPEG (a PNG named .jpg is fine)", async () => {
    const result = await cleanScreenshot(await png());
    expect(screenshotTypeFromBytes(result.bytes)).toBe("webp");
    expect(result.width).toBe(40);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("refuses an SVG or an HTML page renamed to .png", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");
    await expect(cleanScreenshot(svg)).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(cleanScreenshot(html)).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(cleanScreenshot(new Uint8Array())).rejects.toThrow(/PNG, JPEG or WebP/);
  });
  it("refuses a picture whose header is real but whose body is broken", async () => {
    const broken = Buffer.concat([(await png()).subarray(0, 40), Buffer.alloc(200, 7)]);
    await expect(cleanScreenshot(broken)).rejects.toThrow(/PNG, JPEG or WebP/);
  });
  it("refuses a file over the 900 KB transport cap", async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(MAX_SCREENSHOT_BYTES)]);
    await expect(cleanScreenshot(big)).rejects.toThrow(/too large/);
  });
  it("refuses a decompression bomb (a small file that unpacks to a huge picture)", async () => {
    const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_SCREENSHOT_BYTES);
    await expect(cleanScreenshot(bomb)).rejects.toThrow(/too large/);
  });
  it("removes location (EXIF/GPS) data", async () => {
    const withGps = await sharp(await png(64, 48)).jpeg().withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 1" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 25/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "104/1 42/1 0/1" },
    }).toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeTruthy();
    const cleaned = await cleanScreenshot(withGps);
    const meta = await sharp(cleaned.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(cleaned.bytes.includes(Buffer.from("PhoneMaker"))).toBe(false);
  });
  it("never grows a picture and caps the long side at 2400", async () => {
    const wide = await sharp({ create: { width: 3000, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    const result = await cleanScreenshot(wide);
    expect(result.width).toBe(2400);
    expect((await cleanScreenshot(await png(10, 10))).width).toBe(10);
  });
});

describe("storage paths", () => {
  it("feedback/ is a private path (so the nightly media copy includes screenshots)", () => {
    const path = feedbackAttachmentPath("report123", "fa0011");
    expect(path).toBe("feedback/report123/fa0011.webp");
    expect(isPrivatePhotoPath(path)).toBe(true);
    expect(isPrivatePhotoPath("feedback/x.webp")).toBe(false);
    expect(isPrivatePhotoPath("feedback/a/b/c.webp")).toBe(false);
    expect(privatePhotoPathFromUrl("https://abc123.private.blob.vercel-storage.com/feedback/r1/a1.webp", "store_abc123")).toBe("feedback/r1/a1.webp");
    expect(() => feedbackAttachmentPath("../x", "a")).toThrow();
  });
  it("the browser upload token route refuses feedback/ for every role (pictures go through the server)", async () => {
    for (const role of ["OWNER", "ADMIN", "STAFF", "CUSTOMER"]) {
      expect(await canUploadPhoto({ id: "user-1", role }, "feedback/report123/a.webp"), role).toBe(false);
    }
  });
});

describe("the browser shrink steps", () => {
  it("fits inside the long side and never enlarges", () => {
    expect(fitInside(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitInside(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(SHRINK_STEPS.map((step) => step.side)).toEqual([1600, 1600, 1280]);
    expect(TARGET_BYTES).toBeLessThanOrEqual(MAX_SCREENSHOT_BYTES);
  });
});
