import { requireRole } from "@/lib/session";
import { gatherSmallClaimsFacts, renderSmallClaimsPacket } from "@/domains/collections/packet";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ agreementId: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { agreementId } = await params;
  const county = new URL(request.url).searchParams.get("county");
  try {
    const facts = await gatherSmallClaimsFacts(decodeURIComponent(agreementId), county);
    const pdf = await renderSmallClaimsPacket(facts);
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"small-claims-packet.pdf\"", "cache-control": "no-store" } });
  } catch {
    return new Response("Couldn't build the packet.", { status: 404 });
  }
}
