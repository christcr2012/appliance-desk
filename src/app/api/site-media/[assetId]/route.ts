import { findServableAsset } from "@/domains/site-content/assets";
import { streamAsset } from "@/domains/site-content/asset-response";

/** Public website pictures: only PUBLIC ones, no sign-in, no storage token ever exposed. Draft/retired look like 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(assetId)) return new Response("Not found", { status: 404 });
  const asset = await findServableAsset(assetId, "public");
  if (!asset) return new Response("Not found", { status: 404 });
  // A picture's bytes never change once public (a new upload gets a new id), so it can be cached hard.
  return streamAsset(asset.storageKey, "public, max-age=31536000, immutable");
}
