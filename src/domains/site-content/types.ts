/**
 * V-C1: the typed values the website can hold (docs/designs/BATCH-V.md D-VC1).
 * Plain data only — no HTML, no script, no raw URLs without the checks in links.ts.
 */

/** Where a link goes. A phone number or email is never typed into a link: it is the verified business profile's own. */
export type SiteLinkTarget =
  | { type: "page"; path: string; anchor?: string }
  | { type: "external"; url: string }
  | { type: "phone" }
  | { type: "email" };

export type TextValue = { kind: "text"; text: string };
export type LinkValue = { kind: "link"; label: string; target: SiteLinkTarget };
export type ImageValue = {
  kind: "image";
  /** A website picture id (the website picture library only; see assets.ts). */
  assetId: string;
  alt: string;
  decorative: boolean;
  /** Where the picture stays centred when it is cropped, as whole numbers 0 to 100. */
  focalX: number;
  focalY: number;
};
/** A list inside an existing slot (questions, benefits, gallery). One level of nesting only. */
export type ItemsValue = { kind: "items"; items: { id: string; values: Record<string, SiteValue> }[] };
export type PromotionValue = {
  kind: "promotion";
  title: string;
  body: string;
  image?: ImageValue;
  cta?: LinkValue;
  enabled: boolean;
  /** UTC instants (ISO 8601). Owners enter and see Colorado time. */
  startsAtUtc?: string;
  endsAtUtc?: string;
  offerVersionId?: string;
};
/** Explicitly hidden. Allowed only for content that is optional. */
export type HiddenValue = { kind: "hidden" };

export type SiteValue = TextValue | LinkValue | ImageValue | ItemsValue | PromotionValue | HiddenValue;
export type SiteValueKind = SiteValue["kind"];

/** The kind of value a registry field holds. `hidden` is a state of an optional field, not a field kind. */
export type FieldValueKind = Exclude<SiteValueKind, "hidden">;

/** A content format version stored on each revision. 1 = plain text per key, 2 = typed values per key. */
export const CONTENT_SCHEMA_VERSION_TEXT = 1;
export const CONTENT_SCHEMA_VERSION_TYPED = 2;
export type ContentSchemaVersion = 1 | 2;

/** The website layout the current code renders (V-C5 gives this a contract). */
export const SITE_TEMPLATE_VERSION = "signature-2";

/** A stored value that cannot be read as what its field expects. Never rendered as text such as [object Object]. */
export class SiteContentError extends Error {
  constructor(
    message: string,
    readonly key?: string,
  ) {
    super(message);
    this.name = "SiteContentError";
  }
}
