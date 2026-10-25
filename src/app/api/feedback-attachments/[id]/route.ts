import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { getPrivatePhotoStore, isPrivatePhotoPath } from "@/lib/photo-storage";
import { feedbackAttachmentForViewer } from "@/domains/feedback";

// MCP-10a: one app-feedback screenshot, streamed from the private store. Only the owner/admins or the report's own
// sender; a deleted picture, a removed report and "not yours" all answer the same 404 (no existence leak).
const NO_STORE = { "Cache-Control": "private, no-store" };

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  const { id } = await params;
  const pathname = await feedbackAttachmentForViewer(id, { id: session.user.id, role: session.user.role });
  if (!pathname || !isPrivatePhotoPath(pathname)) return notFound();

  const store = getPrivatePhotoStore();
  if (!store) {
    return NextResponse.json({ error: "Private picture storage is not configured here." }, { status: 503, headers: NO_STORE });
  }
  try {
    const result = await get(pathname, {
      token: store.token,
      access: "private",
      useCache: false,
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!result || result.statusCode !== 200) return notFound();
    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(result.blob.size),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "The picture could not be loaded." }, { status: 502, headers: NO_STORE });
  }
}
