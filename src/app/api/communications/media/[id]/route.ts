import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { getPrivateVoiceMediaForRead } from "@/domains/messaging/voice-media";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session || (session.user as { archivedAt?: unknown }).archivedAt)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!["OWNER", "ADMIN", "STAFF"].includes(session.user.role))
    return NextResponse.json({ error: "Media not found." }, { status: 404 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{8,45}$/.test(id))
    return NextResponse.json({ error: "Media not found." }, { status: 404 });
  const media = await getPrivateVoiceMediaForRead(session.user.id, id);
  if (!media) return NextResponse.json({ error: "Media not found." }, { status: 404 });
  const store = getPrivatePhotoStore();
  if (!store) return NextResponse.json({
    error: "Private media storage is not configured.",
  }, { status: 503 });
  try {
    const blob = await get(media.privateStorageKey, {
      token: store.token, access: "private",
      useCache: false, abortSignal: AbortSignal.timeout(15_000),
    });
    if (!blob || blob.statusCode !== 200 || blob.blob.size <= 0 ||
        blob.blob.size > 8 * 1024 * 1024 ||
        blob.blob.contentType !== "audio/mpeg")
      return NextResponse.json({ error: "Media is unavailable." }, { status: 404 });
    return new Response(blob.stream, { status: 200, headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(blob.blob.size),
      "Content-Disposition": "inline; filename=\"voicemail.mp3\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "Media could not be loaded." }, { status: 502 });
  }
}
