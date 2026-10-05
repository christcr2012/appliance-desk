import { getServerSession } from "@/lib/session";
import { buildPrivacyExport, markPrivacyExportFulfilled } from "@/domains/privacy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session || session.user.role !== "OWNER") return new Response("Not found.", { status: 404 });
  const { id } = await params;
  try {
    const body = await buildPrivacyExport(session.user.id, id);
    await markPrivacyExportFulfilled(session.user.id, id);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="privacy-export-${id}.json"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}
