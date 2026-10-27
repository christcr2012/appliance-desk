import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { buildExportPack } from "@/domains/paperwork/records";

/** VAULT-1: download the export pack (ZIP + PDF index, numbers masked). Owner only; audited in the domain. */
export async function GET(request: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session || (session.user as { archivedAt?: unknown }).archivedAt) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can export records." }, { status: 403 });
  }
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (ids.length === 0) {
    return NextResponse.json({ error: "Pick at least one record to export." }, { status: 400 });
  }
  try {
    const pack = await buildExportPack(session.user.id, ids);
    return new Response(Buffer.from(pack.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(pack.bytes.length),
        "Content-Disposition": `attachment; filename="${pack.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The export could not be built." },
      { status: 400 },
    );
  }
}
