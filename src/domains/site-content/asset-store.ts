import { getPrivatePhotoStore } from "@/lib/photo-storage";

// V-C2: where website picture bytes live. A small interface so tests use memory and production uses the
// existing private store (never the public catalog token, never a guessed fallback).

export interface WebsiteAssetStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Returns null when the file is missing. */
  read(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null>;
  remove(key: string): Promise<void>;
}

export const STORAGE_UNAVAILABLE_MESSAGE =
  "Picture storage is not set up in this environment yet, so pictures cannot be uploaded here.";

export class StorageUnavailableError extends Error {
  constructor() {
    super(STORAGE_UNAVAILABLE_MESSAGE);
    this.name = "StorageUnavailableError";
  }
}

const KEY = /^website-assets\/[A-Za-z0-9_-]+\.webp$/;

export function websiteAssetKey(assetId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(assetId)) throw new Error("Invalid asset id.");
  return `website-assets/${assetId}.webp`;
}

class BlobStore implements WebsiteAssetStore {
  private creds() {
    const store = getPrivatePhotoStore();
    if (!store) throw new StorageUnavailableError();
    return store;
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    if (!KEY.test(key)) throw new Error("Invalid storage key.");
    const { token } = this.creds();
    const { put } = await import("@vercel/blob");
    await put(key, bytes, { access: "private", token, contentType, addRandomSuffix: false, allowOverwrite: true });
  }
  async read(key: string) {
    if (!KEY.test(key)) return null;
    const { token } = this.creds();
    const { get } = await import("@vercel/blob");
    const result = await get(key, { token, access: "private", useCache: true, abortSignal: AbortSignal.timeout(15_000) });
    if (!result || result.statusCode !== 200) return null;
    return { stream: result.stream, size: result.blob.size, contentType: result.blob.contentType || "image/webp" };
  }
  async remove(key: string) {
    if (!KEY.test(key)) return;
    const { token } = this.creds();
    const { del } = await import("@vercel/blob");
    await del(key, { token });
  }
}

/** In-memory store for tests and for environments that deliberately have no storage. */
export class MemoryAssetStore implements WebsiteAssetStore {
  readonly files = new Map<string, { bytes: Buffer; contentType: string }>();
  async put(key: string, bytes: Buffer, contentType: string) { this.files.set(key, { bytes, contentType }); }
  async read(key: string) {
    const file = this.files.get(key);
    if (!file) return null;
    const copy = new Uint8Array(file.bytes);
    return {
      stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(copy); c.close(); } }),
      size: file.bytes.byteLength,
      contentType: file.contentType,
    };
  }
  async remove(key: string) { this.files.delete(key); }
}

let override: WebsiteAssetStore | null = null;
/** Tests only. */
export function setWebsiteAssetStoreForTests(store: WebsiteAssetStore | null): void { override = store; }

export function getWebsiteAssetStore(): WebsiteAssetStore {
  if (override) return override;
  if (!getPrivatePhotoStore()) throw new StorageUnavailableError();
  return new BlobStore();
}

export function websiteStorageConfigured(): boolean {
  return override !== null || getPrivatePhotoStore() !== null;
}
