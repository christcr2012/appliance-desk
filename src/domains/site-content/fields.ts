/**
 * The website text the owner may change (docs/archive/designs-completed/BATCH-D.md D1). This list is the whitelist: a key that is not
 * here can never be saved or shown. Every default is the exact text the public page showed before this list
 * existed, so publishing nothing changes nothing. Prices, phone, email, address and service area are NOT fields:
 * they come from the price list and Settings.
 *
 * Two small placeholders are replaced when a page renders: `{businessName}` (the business name from Settings) and
 * `{name}` (the appliance's name, in picture descriptions).
 */

import type { FieldValueKind, SiteValue } from "./types";
import { PUBLIC_FIELDS } from "./fields-public";
import { checkInlineLinks } from "./richtext";
import type { ValueRules } from "./values";

/** The facts a sentence may mention by name. Each is filled in from its owner (Settings) when the page is shown. */
export type SitePlaceholder = "businessName" | "name" | "phone" | "email" | "city" | "graceDays" | "serviceCities" | "contents" | "amount" | "year";
export const SITE_PLACEHOLDERS: ReadonlyArray<SitePlaceholder> = ["businessName", "name", "phone", "email", "city", "graceDays", "serviceCities", "contents", "amount", "year"];

export type SiteFieldKind = "short" | "paragraph" | "url" | "alt" | "meta";

export type SiteField = {
  key: string;
  label: string;
  /** One plain sentence shown under the field. */
  help: string;
  kind: SiteFieldKind;
  /** The public page this text appears on. */
  page: string;
  /** The part of that page. */
  section: string;
  /** Owner decision that must be made before the owner changes this text (docs/OWNER-INPUTS.md). */
  ownerInput?: "IN-05" | "IN-06" | "IN-11";
  /** Exactly the text the page shows today. Empty means "the section is hidden until you write something". */
  default: string;
  /** V-C1: the kind of value. Text when not stated. */
  valueKind?: FieldValueKind;
  /** V-C1: may be intentionally empty or hidden. When not stated, a field is optional if its starting text is empty. */
  optional?: boolean;
  /** V-C1: a plain sentence saying where it appears. When not stated: "<page>, <section>". */
  where?: string;
  /** V-C1: the part of the page the editor scrolls to in the preview. When not stated, made from the key. */
  anchor?: string;
  /** V-C1: the only {placeholders} allowed. When not stated: {businessName} and {name}. */
  placeholders?: ReadonlyArray<SitePlaceholder>;
  /** V-C3: the text may hold `[words](/page)` links. */
  links?: boolean;
  /** V-C3: for a link, picture or promotion field, the value shown until the owner sets one. */
  defaultValue?: SiteValue;
  /** V-C1: for a list field, the most entries it may hold. */
  maxItems?: number;
};

/** What every field must say about itself (V-C1). Built from the field plus plain defaults. */
export type SiteFieldSpec = Required<Pick<SiteField, "key" | "label" | "help" | "kind" | "page" | "section" | "default" | "valueKind" | "optional" | "where" | "anchor">> & {
  placeholders: ReadonlyArray<string>;
  rules: ValueRules;
  ownerInput?: SiteField["ownerInput"];
};

export const SITE_FIELD_MAX: Record<SiteFieldKind, number> = {
  short: 120,
  paragraph: 2000,
  url: 500,
  alt: 160,
  meta: 160,
};

const FAQ_COUNT = 8;
const HOW_STEPS = 5;

const HOW_DEFAULTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "1. Tell us what you need",
    body: "Fill out the quote form with what you're looking to rent, your address, and your preferred term. It takes about two minutes.",
  },
  {
    title: "2. We follow up personally",
    body: "Chris reviews every request himself and calls or texts you back — usually the same day — to confirm details and answer questions.",
  },
  {
    title: "3. Sign your rental agreement",
    body: "Once everything's confirmed, you'll sign a straightforward rental agreement electronically. Your price is locked in from that point on.",
  },
  {
    title: "4. Delivery & installation",
    body: "We schedule a delivery window that works for you, bring the appliance, install it, and haul away your old one if you need that.",
  },
  {
    title: "5. Ongoing service",
    body: "If anything ever needs attention, you contact us directly — not a national warranty line. We track every request until it's resolved.",
  },
];

const CATALOG_ALT = "A basic {name} — the unit you receive may vary in brand, model, and color";

function faqFields(): SiteField[] {
  const out: SiteField[] = [];
  for (let i = 1; i <= FAQ_COUNT; i += 1) {
    out.push({
      key: `faq.${i}.q`,
      label: `Question ${i}`,
      help: "A question customers ask. The question list only shows once a question and its answer are both filled in.",
      kind: "short",
      page: "Home page",
      section: "Common questions",
      default: "",
    });
    out.push({
      key: `faq.${i}.a`,
      label: `Answer ${i}`,
      help: "Your answer, in plain words. Do not put prices here — they come from your price list.",
      kind: "paragraph",
      page: "Home page",
      section: "Common questions",
      default: "",
    });
  }
  return out;
}

function howFields(): SiteField[] {
  const out: SiteField[] = [];
  for (let i = 1; i <= HOW_STEPS; i += 1) {
    const d = HOW_DEFAULTS[i - 1];
    out.push({
      key: `how.${i}.title`,
      label: `Step ${i} heading`,
      help: "The short heading of this step.",
      kind: "short",
      page: "How it works",
      section: "Steps",
      default: d.title,
    });
    out.push({
      key: `how.${i}.body`,
      label: `Step ${i} explanation`,
      help: "One or two sentences explaining this step to a customer.",
      kind: "paragraph",
      page: "How it works",
      section: "Steps",
      default: d.body,
    });
  }
  return out;
}

const CORE_FIELDS: ReadonlyArray<SiteField> = [
  {
    key: "home.hero.image",
    label: "Main photo",
    help: "The big photo at the top of the home page. Leave it empty to keep the standard photo.",
    kind: "alt",
    valueKind: "image",
    optional: true,
    page: "Home page",
    section: "Top of the page",
    where: "The big photo beside the headline on the home page",
    anchor: "home-hero",
    default: "",
  },
  {
    key: "home.hero.heading",
    label: "Main heading",
    help: "The big headline at the top of the home page.",
    kind: "short",
    page: "Home page",
    section: "Top of the page",
    default: "A clean washer & dryer, delivered — without the down payment.",
  },
  {
    key: "home.hero.body",
    label: "Sub-heading",
    help: "The paragraph under the headline. Write {businessName} where your business name should appear.",
    kind: "paragraph",
    page: "Home page",
    section: "Top of the page",
    default:
      "{businessName} rents washers and dryers to Colorado homes, renters, and property managers on simple month-to-month terms. No big upfront cost, no surprise fees, and real people to call when something needs attention.",
  },
  {
    key: "home.prelaunch.heading",
    label: "Main heading (before opening)",
    help: "The headline visitors see while the site is in \"preparing to launch\" mode.",
    kind: "short",
    page: "Home page",
    section: "Before opening",
    ownerInput: "IN-05",
    default: "Make room for everyday.",
  },
  {
    key: "home.prelaunch.body",
    label: "Sub-heading (before opening)",
    help: "The paragraph under that headline. Do not promise an opening date until you have decided one.",
    kind: "paragraph",
    page: "Home page",
    section: "Before opening",
    ownerInput: "IN-05",
    default:
      "Family-owned washer and dryer rentals for Greeley and the surrounding area. A local option for households and property managers, with maintenance always included.",
  },
  {
    key: "home.household",
    label: "For households",
    help: "A short paragraph for families and renters. Leave empty to hide it.",
    kind: "paragraph",
    page: "Home page",
    section: "Who we rent to",
    ownerInput: "IN-06",
    default: "",
  },
  {
    key: "home.propertyManager",
    label: "For property managers",
    help: "A short paragraph for landlords and property managers. Leave empty to hide it.",
    kind: "paragraph",
    page: "Home page",
    section: "Who we rent to",
    ownerInput: "IN-06",
    default: "",
  },
  ...faqFields(),
  {
    key: "how.intro",
    label: "Introduction",
    help: "The sentence under the page title.",
    kind: "paragraph",
    page: "How it works",
    section: "Top of the page",
    default: "No app to download, no self-checkout — a real person reviews and handles every step.",
  },
  ...howFields(),
  {
    key: "contact.intro",
    label: "Introduction",
    help: "The paragraph above the quote form. Keep the promise that nothing is charged before signing.",
    kind: "paragraph",
    page: "Get a quote",
    section: "Top of the page",
    default:
      "Tell us a bit about what you need. There's no obligation, and we never charge anything until you've signed a rental agreement.",
  },
  {
    key: "image.hero.alt",
    label: "Home page picture description",
    help: "Read aloud to people who cannot see the picture. Describe what is in it, in one sentence.",
    kind: "alt",
    page: "Home page",
    section: "Pictures",
    default: "A washer, dryer, range, and refrigerator — the kinds of appliances we rent",
  },
  {
    key: "image.washer-dryer-set.alt",
    label: "Washer and dryer set picture description",
    help: "Read aloud for the set's photo. Write {name} where the appliance's name should appear.",
    kind: "alt",
    page: "Price cards",
    section: "Pictures",
    default: CATALOG_ALT,
  },
  {
    key: "image.washer.alt",
    label: "Washer picture description",
    help: "Read aloud for the washer's photo. Write {name} where the appliance's name should appear.",
    kind: "alt",
    page: "Price cards",
    section: "Pictures",
    default: CATALOG_ALT,
  },
  {
    key: "image.dryer.alt",
    label: "Dryer picture description",
    help: "Read aloud for the dryer's photo. Write {name} where the appliance's name should appear.",
    kind: "alt",
    page: "Price cards",
    section: "Pictures",
    default: CATALOG_ALT,
  },
  {
    key: "seo.how-it-works.title",
    label: "Search result title",
    help: "The title people see in Google and in the browser tab. Your business name is added automatically.",
    kind: "meta",
    page: "How it works",
    section: "Search results",
    default: "How It Works",
  },
  {
    key: "seo.how-it-works.description",
    label: "Search result description",
    help: "The short summary under the title in Google.",
    kind: "meta",
    page: "How it works",
    section: "Search results",
    default: "How washer and dryer rentals work, from your first request to delivery and ongoing service.",
  },
  {
    key: "seo.contact.title",
    label: "Search result title",
    help: "The title people see in Google and in the browser tab. Your business name is added automatically.",
    kind: "meta",
    page: "Get a quote",
    section: "Search results",
    default: "Get a Quote",
  },
  {
    key: "seo.contact.description",
    label: "Search result description",
    help: "The short summary under the title in Google.",
    kind: "meta",
    page: "Get a quote",
    section: "Search results",
    default: "Request a washer or dryer rental quote in Colorado — we follow up personally, usually the same day.",
  },
  {
    key: "seo.pricing.title",
    label: "Search result title",
    help: "The title people see in Google and in the browser tab. Your business name is added automatically.",
    kind: "meta",
    page: "Pricing",
    section: "Search results",
    default: "Pricing",
  },
  {
    key: "seo.pricing.description",
    label: "Search result description",
    help: "The short summary under the title in Google.",
    kind: "meta",
    page: "Pricing",
    section: "Search results",
    default: "Simple, published monthly pricing for washer and dryer rentals in Colorado — no hidden fees.",
  },
  {
    key: "seo.service-area.title",
    label: "Search result title",
    help: "The title people see in Google and in the browser tab. Your business name is added automatically.",
    kind: "meta",
    page: "Service area",
    section: "Search results",
    default: "Service Area",
  },
  {
    key: "seo.service-area.description",
    label: "Search result description",
    help: "The short summary under the title in Google.",
    kind: "meta",
    page: "Service area",
    section: "Search results",
    default: "Where we currently deliver and service appliance rentals in Colorado.",
  },
];

/** Everything the owner may change on the public website: the core fields above plus every other visible item (V-C3). */
export const SITE_FIELDS: ReadonlyArray<SiteField> = [...CORE_FIELDS, ...PUBLIC_FIELDS];

/**
 * Keys that used to exist under another name map to today's key, so a renamed field never loses the owner's words.
 * Empty today: every key has kept its name. A redesign (V-C5) adds the old name here when it renames one.
 */
export const SITE_KEY_ALIASES: Readonly<Record<string, string>> = {};

export function canonicalSiteKey(key: string): string {
  return SITE_KEY_ALIASES[key] ?? key;
}

const BY_KEY = new Map(SITE_FIELDS.map((f) => [f.key, f]));

export function siteFieldByKey(key: string): SiteField | undefined {
  return BY_KEY.get(key);
}

function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The complete description of one field, with every plain default filled in (V-C1). */
export function describeSiteField(field: SiteField): SiteFieldSpec {
  const valueKind = field.valueKind ?? "text";
  const optional = field.optional ?? field.default === "";
  const placeholders = field.placeholders ?? ["businessName", "name"];
  const rules: ValueRules = {
    label: field.label,
    valueKind,
    optional,
    maxLength: SITE_FIELD_MAX[field.kind],
    singleLine: field.kind !== "paragraph",
    httpsOnly: field.kind === "url",
    placeholders,
    ...(field.links ? { links: true } : {}),
    ...(field.maxItems ? { maxItems: field.maxItems } : {}),
  };
  return {
    key: field.key, label: field.label, help: field.help, kind: field.kind, page: field.page, section: field.section,
    default: field.default, valueKind, optional,
    where: field.where ?? `${field.page}, ${field.section.toLowerCase()}`,
    anchor: field.anchor ?? (slugOf(field.key.split(".").slice(0, -1).join("-")) || slugOf(field.key)),
    placeholders, rules, ownerInput: field.ownerInput,
  };
}

const SPEC_BY_KEY = new Map(SITE_FIELDS.map((f) => [f.key, describeSiteField(f)]));

export function siteFieldSpec(key: string): SiteFieldSpec | undefined {
  return SPEC_BY_KEY.get(key);
}

/**
 * Facts that appear on the website but are owned somewhere else (V-C1). The website shows them; it never stores a copy
 * that could disagree, and changing website words never changes a charged amount or a signed agreement.
 */
export type SiteFactSource = {
  key: string;
  domain: "profile" | "pricing" | "catalog" | "policy";
  label: string;
  /** The owner screen where it is changed. */
  editHref: string;
  /** Plain sentence shown next to it in the website editor. */
  usedOn: string;
};

export const SITE_FACT_SOURCES: ReadonlyArray<SiteFactSource> = [
  { key: "profile.publicPhone", domain: "profile", label: "Phone number", editHref: "/desk/settings", usedOn: "Used on the website, in quotes and in messages to customers." },
  { key: "profile.publicEmail", domain: "profile", label: "Email address", editHref: "/desk/settings", usedOn: "Used on the website, in quotes and in messages to customers." },
  { key: "profile.address", domain: "profile", label: "Business address", editHref: "/desk/settings", usedOn: "Used on the website and on customer documents." },
  { key: "profile.hours", domain: "profile", label: "Business hours", editHref: "/desk/settings", usedOn: "Used on the website and in the contact page." },
  { key: "profile.serviceArea", domain: "profile", label: "Cities and ZIP codes you serve", editHref: "/desk/settings", usedOn: "Used on the website, the address check and city pages." },
  { key: "pricing.monthlyRent", domain: "pricing", label: "Monthly rent for each appliance and set", editHref: "/desk/settings", usedOn: "Used on the website and in quotes. Changing a price here does not change signed agreements." },
  { key: "catalog.photos", domain: "catalog", label: "Appliance photos on the price cards", editHref: "/desk/settings", usedOn: "Used on every page that shows that appliance." },
  { key: "policy.terms", domain: "policy", label: "Rental terms and policies", editHref: "/desk/settings", usedOn: "Used on the website and in agreements. Signed agreements keep the terms they were signed with." },
];

/** A key that is allowed in a revision: today's registry, plus the compatibility mapping for old names. */
export function isKnownSiteKey(key: string): boolean {
  return BY_KEY.has(canonicalSiteKey(key));
}

/** The starting value of every link, picture and promotion field (the text fields use siteDefaults). */
export function siteDefaultTypedValues(): Record<string, SiteValue> {
  const out: Record<string, SiteValue> = {};
  for (const f of SITE_FIELDS) if ((f.valueKind ?? "text") !== "text" && f.defaultValue) out[f.key] = f.defaultValue;
  return out;
}

export function siteDefaults(): Record<string, string> {
  return Object.fromEntries(SITE_FIELDS.filter((f) => (f.valueKind ?? "text") === "text").map((f) => [f.key, f.default]));
}

export type SanitizeResult =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; message: string };

/**
 * Check and clean what the owner typed. Unknown keys are refused. Every `<` and `>` is removed (plain text only).
 * An empty value is dropped: the page then shows the starting text (or hides an optional section). Pure.
 */
export function sanitizeSiteFields(input: unknown): SanitizeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Those website changes could not be read." };
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = BY_KEY.get(key);
    if (!field) return { ok: false, message: "One of those fields is not something you can change." };
    if ((field.valueKind ?? "text") !== "text") return { ok: false, message: `${field.label} must be text.` };
    if (typeof raw !== "string") return { ok: false, message: `${field.label} must be text.` };
    const value = raw.replace(/[<>]/g, "").replace(/\r\n?/g, "\n").trim();
    if (!value) continue;
    const max = SITE_FIELD_MAX[field.kind];
    if (value.length > max) {
      return { ok: false, message: `${field.label} (${field.page}) is too long: ${max} characters at most.` };
    }
    if (field.kind === "url" && !value.startsWith("https://")) {
      return { ok: false, message: `${field.label} must start with https://` };
    }
    if (field.kind !== "paragraph" && value.includes("\n")) {
      return { ok: false, message: `${field.label} must be on one line.` };
    }
    if (field.links) {
      const problem = checkInlineLinks(value);
      if (problem) return { ok: false, message: `${field.label}: ${problem}` };
    }
    const allowed: ReadonlyArray<string> = field.placeholders ?? ["businessName", "name"];
    for (const match of value.matchAll(/\{(\w+)\}/g)) {
      if (!allowed.includes(match[1])) {
        return { ok: false, message: `${field.label} uses {${match[1]}}, which is not available here.` };
      }
    }
    out[key] = value;
  }
  return { ok: true, fields: out };
}

export type SiteTextFacts = Partial<Record<SitePlaceholder, string>>;

/** Replace the placeholders. Unknown placeholders, and facts the page does not have, are left as typed. */
export function fillSiteText(text: string, values: SiteTextFacts): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = (values as Record<string, string | undefined>)[name];
    return (SITE_PLACEHOLDERS as ReadonlyArray<string>).includes(name) && value !== undefined ? value : whole;
  });
}

/** The picture description for an appliance photo: the owner's text for that picture, or the standard sentence. */
export function catalogAlt(content: Record<string, string>, slug: string, name: string): string {
  const key = `image.${slug}.alt`;
  const text = siteFieldByKey(key) ? (content[key] ?? CATALOG_ALT) : CATALOG_ALT;
  return fillSiteText(text, { name: name.toLowerCase() });
}
