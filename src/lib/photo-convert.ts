/**
 * iPhone pictures are often saved as HEIC/HEIF, which most computers' browsers cannot show. Before a picture is
 * uploaded, a HEIC/HEIF file is turned into an ordinary JPEG when this browser can read it (Safari and iPhones can).
 * When it cannot, the person gets a plain message instead of an upload that nobody could open later. Everything that
 * is stored is therefore a picture any browser can show.
 */
export const HEIC_MIME_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"] as const;

export type PhotoToUpload = { name: string; type: string; size?: number };

export function isHeicPhoto(file: PhotoToUpload): boolean {
  const type = file.type.toLowerCase();
  if ((HEIC_MIME_TYPES as readonly string[]).includes(type)) return true;
  // Some browsers leave the type empty for HEIC files; the name then decides.
  return type === "" && /\.(heic|heif)$/i.test(file.name);
}

export const HEIC_NOT_READABLE_MESSAGE =
  "This phone picture is in a format (HEIC) that this browser can't convert. Choose the picture again as a JPEG: on an iPhone, open Settings > Camera > Formats and pick Most Compatible, or share the picture from Photos and choose a regular copy.";

export type PreparedPhoto<F> = { ok: true; file: F } | { ok: false; message: string };

/** Turns the bytes of a picture the browser can decode into a JPEG. Replaceable so it can be tested. */
export type JpegEncoder = (file: Blob) => Promise<Blob>;

export const encodeJpegInBrowser: JpegEncoder = async (file) => {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode"))), "image/jpeg", 0.9);
    });
  } finally {
    bitmap.close();
  }
};

export function jpegNameFor(name: string): string {
  const base = name.replace(/\.(heic|heif)$/i, "");
  return `${base || "photo"}.jpg`;
}

/**
 * Returns the file to upload: the same file when it is not HEIC/HEIF, a JPEG copy when it was and could be
 * converted, or a plain-words message when it could not.
 */
export async function preparePhotoForUpload(
  file: File,
  encode: JpegEncoder = encodeJpegInBrowser,
  makeFile: (blob: Blob, name: string) => File = (blob, name) => new File([blob], name, { type: "image/jpeg" }),
): Promise<PreparedPhoto<File>> {
  if (!isHeicPhoto(file)) return { ok: true, file };
  try {
    const jpeg = await encode(file);
    if (jpeg.size === 0) return { ok: false, message: HEIC_NOT_READABLE_MESSAGE };
    return { ok: true, file: makeFile(jpeg, jpegNameFor(file.name)) };
  } catch {
    return { ok: false, message: HEIC_NOT_READABLE_MESSAGE };
  }
}
