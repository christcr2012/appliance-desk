import { getWebsiteAssetStore, StorageUnavailableError } from "./asset-store";

/** Streams one stored picture. Content type is always the stored (server-made) WebP, never a caller's claim. */
export async function streamAsset(storageKey: string, cacheControl: string): Promise<Response> {
  try {
    const file = await getWebsiteAssetStore().read(storageKey);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(file.stream, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(file.size),
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof StorageUnavailableError) return new Response("Picture storage is not set up.", { status: 503 });
    return new Response("Picture could not be loaded.", { status: 502 });
  }
}
