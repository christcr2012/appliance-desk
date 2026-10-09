import { type NextRequest, NextResponse } from "next/server";
import { authorizeOpsRequest, getOpsIssues, OpsRequestError } from "@/domains/system-issues/ops-api";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await authorizeOpsRequest(request.headers.get("authorization"));
    const params = request.nextUrl.searchParams;
    const limit = params.has("limit") ? Number(params.get("limit")) : 25;
    const result = await getOpsIssues({ limit, cursor: params.get("cursor") || undefined });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof OpsRequestError ? error.status : 500;
    return NextResponse.json({ error: status === 429 ? "Request limit reached." : "Unavailable." },
      { status, headers: { "Cache-Control": "no-store" } });
  }
}
