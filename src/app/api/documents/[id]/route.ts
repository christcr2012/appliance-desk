import { getServerSession } from "@/lib/session";
import { readArtifactForViewer } from "@/domains/documents/artifacts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session) return new Response("Not found.", { status: 404 });

  const { id } = await params;
  const artifact = await readArtifactForViewer(id, {
    userId: session.user.id,
    role: session.user.role,
  });
  if (!artifact) return new Response("Not found.", { status: 404 });

  return new Response(artifact.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Disposition": `inline; filename="${artifact.filename}"`,
    },
  });
}
