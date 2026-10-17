import { SITE_FIELDS, siteFieldSpec, type SitePlaceholder } from "./fields";
import { pageForRegistryPage, sharedPlaces } from "./pages";
import type { FieldValueKind } from "./types";

/**
 * V-C4: what the Website editor needs to know about each item, as plain data it can send to the browser.
 * Nothing here is a secret; it describes the form, never the visitor's or customer's data.
 */
export type EditorField = {
  key: string;
  label: string;
  help: string;
  where: string;
  section: string;
  pageId: string;
  pageName: string;
  valueKind: FieldValueKind;
  optional: boolean;
  /** "paragraph" fields are multi-line; every other kind is one line. */
  multiline: boolean;
  maxLength: number;
  links: boolean;
  placeholders: ReadonlyArray<SitePlaceholder>;
  defaultText: string;
  shared: string[];
  /** A web address field (must start with https://). */
  address: boolean;
};

export function editorFields(): EditorField[] {
  const out: EditorField[] = [];
  for (const field of SITE_FIELDS) {
    const spec = siteFieldSpec(field.key);
    if (!spec) continue;
    const page = pageForRegistryPage(spec.page);
    out.push({
      key: spec.key,
      label: spec.label,
      help: spec.help,
      where: spec.where,
      section: spec.section,
      pageId: page?.id ?? "all",
      pageName: page?.name ?? spec.page,
      valueKind: spec.valueKind,
      optional: spec.optional,
      multiline: spec.kind === "paragraph",
      maxLength: spec.rules.maxLength,
      links: spec.rules.links === true,
      placeholders: spec.placeholders as ReadonlyArray<SitePlaceholder>,
      defaultText: spec.default,
      shared: sharedPlaces(spec),
      address: spec.kind === "url",
    });
  }
  return out;
}
