import { describe, expect, it } from "vitest";
import { HEIC_NOT_READABLE_MESSAGE, isHeicPhoto, jpegNameFor, preparePhotoForUpload } from "@/lib/photo-convert";

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe("phone pictures in HEIC format", () => {
  it("recognises HEIC and HEIF by type, and by name when the browser leaves the type empty", () => {
    expect(isHeicPhoto(file("a.heic", "image/heic"))).toBe(true);
    expect(isHeicPhoto(file("a.HEIF", "image/heif"))).toBe(true);
    expect(isHeicPhoto(file("IMG_1.HEIC", ""))).toBe(true);
    expect(isHeicPhoto(file("a.jpg", "image/jpeg"))).toBe(false);
    expect(isHeicPhoto(file("a.png", "image/png"))).toBe(false);
    expect(isHeicPhoto(file("a.pdf", "application/pdf"))).toBe(false);
  });

  it("passes an ordinary picture through untouched without converting", async () => {
    const original = file("front.jpg", "image/jpeg");
    let called = false;
    const result = await preparePhotoForUpload(original, async () => { called = true; return new Blob(["x"]); });
    expect(result).toEqual({ ok: true, file: original });
    expect(called).toBe(false);
  });

  it("converts a HEIC picture to a JPEG copy with a .jpg name", async () => {
    const result = await preparePhotoForUpload(file("IMG_0042.HEIC", "image/heic"), async () => new Blob(["jpegbytes"], { type: "image/jpeg" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.name).toBe("IMG_0042.jpg");
      expect(result.file.type).toBe("image/jpeg");
      expect(result.file.size).toBe(9);
    }
  });

  it("explains in plain words, and uploads nothing, when this browser cannot read the picture", async () => {
    const failing = await preparePhotoForUpload(file("a.heic", "image/heic"), async () => { throw new Error("decode failed"); });
    expect(failing).toEqual({ ok: false, message: HEIC_NOT_READABLE_MESSAGE });
    const empty = await preparePhotoForUpload(file("a.heic", "image/heic"), async () => new Blob([]));
    expect(empty).toEqual({ ok: false, message: HEIC_NOT_READABLE_MESSAGE });
    expect(HEIC_NOT_READABLE_MESSAGE).toMatch(/Most Compatible/);
  });

  it("names the converted file sensibly", () => {
    expect(jpegNameFor("IMG_1.heic")).toBe("IMG_1.jpg");
    expect(jpegNameFor("my.photo.HEIF")).toBe("my.photo.jpg");
    expect(jpegNameFor(".heic")).toBe("photo.jpg");
  });
});
