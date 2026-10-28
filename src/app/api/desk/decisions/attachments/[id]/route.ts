import { get } from "@vercel/blob";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { DECISION_FILE_TYPES, decisionAttachmentForViewer } from "@/domains/decisions/attachments";
import { NO_STORE, guardDecisionRequest, jsonError } from "../../guard";

export const runtime = "nodejs";

// DEC-1b: a professional's completed form kept with a decision record. Owner and admins only; "no such file" and
// "not yours" answer the same 404. Always downloaded (never shown inline), never cached.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await guardDecisionRequest(request, ["OWNER", "ADMIN", "ACCOUNTANT"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let found: Awaited<ReturnType<typeof decisionAttachmentForViewer>>;
  try {
    found = await decisionAttachmentForViewer(guard.userId, id);
  } catch {
    return jsonError("Not found.", 404);
  }
  if (!found) return jsonError("Not found.", 404);
  const store = getPrivatePhotoStore();
  if (!store) return jsonError("Private file storage is not configured here.", 503);
  try {
    const result = await get(found.pathname, { token: store.token, access: "private", useCache: false,
      abortSignal: AbortSignal.timeout(15_000) });
    if (!result || result.statusCode !== 200) return jsonError("Not found.", 404);
    return new Response(result.stream, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": DECISION_FILE_TYPES[found.kind],
        "Content-Length": String(result.blob.size),
        "Content-Disposition": `attachment; filename="completed-form.${found.kind}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("The file could not be loaded.", 502);
  }
}
