import { SITE_TEMPLATE_VERSION, type FieldValueKind, type SiteValue } from "./types";

/**
 * V-C5: the written agreement between the website layout (the "template") and the content it shows.
 *
 * Why this exists: the layout and the owner's content change on different days. If a new layout quietly stopped
 * showing something the owner wrote (or needed something new that the owner never wrote), nobody would notice until a
 * visitor did. This file lists every place the layout shows owner content, with the kind of content and its length
 * limit, so a test can prove the list matches the editor exactly, and a release rule can refuse a layout change that
 * has not been written down here. The list is deliberately typed out by hand: generating it from the editor would make
 * the check agree with itself.
 *
 * Every place the layout shows information belongs to exactly one of three owners:
 *   - the editor (a "content slot": the owner writes it here),
 *   - one other part of the product (a "domain slot": the phone number comes from Settings, prices from the price list),
 *   - nobody (a "structure slot": a landmark or a form field name that is not content at all).
 */

/** [key, kind, longest text, optional?] */
export type ContentSlot = readonly [key: string, kind: FieldValueKind, maxLength: number, optional?: true];

export const TEMPLATE_CONTRACT_VERSION = SITE_TEMPLATE_VERSION;

/** Content formats this layout can still show. The release rule renders a saved example of each one. */
export const SUPPORTED_CONTENT_SCHEMAS: ReadonlyArray<1 | 2> = [1, 2];
/** The oldest content format still supported. The release rule fails if the layout cannot show it. */
export const LAST_SUPPORTED_CONTENT_SCHEMA = 1;

export const CONTENT_SLOTS: ReadonlyArray<ContentSlot> = [
  ["home.hero.image", "image", 160, true],
  ["home.hero.heading", "text", 120],
  ["home.hero.body", "text", 2000],
  ["home.prelaunch.heading", "text", 120],
  ["home.prelaunch.body", "text", 2000],
  ["home.household", "text", 2000, true],
  ["home.propertyManager", "text", 2000, true],
  ["faq.1.q", "text", 120, true],
  ["faq.1.a", "text", 2000, true],
  ["faq.2.q", "text", 120, true],
  ["faq.2.a", "text", 2000, true],
  ["faq.3.q", "text", 120, true],
  ["faq.3.a", "text", 2000, true],
  ["faq.4.q", "text", 120, true],
  ["faq.4.a", "text", 2000, true],
  ["faq.5.q", "text", 120, true],
  ["faq.5.a", "text", 2000, true],
  ["faq.6.q", "text", 120, true],
  ["faq.6.a", "text", 2000, true],
  ["faq.7.q", "text", 120, true],
  ["faq.7.a", "text", 2000, true],
  ["faq.8.q", "text", 120, true],
  ["faq.8.a", "text", 2000, true],
  ["how.intro", "text", 2000],
  ["how.1.title", "text", 120],
  ["how.1.body", "text", 2000],
  ["how.2.title", "text", 120],
  ["how.2.body", "text", 2000],
  ["how.3.title", "text", 120],
  ["how.3.body", "text", 2000],
  ["how.4.title", "text", 120],
  ["how.4.body", "text", 2000],
  ["how.5.title", "text", 120],
  ["how.5.body", "text", 2000],
  ["contact.intro", "text", 2000],
  ["image.hero.alt", "text", 160],
  ["image.washer-dryer-set.alt", "text", 160],
  ["image.washer.alt", "text", 160],
  ["image.dryer.alt", "text", 160],
  ["seo.how-it-works.title", "text", 160],
  ["seo.how-it-works.description", "text", 160],
  ["seo.contact.title", "text", 160],
  ["seo.contact.description", "text", 160],
  ["seo.pricing.title", "text", 160],
  ["seo.pricing.description", "text", 160],
  ["seo.service-area.title", "text", 160],
  ["seo.service-area.description", "text", 160],
  ["nav.pricing", "text", 120],
  ["nav.howItWorks", "text", 120],
  ["nav.serviceArea", "text", 120],
  ["nav.contact", "text", 120],
  ["header.login", "text", 120],
  ["header.cta.live", "link", 120],
  ["header.cta.prelaunch", "link", 120],
  ["launch.notice", "text", 2000, true],
  ["footer.tagline", "text", 2000],
  ["footer.explore.heading", "text", 120],
  ["footer.contact.heading", "text", 120],
  ["footer.hours.heading", "text", 120],
  ["footer.closures.heading", "text", 120],
  ["footer.copyright", "text", 120],
  ["footer.privacy", "text", 120],
  ["footer.terms", "text", 120],
  ["footer.accessibility", "text", 120],
  ["site.banner.promotion", "promotion", 2000, true],
  ["seo.site.title", "text", 160],
  ["seo.site.description", "text", 160],
  ["seo.site.prelaunch", "text", 160],
  ["price.perMonth", "text", 120],
  ["price.illustrationNote", "text", 2000],
  ["price.saving", "text", 120],
  ["home.hero.eyebrow", "text", 120],
  ["home.hero.cta.primary", "link", 120],
  ["home.hero.cta.secondary", "link", 120],
  ["home.hero.highlight", "text", 120, true],
  ["home.check.address.label", "text", 120],
  ["home.check.zip.label", "text", 120],
  ["home.check.served", "text", 120],
  ["home.check.served.free", "text", 120],
  ["home.check.served.noprice", "text", 120],
  ["home.check.served.cta", "text", 120],
  ["home.check.notyet", "text", 120],
  ["home.check.notyet.cta", "text", 120],
  ["home.check.unknown", "text", 120],
  ["home.check.limited", "text", 120],
  ["home.check.invalid", "text", 120],
  ["home.ticket.label", "text", 120],
  ["home.benefit.1.title", "text", 120],
  ["home.benefit.1.body", "text", 2000],
  ["home.benefit.2.title", "text", 120],
  ["home.benefit.2.body", "text", 2000],
  ["home.benefit.3.title", "text", 120],
  ["home.benefit.3.body", "text", 2000],
  ["home.how.heading", "text", 120],
  ["home.how.intro", "text", 2000],
  ["home.how.step.1", "text", 120],
  ["home.how.step.2", "text", 120],
  ["home.how.step.3", "text", 120],
  ["home.how.step.4", "text", 120],
  ["home.household.title", "text", 120],
  ["home.propertyManager.title", "text", 120],
  ["home.pricing.heading", "text", 120],
  ["home.pricing.intro", "text", 2000],
  ["home.pricing.empty", "text", 2000],
  ["home.faq.heading", "text", 120],
  ["home.cta.heading", "text", 120],
  ["home.cta.body", "text", 2000],
  ["home.cta.button", "link", 120],
  ["home.feature.promotion", "promotion", 2000, true],
  ["home.prelaunch.eyebrow", "text", 120],
  ["home.prelaunch.cta.primary", "link", 120],
  ["home.prelaunch.cta.secondary", "link", 120],
  ["home.prelaunch.note", "text", 2000],
  ["home.prelaunch.benefit.1.title", "text", 120],
  ["home.prelaunch.benefit.1.body", "text", 2000],
  ["home.prelaunch.benefit.2.title", "text", 120],
  ["home.prelaunch.benefit.2.body", "text", 2000],
  ["home.prelaunch.benefit.3.title", "text", 120],
  ["home.prelaunch.benefit.3.body", "text", 2000],
  ["home.prelaunch.cta.heading", "text", 120],
  ["home.prelaunch.cta.body", "text", 2000],
  ["home.prelaunch.cta.button", "link", 120],
  ["pricing.heading", "text", 120],
  ["pricing.intro", "text", 2000],
  ["pricing.card.includes", "text", 120],
  ["pricing.card.saving", "text", 120],
  ["pricing.card.cta", "link", 120],
  ["pricing.empty", "text", 2000],
  ["pricing.fees.heading", "text", 120],
  ["pricing.fee.delivery", "text", 120],
  ["pricing.fee.installation", "text", 120],
  ["pricing.fee.removal", "text", 120],
  ["pricing.fee.none", "text", 120],
  ["pricing.good.heading", "text", 120],
  ["pricing.good.terms.label", "text", 120],
  ["pricing.good.terms.text", "text", 2000],
  ["pricing.good.deposit.label", "text", 120],
  ["pricing.good.deposit.text", "text", 2000],
  ["pricing.good.waiver.label", "text", 120],
  ["pricing.good.waiver.text", "text", 2000],
  ["pricing.good.tax.label", "text", 120],
  ["pricing.good.tax.text", "text", 2000],
  ["pricing.good.late.label", "text", 120],
  ["pricing.good.late.text", "text", 2000],
  ["pricing.cta", "link", 120],
  ["contact.heading", "text", 120],
  ["contact.form.about", "text", 120],
  ["contact.form.accountType", "text", 120],
  ["contact.form.individual", "text", 120],
  ["contact.form.business", "text", 120],
  ["contact.form.companyName", "text", 120],
  ["contact.form.propertyManager", "text", 120],
  ["contact.form.contactName", "text", 120],
  ["contact.form.phone", "text", 120],
  ["contact.form.email", "text", 120],
  ["contact.form.emailHelp", "text", 120],
  ["contact.form.bestTime", "text", 120],
  ["contact.form.bestTimeExample", "text", 120],
  ["contact.form.need", "text", 120],
  ["contact.form.appliances", "text", 120],
  ["contact.form.noAppliances", "text", 2000],
  ["contact.form.quantity", "text", 120],
  ["contact.form.term", "text", 120],
  ["contact.form.startDate", "text", 120],
  ["contact.form.where", "text", 120],
  ["contact.form.address", "text", 120],
  ["contact.form.city", "text", 120],
  ["contact.form.zip", "text", 120],
  ["contact.form.more", "text", 120],
  ["contact.form.howHeard", "text", 120],
  ["contact.form.notes", "text", 120],
  ["contact.form.referral", "text", 120],
  ["contact.form.referralExample", "text", 120],
  ["contact.form.consent", "text", 2000],
  ["contact.form.submit", "text", 120],
  ["contact.form.sending", "text", 120],
  ["contact.thanks.title", "text", 120],
  ["contact.thanks.body", "text", 2000],
  ["how.heading", "text", 120],
  ["how.cta", "link", 120],
  ["area.heading", "text", 120],
  ["area.intro", "text", 2000],
  ["area.map.title", "text", 120],
  ["area.map.north", "text", 120],
  ["area.map.scale", "text", 120],
  ["area.map.center", "text", 120],
  ["area.legend.heading", "text", 120],
  ["area.zone.miles", "text", 120],
  ["area.zone.free", "text", 120],
  ["area.zone.price", "text", 120],
  ["area.zone.hidden", "text", 120],
  ["area.zone.outside", "text", 120],
  ["area.zone.pickup", "text", 120],
  ["area.check.heading", "text", 120],
  ["area.check.button", "text", 120],
  ["area.towns.heading", "text", 120],
  ["area.towns.note", "text", 2000],
  ["area.towns.outside", "text", 120],
  ["area.cta", "link", 120],
  ["launch.eyebrow", "text", 120],
  ["launch.heading", "text", 120],
  ["launch.intro", "text", 2000],
  ["launch.point.1", "text", 2000],
  ["launch.point.2", "text", 2000],
  ["launch.point.3", "text", 2000],
  ["launch.status.open", "text", 2000],
  ["launch.status.closed", "text", 2000],
  ["launch.question", "text", 2000],
  ["launch.card.open", "text", 120],
  ["launch.card.closed", "text", 120],
  ["launch.card.cta", "link", 120],
  ["launch.form.name", "text", 120],
  ["launch.form.email", "text", 120],
  ["launch.form.city", "text", 120],
  ["launch.form.interest", "text", 120],
  ["launch.form.privacy", "text", 2000],
  ["launch.form.submit", "text", 120],
  ["launch.form.saving", "text", 120],
  ["seo.launch.title", "text", 160],
  ["seo.launch.description", "text", 160],
  ["rent.heading", "text", 120],
  ["rent.intro", "text", 2000],
  ["rent.cta.top", "link", 120],
  ["rent.empty", "text", 2000],
  ["rent.serving.heading", "text", 120],
  ["rent.serving.body", "text", 2000],
  ["rent.zone", "text", 120],
  ["rent.zone.outside", "text", 120],
  ["rent.zone.cta", "link", 120],
  ["rent.call", "text", 120],
  ["rent.cta.bottom", "link", 120],
  ["seo.rent.title", "text", 160],
  ["seo.rent.description", "text", 160]
];

/** Information the layout shows that another part of the product owns. The website never keeps its own copy. */
export type DomainSlot = { id: string; owner: string; placeholder?: string; note: string };
export const DOMAIN_SLOTS: ReadonlyArray<DomainSlot> = [
  { id: "business-name", owner: "Settings: business profile", placeholder: "businessName", note: "The public business name." },
  { id: "phone", owner: "Settings: business profile", placeholder: "phone", note: "The phone number in the menu, footer and call buttons." },
  { id: "email", owner: "Settings: business profile", placeholder: "email", note: "The email address in the footer and email buttons." },
  { id: "hours", owner: "Settings: business hours", note: "Opening hours and holiday closures." },
  { id: "service-cities", owner: "Settings: delivery zones (town list)", placeholder: "serviceCities", note: "The towns served, and the town pages." },
  { id: "service-zips", owner: "Settings: delivery zones", note: "Replaced by the zone map; ZIP codes are no longer listed." },
  { id: "city", owner: "Settings: delivery zones (town list)", placeholder: "city", note: "The name of the town on a town page." },
  { id: "delivery-zone", owner: "Settings: delivery zones", placeholder: "zone", note: "A delivery zone's name." },
  { id: "delivery-price", owner: "Settings: delivery zones", placeholder: "price", note: "A zone's delivery price (shown only when you switch prices on)." },
  { id: "delivery-miles", owner: "Settings: delivery zones", placeholder: "miles", note: "Miles from the center of Greeley." },
  { id: "grace-days", owner: "Settings: late fees", placeholder: "graceDays", note: "Days before a late fee applies." },
  { id: "prices", owner: "Price list", note: "Every rental price, fee and deposit." },
  { id: "monthly-saving", owner: "Price list", placeholder: "amount", note: "The saving shown for a package." },
  { id: "appliance-name", owner: "Price list", placeholder: "name", note: "The name of an appliance or package." },
  { id: "package-contents", owner: "Price list", placeholder: "contents", note: "What a package includes." },
  { id: "appliance-photos", owner: "Price list: appliance photos", note: "The picture of each appliance." },
  { id: "year", owner: "The calendar", placeholder: "year", note: "The current year in the footer." },
];

/** Things the layout needs that are not content at all. */
export type StructureSlot = { id: string; note: string };
export const STRUCTURE_SLOTS: ReadonlyArray<StructureSlot> = [
  { id: "skip-link", note: "The “skip to main content” link and page landmarks." },
  { id: "language", note: "The page language setting." },
  { id: "form-field-names", note: "The names the quote and launch forms send; the visible labels are content slots." },
  { id: "form-spam-guard", note: "The hidden anti-spam field and timing check." },
  { id: "structured-data", note: "Search-engine business data built from Settings." },
];

/**
 * A short fingerprint of the slots above. When anyone changes a slot, the release rule fails until this value and the
 * template version are updated on purpose, which is the moment to decide how the owner's existing content carries over.
 */
export function contractFingerprint(slots: ReadonlyArray<ContentSlot> = CONTENT_SLOTS): string {
  let hash = 2166136261;
  for (const slot of slots) {
    for (const ch of slot.join("|") + "\n") {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}
export const CONTRACT_FINGERPRINT = "2a4085e6";

// ---------------------------------------------------------------------------------------------------------------
// Compatibility plan: what happens to the owner's content when the layout changes (or is rolled back).
// Pure: it reads two contracts and a set of stored values and returns a new set. It never edits anything stored.
// ---------------------------------------------------------------------------------------------------------------

export type ContractShape = { version: string; slots: ReadonlyArray<ContentSlot> };

export type CompatibilityReport = {
  /** The values the new layout will read: carried over, renamed, nothing invented over what the owner wrote. */
  values: Record<string, SiteValue>;
  /** Owner content the new layout does not show. It is kept (never deleted) so a rollback brings it back. */
  preserved: Record<string, SiteValue>;
  renamed: { from: string; to: string }[];
  retired: string[];
  /** Slots the new layout needs that the owner has not written; the starting wording will show. Never applied over written content. */
  newRequired: string[];
  /** Content whose kind no longer matches its slot. It cannot be converted safely, so a person must decide. */
  blocking: { key: string; was: string; needs: string }[];
};

export function planCompatibility(
  from: ContractShape,
  to: ContractShape,
  stored: Record<string, SiteValue>,
  renames: Readonly<Record<string, string>> = {},
): CompatibilityReport {
  const target = new Map(to.slots.map((slot) => [slot[0], slot]));
  const source = new Set(from.slots.map((slot) => slot[0]));
  const report: CompatibilityReport = { values: {}, preserved: {}, renamed: [], retired: [], newRequired: [], blocking: [] };
  for (const [key, value] of Object.entries(stored)) {
    const destination = target.has(key) ? key : renames[key] && target.has(renames[key]) ? renames[key] : null;
    if (!destination) {
      report.preserved[key] = value;
      report.retired.push(key);
      continue;
    }
    const slot = target.get(destination)!;
    if (value.kind !== "hidden" && value.kind !== slot[1]) {
      report.blocking.push({ key, was: value.kind, needs: slot[1] });
      report.preserved[key] = value;
      continue;
    }
    if (value.kind === "hidden" && !slot[3]) {
      report.blocking.push({ key, was: "hidden", needs: slot[1] });
      report.preserved[key] = value;
      continue;
    }
    if (destination !== key) report.renamed.push({ from: key, to: destination });
    report.values[destination] = value;
  }
  for (const slot of to.slots) {
    if (!source.has(slot[0]) && !slot[3] && !(slot[0] in report.values)) report.newRequired.push(slot[0]);
  }
  report.retired.sort();
  report.newRequired.sort();
  return report;
}
