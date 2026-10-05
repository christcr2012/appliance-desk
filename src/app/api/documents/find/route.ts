import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { resolveArtifactForViewer } from "@/domains/documents/artifacts";

/** /api/documents/find?kind=invoice&id=…  (or kind=agreement&id=…, or kind=statement&id=<customerId>&month=YYYY-MM) */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  if ((kind !== "agreement" && kind !== "invoice" && kind !== "statement") || !id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const artifactId = await resolveArtifactForViewer(
    { userId: session.user.id, role: session.user.role },
    { kind, id, month: url.searchParams.get("month") ?? undefined },
  );
  if (!artifactId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.redirect(new URL(`/api/documents/${artifactId}`, request.url), 303);
}
