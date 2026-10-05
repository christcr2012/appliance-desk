import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { readArtifactForViewer } from "@/domains/documents/artifacts";

/** A saved copy of a signed agreement, invoice or statement. Private: the owner/admin or the customer it belongs to. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { id } = await params;
  const role = session.user.role;
  const doc = await readArtifactForViewer(id, { userId: session.user.id, role });
  // Someone else's document looks exactly like one that does not exist.
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(doc.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${doc.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
