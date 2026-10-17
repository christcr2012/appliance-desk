import { createHash } from "node:crypto";
import sharp from "sharp";
import { SiteContentError } from "./types";

// V-C2: every uploaded website picture is re-made on the server. The owner's file is only ever read as a
// picture (never served as-is), so metadata (location, camera) is dropped and nothing active can ride along.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_PIXELS = 24_000_000;
export const MAX_OUTPUT_SIDE = 2400;
export const OUTPUT_MIME = "image/webp";

export type ProcessedImage = {
  bytes: Buffer;
  mimeType: typeof OUTPUT_MIME;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

/** What the file's first bytes say it is. The file name and the browser's claim are never trusted. */
export function sniffImageType(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export async function processUploadedImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new SiteContentError("That file is empty.");
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new SiteContentError("That picture is larger than 10 MB. Please choose a smaller one.");
  if (!sniffImageType(input)) throw new SiteContentError("Please upload a JPEG, PNG or WebP picture.");
  try {
    const source = sharp(input, { limitInputPixels: MAX_UPLOAD_PIXELS, failOn: "error", animated: false });
    const meta = await source.metadata();
    if (!meta.width || !meta.height) throw new SiteContentError("That picture could not be read.");
    if (meta.width * meta.height > MAX_UPLOAD_PIXELS) throw new SiteContentError("That picture is too large (over 24 megapixels). Please choose a smaller one.");
    if ((meta.pages ?? 1) > 1) throw new SiteContentError("Animated pictures are not supported. Please upload a still picture.");
    const { data, info } = await source
      .rotate() // apply the camera's orientation, then the orientation tag is dropped with the rest of the metadata
      .resize({ width: MAX_OUTPUT_SIDE, height: MAX_OUTPUT_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      mimeType: OUTPUT_MIME,
      width: info.width,
      height: info.height,
      byteSize: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof SiteContentError) throw error;
    throw new SiteContentError("That picture could not be read. Please try a different file.");
  }
}
