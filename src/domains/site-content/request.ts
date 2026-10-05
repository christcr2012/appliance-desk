import { getServerSession } from "@/lib/session";
import { getPublishedContent, getRevisionContent } from "./index";

/**
 * The website text for this page view. `?revision=<id>` previews a draft or an old version, but ONLY for a signed-in
 * owner or admin: for anyone else the parameter is ignored and the live text is shown.
 */
export async function getContentForRequest(
  searchParams?: { revision?: string | string[] } | undefined,
): Promise<Record<string, string>> {
  const raw = searchParams?.revision;
  const revisionId = typeof raw === "string" ? raw : undefined;
  if (!revisionId) return getPublishedContent();
  const session = await getServerSession();
  const role = session?.user.role;
  if (role === "OWNER" || role === "ADMIN") return getRevisionContent(revisionId);
  return getPublishedContent();
}
