import { findServableAsset } from "@/domains/site-content/assets";
import { streamAsset } from "@/domains/site-content/asset-response";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

/** Draft preview of a website picture: active owner/admin only, never cached. */
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const session = await getServerSession();
  if (!session || (session.user.role !== "OWNER" && session.user.role !== "ADMIN")) {
    return new Response("Not found", { status: 404 });
  }
  const active = await prisma.user.findFirst({ where: { id: session.user.id, archivedAt: null, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } });
  if (!active) return new Response("Not found", { status: 404 });
  const { assetId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(assetId)) return new Response("Not found", { status: 404 });
  const asset = await findServableAsset(assetId, "preview");
  if (!asset) return new Response("Not found", { status: 404 });
  return streamAsset(asset.storageKey, "private, no-store");
}
