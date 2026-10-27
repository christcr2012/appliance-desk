import { requireRole } from "@/lib/session";
import { gatherPacketData, loadPrivatePhoto } from "@/domains/disputes/packet";
import { renderEvidencePacket } from "@/domains/disputes/packet-render";

export const dynamic = "force-dynamic";

/** Read-only preview of exactly what "Approve and send" would upload. Owner and admins only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  try {
    const data = await gatherPacketData(decodeURIComponent(id));
    const packet = await renderEvidencePacket(data, loadPrivatePhoto);
    return new Response(Buffer.from(packet.pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"dispute-evidence.pdf\"", "cache-control": "no-store" },
    });
  } catch {
    return new Response("Couldn't build the packet.", { status: 404 });
  }
}
