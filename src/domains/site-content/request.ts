import { getServerSession } from "@/lib/session";
import { getPublishedContent, getPublishedValues, getRevisionContent, getRevisionValues } from "./index";
import { markContent } from "./preview-markers";
import type { SiteValue } from "./types";

type RequestParams = { revision?: string | string[]; previewAt?: string | string[]; select?: string | string[] } | undefined;

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

export type SiteRequest = {
  /** Words, with starting text filled in. */
  text: Record<string, string>;
  /** Links, pictures and promotions (and the typed form of everything), with starting values filled in. */
  values: Record<string, SiteValue>;
  /** True only for a signed-in owner or admin looking at a draft or old version. Visitors always get false. */
  preview: boolean;
  /** The moment promotions are judged against. A preview may look at a future moment with `?previewAt=`. */
  now: Date;
  /** The revision being previewed (owner/admin preview only). */
  revisionId?: string;
  /** True only in the owner's signed-in select-to-edit preview: words carry invisible marks the preview script reads. */
  selectable: boolean;
};

/**
 * V-C3: everything a public page needs from the website content, in one read. Anyone who is not an active owner or
 * admin gets the live version and the real time: `revision` and `previewAt` are ignored for them.
 */
export async function getSiteForRequest(searchParams?: RequestParams): Promise<SiteRequest> {
  const rawRevision = searchParams?.revision;
  const revisionId = typeof rawRevision === "string" ? rawRevision : undefined;
  if (revisionId) {
    const session = await getServerSession();
    const role = session?.user.role;
    if (role === "OWNER" || role === "ADMIN") {
      const rawAt = searchParams?.previewAt;
      const parsed = typeof rawAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(rawAt) ? new Date(rawAt) : null;
      const [text, values] = await Promise.all([getRevisionContent(revisionId), getRevisionValues(revisionId)]);
      const selectable = searchParams?.select === "1";
      const marked = selectable ? markContent(text, values) : { text, values };
      return { ...marked, preview: true, selectable, revisionId, now: parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date() };
    }
  }
  const [text, values] = await Promise.all([getPublishedContent(), getPublishedValues()]);
  return { text, values, preview: false, selectable: false, now: new Date() };
}
