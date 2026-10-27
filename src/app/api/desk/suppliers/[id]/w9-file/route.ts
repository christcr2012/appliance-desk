import { get } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getPrivatePhotoStore } from "@/lib/photo-storage";

export const runtime = "nodejs";

// CMP-3 (PR #655 review): the supplier's W-9 file from the private store —
// the typed answers' filled form, or the PDF the supplier uploaded. Owner
// and admins only; without it the owner could not read an uploaded W-9 to
// transcribe its tax ID and mailing address. "No such supplier" and "no
// file" answer the same 404. Always a download, never cached.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireRole("OWNER", "ADMIN");
  } catch {
    return new Response("Not found.", { status: 404 });
  }
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { w9FileUrl: true } });
  if (!supplier?.w9FileUrl) return new Response("Not found.", { status: 404 });
  let pathname: string;
  try {
    pathname = new URL(supplier.w9FileUrl).pathname.replace(/^\//, "");
  } catch {
    return new Response("Not found.", { status: 404 });
  }
  if (!pathname.includes("compliance/w9/")) return new Response("Not found.", { status: 404 });
  const store = getPrivatePhotoStore();
  if (!store) return new Response("Private file storage is not configured here.", { status: 503 });
  try {
    const result = await get(pathname, { token: store.token, access: "private", useCache: false, abortSignal: AbortSignal.timeout(15_000) });
    if (!result || result.statusCode !== 200) return new Response("Not found.", { status: 404 });
    return new Response(result.stream, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
        "Content-Length": String(result.blob.size),
        "Content-Disposition": "attachment; filename=\"w9.pdf\"",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("The file could not be loaded.", { status: 502 });
  }
}
