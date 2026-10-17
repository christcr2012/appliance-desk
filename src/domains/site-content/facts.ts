import { fillSiteText, type SiteTextFacts } from "./fields";
import type { LinkValue, SiteValue } from "./types";

/**
 * V-C3: the facts a sentence may mention, taken from their owners (Settings) at the moment the page is shown.
 * The website text only holds {placeholders}; it never holds a copy of a fact that could drift.
 */
export function siteFacts(
  settings: { publicBusinessName: string; publicPhone: string; publicEmail: string; lateFeeGraceDays?: number },
  extra: SiteTextFacts = {},
): SiteTextFacts {
  return {
    businessName: settings.publicBusinessName,
    phone: settings.publicPhone,
    email: settings.publicEmail,
    ...(settings.lateFeeGraceDays !== undefined ? { graceDays: String(settings.lateFeeGraceDays) } : {}),
    year: String(new Date().getFullYear()),
    ...extra,
  };
}

/** A reader for one page: `c("home.hero.heading")` gives that item's words with the facts filled in. */
export function siteCopy(text: Record<string, string>, facts: SiteTextFacts) {
  return (key: string, extra: SiteTextFacts = {}): string => fillSiteText(text[key] ?? "", { ...facts, ...extra });
}

/** The link stored under a key, or undefined when it is not a link (or has been hidden). */
export function siteLinkValue(values: Record<string, SiteValue>, key: string): LinkValue | undefined {
  const value = values[key];
  return value && value.kind === "link" ? value : undefined;
}

/** The plain words with link marks removed, for page titles and descriptions. */
export { stripInlineLinks } from "./richtext";
