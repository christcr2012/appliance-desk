import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { loadStatementFacts } from "@/domains/refrigerant/actions";
import { renderStatementPdf } from "@/domains/refrigerant/statement";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const facts = await loadStatementFacts(id);
  if (!facts) return NextResponse.json({ error: "No refrigerant record for this appliance." }, { status: 404 });
  const pdf = await renderStatementPdf(facts);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="refrigerant-statement-${facts.assetNumber}.pdf"`, "cache-control": "private, no-store" },
  });
}
