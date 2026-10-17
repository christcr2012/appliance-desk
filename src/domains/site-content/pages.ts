import { SITE_FIELDS, siteFieldSpec, type SiteFieldSpec } from "./fields";

/**
 * V-C4: the public pages as the owner knows them. The registry groups items by the page they appear on; this gives
 * each group a familiar name, the page to preview, and (for shared words) where else they show.
 */
export type WebsitePage = {
  id: string;
  /** The name the owner sees. */
  name: string;
  /** What the page is, in one plain sentence. */
  about: string;
  /** The registry groups that belong to this page. */
  registryPages: ReadonlyArray<string>;
  /** The public address the preview opens. `null` when there is nothing to look at (search results). */
  previewPath: string | null;
  /** The page only shows while the site is in "preparing to launch" mode. */
  beforeOpeningOnly?: boolean;
  /** The page is a city page: the preview uses the first city in the service area. */
  cityPage?: boolean;
  /** Shown beside the preview when it cannot show this page's changes before they are published. */
  previewNote?: string;
};

export const WEBSITE_PAGES: ReadonlyArray<WebsitePage> = [
  { id: "all", name: "Menu, footer and banner", about: "The top menu, the notice bar, the footer and the site-wide banner shown on every page.", registryPages: ["Every page"], previewPath: "/", previewNote: "The menu, footer and banner appear on every page. The preview shows them as they are live now; your changes show there after you publish." },
  { id: "home", name: "Home page", about: "The first page visitors see once you are open for business.", registryPages: ["Home page"], previewPath: "/" },
  { id: "home-pre", name: "Home page (before opening)", about: "The home page while the site is set to “preparing to launch”.", registryPages: ["Home page (before opening)"], previewPath: "/", beforeOpeningOnly: true },
  { id: "pricing", name: "Pricing", about: "The price cards, fees and “good to know” notes. The prices themselves come from your price list.", registryPages: ["Pricing", "Price cards"], previewPath: "/pricing" },
  { id: "contact", name: "Contact and quote form", about: "The page where people ask for a quote, with every form label and message.", registryPages: ["Get a quote"], previewPath: "/contact" },
  { id: "how", name: "How it works", about: "The steps from asking for a quote to delivery.", registryPages: ["How it works"], previewPath: "/how-it-works" },
  { id: "area", name: "Service area", about: "Where you deliver. The cities and ZIP codes come from Settings.", registryPages: ["Service area"], previewPath: "/service-area" },
  { id: "launch", name: "Launch list", about: "The sign-up page used while you prepare to open.", registryPages: ["Launch list"], previewPath: "/launch" },
  { id: "city", name: "City pages", about: "One page for each city you serve.", registryPages: ["City pages"], previewPath: null, cityPage: true },
  { id: "search", name: "Search results (Google)", about: "The titles and descriptions search engines and link previews show. They are not on a page.", registryPages: ["Search results"], previewPath: null },
];

export function pageForRegistryPage(registryPage: string): WebsitePage | undefined {
  return WEBSITE_PAGES.find((p) => p.registryPages.includes(registryPage));
}

export function websitePageById(id: string): WebsitePage | undefined {
  return WEBSITE_PAGES.find((p) => p.id === id);
}

/** Every item of one page, in the order the page shows them, grouped by section. */
export function sectionsOfPage(page: WebsitePage): { section: string; fields: SiteFieldSpec[] }[] {
  const out: { section: string; fields: SiteFieldSpec[] }[] = [];
  for (const field of SITE_FIELDS) {
    if (!page.registryPages.includes(field.page)) continue;
    const spec = siteFieldSpec(field.key);
    if (!spec) continue;
    let group = out.find((g) => g.section === spec.section);
    if (!group) out.push((group = { section: spec.section, fields: [] }));
    group.fields.push(spec);
  }
  return out;
}

/** Plain places an item shows, for "also shown on". Wording that is shared is named so the owner is not surprised. */
export function sharedPlaces(spec: SiteFieldSpec): string[] {
  if (spec.page === "Every page") return ["Every page of the website"];
  if (spec.key.startsWith("price.")) return ["Pricing page", "Home page price cards", "City pages"];
  if (spec.key === "footer.hours.heading" || spec.key === "footer.closures.heading") return ["Footer on every page", "Contact page"];
  if (spec.key.startsWith("nav.")) return ["Top menu", "Footer menu"];
  return [];
}
