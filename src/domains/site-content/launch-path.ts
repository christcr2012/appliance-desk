type PreviewParams = { revision?: string | string[]; previewAt?: string | string[]; select?: string | string[] } | undefined;

const PREVIEW_REVISION = /^[A-Za-z0-9_-]{8,64}$/;
const PREVIEW_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * Where a page that is not shown yet (pricing and city pages while the site is "preparing to launch") sends the visitor:
 * the launch page. The owner's preview switches ride along so the preview keeps working there; they are only ever
 * honoured for an active owner or admin, so passing them on gives no one anything else.
 */
export function launchPath(searchParams?: PreviewParams): string {
  const query = new URLSearchParams();
  const revision = searchParams?.revision;
  if (typeof revision === "string" && PREVIEW_REVISION.test(revision)) {
    query.set("revision", revision);
    const at = searchParams?.previewAt;
    if (typeof at === "string" && PREVIEW_INSTANT.test(at)) query.set("previewAt", at);
    if (searchParams?.select === "1") query.set("select", "1");
  }
  const text = query.toString();
  return text ? `/launch?${text}` : "/launch";
}
