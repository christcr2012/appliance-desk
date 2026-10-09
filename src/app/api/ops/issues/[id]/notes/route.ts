import { type NextRequest, NextResponse } from "next/server";
import { addStructuredAgentNote, authorizeOpsRequest, OpsRequestError } from "@/domains/system-issues/ops-api";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const key = await authorizeOpsRequest(request.headers.get("authorization"));
    const { id } = await context.params;
    let input: unknown;
    try { input = await request.json(); } catch { throw new OpsRequestError(422); }
    await addStructuredAgentNote(key.id, id, input);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof OpsRequestError ? error.status : 500;
    return NextResponse.json({ error: status === 429 ? "Request limit reached." : "Unavailable." },
      { status, headers: { "Cache-Control": "no-store" } });
  }
}
