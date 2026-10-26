import { requireRole } from "@/lib/session";
import { questionnaireFile } from "@/domains/decisions/forms";
import { isProfessionalAudience } from "@/domains/decisions/form-content";

/**
 * DEC-1b: the questionnaire for one professional, as Word (.docx) or PDF — every question with them that isn't
 * answered yet. Owner and admins (staff are sent away by requireRole). Never cached; no customer data in it.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await requireRole("OWNER", "ADMIN");
  const params = new URL(request.url).searchParams;
  const audience = params.get("for");
  const format = params.get("format");
  if (!isProfessionalAudience(audience) || (format !== "docx" && format !== "pdf")) {
    return new Response("Choose who the questions are for and Word or PDF.", { status: 400 });
  }
  const file = await questionnaireFile(session.user.id, audience, format);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
