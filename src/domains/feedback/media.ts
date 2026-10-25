import { createHash } from "node:crypto";
import sharp from "sharp";
import { FeedbackError, SCREENSHOT_TOO_LARGE, SCREENSHOT_TYPES } from "./rules";

// MCP-10a: every screenshot is re-made on the server before it is stored. The sender's bytes are only ever read as a
// picture, never stored or served as they arrived, so location data (EXIF/GPS) and anything else hidden in the file is
// dropped, and an SVG/HTML file renamed to .png never gets through.

/** Technical transport cap: one picture per request stays under the app-wide 1 MB server-action limit. */
export const MAX_SCREENSHOT_BYTES = 900 * 1024;
/** Decompression-bomb guard: a tiny file that would unpack to a huge picture is refused before decoding. */
export const MAX_SCREENSHOT_PIXELS = 40_000_000;
export const MAX_STORED_SIDE = 2400;

export type ScreenshotType = "png" | "jpeg" | "webp";

/** What the first bytes say the file is. The file name and the browser's claimed type are never trusted. */
export function screenshotTypeFromBytes(bytes: Uint8Array): ScreenshotType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

export type CleanScreenshot = { bytes: Buffer; width: number; height: number; sizeBytes: number; sha256: string };

/** Checks and re-encodes one screenshot to WebP with no metadata. Throws a FeedbackError with plain words. */
export async function cleanScreenshot(input: Uint8Array): Promise<CleanScreenshot> {
  if (input.byteLength === 0) throw new FeedbackError(SCREENSHOT_TYPES);
  if (input.byteLength > MAX_SCREENSHOT_BYTES) throw new FeedbackError(SCREENSHOT_TOO_LARGE);
  if (!screenshotTypeFromBytes(input)) throw new FeedbackError(SCREENSHOT_TYPES);
  try {
    const source = sharp(input, { limitInputPixels: MAX_SCREENSHOT_PIXELS, failOn: "error", animated: false });
    const meta = await source.metadata();
    if (!meta.width || !meta.height || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new FeedbackError(SCREENSHOT_TYPES);
    if (meta.width * meta.height > MAX_SCREENSHOT_PIXELS) throw new FeedbackError(SCREENSHOT_TOO_LARGE);
    if ((meta.pages ?? 1) > 1) throw new FeedbackError(SCREENSHOT_TYPES);
    const { data, info } = await source
      .rotate()
      .resize({ width: MAX_STORED_SIDE, height: MAX_STORED_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      width: info.width,
      height: info.height,
      sizeBytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof FeedbackError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) throw new FeedbackError(SCREENSHOT_TOO_LARGE);
    throw new FeedbackError(SCREENSHOT_TYPES);
  }
}

export function feedbackAttachmentPath(reportId: string, attachmentId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(reportId) || !/^[A-Za-z0-9_-]+$/.test(attachmentId)) throw new Error("Invalid attachment path.");
  return `feedback/${reportId}/${attachmentId}.webp`;
}

/** The private-store address of a pathname (the media-deletion helper works from addresses). */
export function privateBlobUrl(storeId: string, pathname: string): string {
  return `https://${storeId.slice("store_".length).toLowerCase()}.private.blob.vercel-storage.com/${pathname}`;
}
