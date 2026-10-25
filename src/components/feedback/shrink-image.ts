import { preparePhotoForUpload } from "@/lib/photo-convert";

// MCP-10a: screenshots are shrunk in the browser before they are sent, one picture per request, so no request goes
// over the app-wide 1 MB limit. Redrawing on a canvas also drops the photo's location data before it leaves the phone.
// The server checks and re-makes every picture again (src/domains/feedback/media.ts); this is only the first step.

export const MAX_CHOSEN_BYTES = 25 * 1024 * 1024;
export const TARGET_BYTES = 900 * 1024;
export const TOO_LARGE = "This picture is too large to send — try a smaller screenshot.";
export const NOT_A_PICTURE = "Screenshots must be PNG, JPEG or WebP pictures.";

/** The sizes and qualities tried in order until the picture fits. */
export const SHRINK_STEPS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 1600, quality: 0.82 },
  { side: 1600, quality: 0.6 },
  { side: 1280, quality: 0.6 },
];

export function fitInside(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

type Encoder = (bitmap: ImageBitmap, size: { width: number; height: number }, quality: number) => Promise<Blob>;

const encodeWebp: Encoder = (bitmap, size, quality) => {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("No canvas"));
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const encodeAs = (type: string) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode"))), type, quality);
  });
  // Some browsers (older Safari) cannot write WebP and hand back a large PNG instead; JPEG is the smaller fallback.
  return encodeAs("image/webp").then((blob) => (blob.type === "image/webp" ? blob : encodeAs("image/jpeg")));
};

export type ShrinkResult = { ok: true; file: File } | { ok: false; message: string };

/** Turns a chosen picture into a WebP of at most 900 KB, or a plain message when it can't. */
export async function shrinkScreenshot(file: File, encode: Encoder = encodeWebp): Promise<ShrinkResult> {
  if (file.size > MAX_CHOSEN_BYTES) return { ok: false, message: TOO_LARGE };
  const prepared = await preparePhotoForUpload(file);
  if (!prepared.ok) return prepared;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(prepared.file);
  } catch {
    return { ok: false, message: NOT_A_PICTURE };
  }
  try {
    for (const step of SHRINK_STEPS) {
      const blob = await encode(bitmap, fitInside(bitmap.width, bitmap.height, step.side), step.quality);
      if (blob.size > 0 && blob.size <= TARGET_BYTES) {
        const base = file.name.replace(/\.[^.]*$/, "") || "screenshot";
        const type = blob.type || "image/webp";
        return { ok: true, file: new File([blob], `${base}.${type === "image/jpeg" ? "jpg" : "webp"}`, { type }) };
      }
    }
    return { ok: false, message: TOO_LARGE };
  } catch {
    return { ok: false, message: NOT_A_PICTURE };
  } finally {
    bitmap.close();
  }
}
