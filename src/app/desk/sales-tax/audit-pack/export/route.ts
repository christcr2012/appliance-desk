import { requireRole } from "@/lib/session";
import { auditPackCsv, buildAuditPack, parseAuditRange } from "@/domains/tax/tax-proof";

/** Spreadsheet of the audit pack for a date range. OWNER and ADMIN only; the same rows as the printable page. */
export async function GET(request: Request) {
  await requireRole("OWNER", "ADMIN");
  const { searchParams } = new URL(request.url);
  const range = parseAuditRange(searchParams.get("from") ?? undefined, searchParams.get("to") ?? undefined);
  if ("error" in range) return new Response(range.error, { status: 400 });
  const pack = await buildAuditPack(range.from, range.to);
  return new Response(auditPackCsv(pack), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-pack-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
