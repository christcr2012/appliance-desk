import { PreviewBridge } from "./preview-bridge";
import { SITE_KEYS } from "@/domains/site-content/preview-markers";
import type { SiteRequest } from "@/domains/site-content/request";

/** Present only in the owner's signed-in select-to-edit preview; for every visitor this renders nothing. */
export function SelectBridge({ site }: { site: Pick<SiteRequest, "selectable" | "revisionId"> }) {
  return site.selectable && site.revisionId ? <PreviewBridge keys={SITE_KEYS} revisionId={site.revisionId} /> : null;
}
