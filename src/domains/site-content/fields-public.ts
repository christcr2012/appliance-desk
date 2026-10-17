import type { SiteField, SiteFieldKind, SitePlaceholder } from "./fields";
import type { SiteLinkTarget } from "./types";

/**
 * V-C3: every visible word, button and picture on the public website that is not owned by Settings, the price list,
 * the catalog or a legal approval. Each starting text is exactly what the page showed before this list existed
 * (tests/fixtures/public-pages/*.txt prove it), so publishing nothing changes nothing. Facts such as the business name,
 * phone, email, city and late-fee days are written as {placeholders} and filled from their owner when the page shows.
 */

const FACT_WORDS: Record<string, string> = {
  businessName: "your business name",
  name: "the appliance's name",
  phone: "your phone number",
  email: "your email address",
  city: "the city",
  graceDays: "the late-fee grace days",
  serviceCities: "the cities you serve",
  contents: "what the set includes",
  amount: "the monthly saving",
  year: "the current year",
};

type Extra = {
  help?: string;
  placeholders?: ReadonlyArray<SitePlaceholder>;
  links?: boolean;
  optional?: boolean;
  where?: string;
  anchor?: string;
  ownerInput?: SiteField["ownerInput"];
};

function helpFor(kind: SiteFieldKind, page: string, section: string, extra: Extra): string {
  const base = extra.help ?? (kind === "meta" ? `What Google and link previews show for the ${page.toLowerCase()}.` : `Shown on the ${page.toLowerCase()}, in “${section}”.`);
  const facts = (extra.placeholders ?? []).map((p) => `{${p}} for ${FACT_WORDS[p] ?? p}`);
  const factSentence = facts.length ? ` Write ${facts.join(", ")} where it should appear.` : "";
  const linkSentence = extra.links ? " To make words a link, write [the words](/pricing) or [the words](https://example.com)." : "";
  return base + factSentence + linkSentence;
}

function text(page: string, section: string, key: string, label: string, kind: "short" | "paragraph" | "meta" | "alt", def: string, extra: Extra = {}): SiteField {
  return {
    key, label, kind, page, section, default: def,
    help: helpFor(kind, page, section, extra),
    ...(extra.placeholders ? { placeholders: extra.placeholders } : {}),
    ...(extra.links ? { links: true } : {}),
    ...(extra.optional !== undefined ? { optional: extra.optional } : {}),
    ...(extra.where ? { where: extra.where } : {}),
    ...(extra.anchor ? { anchor: extra.anchor } : {}),
  };
}

function link(page: string, section: string, key: string, label: string, words: string, target: SiteLinkTarget, extra: Extra = {}): SiteField {
  return {
    key, label, kind: "short", valueKind: "link", optional: false, page, section, default: "",
    help: extra.help ?? `A button or link on the ${page.toLowerCase()}, in “${section}”. Choose the words and where it goes.`,
    defaultValue: { kind: "link", label: words, target },
    ...(extra.placeholders ? { placeholders: extra.placeholders } : {}),
    ...(extra.where ? { where: extra.where } : {}),
    ...(extra.anchor ? { anchor: extra.anchor } : {}),
  };
}

const page = (path: string): SiteLinkTarget => ({ type: "page", path });

// ---------------------------------------------------------------------------------------------------------------
const ALL = "Every page";
const chrome: SiteField[] = [
  text(ALL, "Top menu", "nav.pricing", "Menu: Pricing", "short", "Pricing", { help: "The words for the Pricing link in the top menu and the footer. It always opens the pricing page." }),
  text(ALL, "Top menu", "nav.howItWorks", "Menu: How it works", "short", "How It Works", { help: "The words for the How it works link in the top menu and the footer. It always opens that page." }),
  text(ALL, "Top menu", "nav.serviceArea", "Menu: Service area", "short", "Service Area", { help: "The words for the Service area link in the top menu and the footer. It always opens that page." }),
  text(ALL, "Footer", "nav.contact", "Footer: Get a quote link", "short", "Get a Quote", { help: "The words for the quote link in the footer's Explore list. It always opens the quote page." }),
  text(ALL, "Top menu", "header.login", "Menu: Log in", "short", "Log in", { help: "The words for the sign-in link. It always opens the sign-in page." }),
  link(ALL, "Top menu", "header.cta.live", "Menu button (open for business)", "Get a Quote", page("/contact")),
  link(ALL, "Top menu", "header.cta.prelaunch", "Menu button (before opening)", "Join launch list", page("/launch")),
  text(ALL, "Notice bar", "launch.notice", "Notice before opening", "paragraph", "We're preparing to launch in Greeley and the surrounding area. [Join for updates](/launch).", { links: true, optional: true, help: "The thin bar under the menu while the site is in “preparing to launch” mode. Leave it empty to hide the bar." }),
  text(ALL, "Footer", "footer.tagline", "Footer: about line", "paragraph", "Straightforward appliance rentals for Colorado homes and properties — delivered, installed, and serviced by a real local business."),
  text(ALL, "Footer", "footer.explore.heading", "Footer: Explore heading", "short", "Explore"),
  text(ALL, "Footer", "footer.contact.heading", "Footer: Contact heading", "short", "Contact"),
  text(ALL, "Footer", "footer.hours.heading", "Footer: Hours heading", "short", "Hours (Colorado time)", { help: "Heading above your opening hours. The hours themselves come from Settings." }),
  text(ALL, "Footer", "footer.closures.heading", "Footer: Closures heading", "short", "Upcoming closures", { help: "Heading above upcoming holiday closures. The closures themselves come from Settings." }),
  text(ALL, "Footer", "footer.copyright", "Footer: copyright line", "short", "© {year} {businessName}. All rights reserved.", { placeholders: ["year", "businessName"] }),
  text(ALL, "Footer", "footer.privacy", "Footer: Privacy Policy link", "short", "Privacy Policy", { help: "The words for the privacy link. It shows only once the privacy policy is approved." }),
  text(ALL, "Footer", "footer.terms", "Footer: Terms link", "short", "Terms", { help: "The words for the terms link. It shows only once the terms are approved." }),
  text(ALL, "Footer", "footer.accessibility", "Footer: Accessibility link", "short", "Accessibility", { help: "The words for the accessibility link." }),
  { key: "site.banner.promotion", label: "Site-wide promotion banner", help: "A banner across the top of every page. Switched off until you set one up. It shows only between the start and end you choose (Colorado time).", kind: "paragraph", valueKind: "promotion", optional: true, page: ALL, section: "Banner", default: "", defaultValue: { kind: "hidden" }, where: "A banner above the menu on every page" },
  text("Search results", "Whole site", "seo.site.title", "Site title in Google", "meta", "{businessName} — Appliance Rentals in Colorado", { placeholders: ["businessName"], help: "The default title for pages that do not have their own." }),
  text("Search results", "Whole site", "seo.site.description", "Site description in Google", "meta", "Rent a washer and dryer in Colorado with simple month-to-month pricing, fast delivery, and no long-term commitment.", { help: "What Google and link previews show about the site while you are open for business." }),
  text("Search results", "Whole site", "seo.site.prelaunch", "Site description before opening", "meta", "Family-owned washer and dryer rentals preparing to launch in Greeley and surrounding areas. Maintenance included. Join for launch updates.", { help: "What Google and link previews show while the site is in “preparing to launch” mode." }),
];

// Shared by the home page, the pricing page and city pages.
const PRICES = "Price cards";
const prices: SiteField[] = [
  text(PRICES, "Every price card", "price.perMonth", "“per month” words", "short", "/ month", { help: "Shown after each monthly price. The price itself comes from your price list." }),
  text(PRICES, "Every price card", "price.illustrationNote", "Note under the price cards", "paragraph", "Illustrations are generic and for reference only — the actual appliance you receive may vary in brand, model, and color.", { help: "Keep a note that the appliance you deliver may differ from the picture." }),
  text(PRICES, "Set price cards", "price.saving", "Saving line on a set (home page and city pages)", "short", "{contents} — save {amount} a month", { placeholders: ["contents", "amount"] }),
];

const HOME = "Home page";
const home: SiteField[] = [
  text(HOME, "Top of the page", "home.hero.eyebrow", "Small line above the heading", "short", "Now renting in {city}", { placeholders: ["city", "businessName"], help: "The small tag above the main heading. {city} is the first city in your service area." }),
  link(HOME, "Top of the page", "home.hero.cta.primary", "Main button", "Check your address", page("/contact")),
  link(HOME, "Top of the page", "home.hero.cta.secondary", "Second link", "See prices", page("/pricing")),
  text(HOME, "Top of the page", "home.hero.highlight", "Phrase to highlight in the heading", "short", "", { optional: true, help: "One phrase from the main heading to mark with a green highlight. Copy it exactly from the heading; if it is not part of the heading, or you leave this empty, nothing is highlighted." }),
  text(HOME, "Address check", "home.check.address.label", "Street address box: label", "short", "Street address", { help: "The label above the street address box in the address check at the top of the home page." }),
  text(HOME, "Address check", "home.check.zip.label", "ZIP code box: label", "short", "ZIP code", { help: "The label above the ZIP code box in the address check." }),
  text(HOME, "Address check", "home.check.served", "Answer when you deliver there", "short", "Good news: we deliver to your area.", { help: "Shown when the ZIP code or city is in your service area (Settings). Promise nothing else here, such as dates or prices." }),
  text(HOME, "Address check", "home.check.served.cta", "Link after a yes", "short", "Tell us what you need", { help: "The link shown after a yes. It opens the quote page with the address filled in; where it goes is the Main button's destination in “Top of the page”." }),
  text(HOME, "Address check", "home.check.notyet", "Answer when you do not deliver there yet", "short", "We don't deliver to that area yet.", { help: "Shown when the ZIP code and city are not in your service area." }),
  text(HOME, "Address check", "home.check.notyet.cta", "Link after a no", "short", "Join the launch list", { help: "The link shown after a no. It opens the launch list sign-up page." }),
  text(HOME, "Address check", "home.check.limited", "Message when someone checks too often", "short", "Too many checks just now. Please wait a few minutes, or call us.", { help: "Shown if the same visitor asks for many checks in a short time." }),
  text(HOME, "Address check", "home.check.invalid", "Message when the address is incomplete", "short", "Enter your street address and a five-digit ZIP code.", { help: "Shown when the street address is empty or the ZIP code is not five digits." }),
  text(HOME, "Top of the page", "home.ticket.label", "Small line on the price tag", "short", "Starting at", { help: "The small words above the price on the floating price tag by the main picture. The tag shows your published set price and only appears when you have one." }),
  ...[1, 2, 3].flatMap((n) => [
    text(HOME, "Three reasons", `home.benefit.${n}.title`, `Reason ${n}: title`, "short", ["No long-term contract", "Delivered & installed", "We fix it, fast"][n - 1]),
    text(HOME, "Three reasons", `home.benefit.${n}.body`, `Reason ${n}: text`, "paragraph", [
      "Month-to-month, 6-month, or 12-month terms — you choose, and you can change your mind later.",
      "We bring it, hook it up, and haul away your old unit if you need that too.",
      "Something breaks, you call us — not a warranty hotline in another state.",
    ][n - 1]),
  ]),
  text(HOME, "How renting works", "home.how.heading", "Heading", "short", "How renting works"),
  text(HOME, "How renting works", "home.how.intro", "Introduction", "paragraph", "Four steps, and Chris personally reviews every request — this is a real local business, not a call center."),
  ...[1, 2, 3, 4].map((n) => text(HOME, "How renting works", `home.how.step.${n}`, `Step ${n}`, "short", ["Tell us what you need", "We follow up to confirm details", "Sign your rental agreement", "We deliver & install"][n - 1])),
  text(HOME, "Households and property managers", "home.household.title", "Households: title", "short", "For households", { help: "The title of the households box. The box shows only when its text (set separately) is not empty." }),
  text(HOME, "Households and property managers", "home.propertyManager.title", "Property managers: title", "short", "For property managers", { help: "The title of the property managers box. The box shows only when its text (set separately) is not empty." }),
  text(HOME, "Prices", "home.pricing.heading", "Heading", "short", "Simple, published pricing"),
  text(HOME, "Prices", "home.pricing.intro", "Introduction", "paragraph", "Starting with washers and dryers, with more appliance types on the way. Every price below is real, and never changes for you once you sign — see our [full pricing page](/pricing).", { links: true }),
  text(HOME, "Prices", "home.pricing.empty", "When no prices are listed yet", "paragraph", "Pricing is being finalized — reach out and we'll quote you directly."),
  text(HOME, "Questions", "home.faq.heading", "Heading", "short", "Common questions"),
  text(HOME, "Closing call to action", "home.cta.heading", "Heading", "short", "Ready to get set up?"),
  text(HOME, "Closing call to action", "home.cta.body", "Text", "paragraph", "Tell us what you need and where — we'll follow up with a quote, usually the same day."),
  link(HOME, "Closing call to action", "home.cta.button", "Button", "Check your address", page("/contact")),
  { key: "home.feature.promotion", label: "Featured promotion", help: "A highlighted offer or announcement on the home page. Switched off until you set one up. It shows only between the start and end you choose (Colorado time).", kind: "paragraph", valueKind: "promotion", optional: true, page: HOME, section: "Featured promotion", default: "", defaultValue: { kind: "hidden" }, where: "A highlighted box between the top of the home page and the three reasons" },
];

const PRE = "Home page (before opening)";
const prelaunch: SiteField[] = [
  text(PRE, "Top of the page", "home.prelaunch.eyebrow", "Small line above the heading", "short", "Preparing to launch · Greeley, Colorado"),
  link(PRE, "Top of the page", "home.prelaunch.cta.primary", "Main button", "Join the launch interest list", page("/launch")),
  link(PRE, "Top of the page", "home.prelaunch.cta.secondary", "Second link", "Ask a question", page("/contact")),
  text(PRE, "Top of the page", "home.prelaunch.note", "Note under the buttons", "paragraph", "No payment or rental commitment. Our opening date is still being finalized."),
  ...[1, 2, 3].flatMap((n) => [
    text(PRE, "Three reasons", `home.prelaunch.benefit.${n}.title`, `Reason ${n}: title`, "short", ["Maintenance included", "Delivery & installation", "Local households & properties"][n - 1]),
    text(PRE, "Three reasons", `home.prelaunch.benefit.${n}.body`, `Reason ${n}: text`, "paragraph", [
      "Maintenance is always part of your rental.",
      "Available based on your location and setup. We confirm requirements and any fees before you commit.",
      "Planning for renters, homeowners, landlords, and property managers in Greeley and the surrounding area.",
    ][n - 1]),
  ]),
  text(PRE, "Closing call to action", "home.prelaunch.cta.heading", "Heading", "short", "Help us get ready for your neighborhood."),
  text(PRE, "Closing call to action", "home.prelaunch.cta.body", "Text", "paragraph", "Tell us your city and which appliances interest you. We'll send launch news and a short introduction to our business."),
  link(PRE, "Closing call to action", "home.prelaunch.cta.button", "Button", "Keep me updated", page("/launch")),
];

const PRICING = "Pricing";
const pricing: SiteField[] = [
  text(PRICING, "Top of the page", "pricing.heading", "Heading", "short", "Pricing"),
  text(PRICING, "Top of the page", "pricing.intro", "Introduction", "paragraph", "Every price below is what {businessName} actually charges — nothing hidden, and it's locked in for you the day you sign, even if prices change later for new customers.", { placeholders: ["businessName"], help: "Keep the promise that a signed price is locked in; it is true of every agreement." }),
  text(PRICING, "Price cards", "pricing.card.includes", "“Includes” line on a set", "short", "Includes: {contents}", { placeholders: ["contents"] }),
  text(PRICING, "Price cards", "pricing.card.saving", "Saving line on a set", "short", "Save {amount} a month compared with renting them separately", { placeholders: ["amount"] }),
  link(PRICING, "Price cards", "pricing.card.cta", "Button on each price card", "Get this one", page("/contact")),
  text(PRICING, "Price cards", "pricing.empty", "When no prices are listed yet", "paragraph", "Pricing is being finalized — [reach out](/contact) and we'll quote you directly.", { links: true }),
  text(PRICING, "One-time fees", "pricing.fees.heading", "Heading", "short", "One-time fees"),
  text(PRICING, "One-time fees", "pricing.fee.delivery", "Fee name: delivery", "short", "Delivery", { help: "The name of the fee. The amount comes from Settings." }),
  text(PRICING, "One-time fees", "pricing.fee.installation", "Fee name: installation", "short", "Installation", { help: "The name of the fee. The amount comes from Settings." }),
  text(PRICING, "One-time fees", "pricing.fee.removal", "Fee name: pickup", "short", "Pickup / removal", { help: "The name of the fee. The amount comes from Settings." }),
  text(PRICING, "One-time fees", "pricing.fee.none", "Words when a fee is zero", "short", "No charge"),
  text(PRICING, "Good to know", "pricing.good.heading", "Heading", "short", "Good to know"),
  text(PRICING, "Good to know", "pricing.good.terms.label", "Terms: name", "short", "Terms:"),
  text(PRICING, "Good to know", "pricing.good.terms.text", "Terms: text", "paragraph", "month-to-month, 6-month, or 12-month — you choose at signup.", { help: "Must match the terms your rental agreement offers." }),
  text(PRICING, "Good to know", "pricing.good.deposit.label", "Deposit: name", "short", "Refundable security deposit:", { help: "Shown only while the deposit is switched on in Settings." }),
  text(PRICING, "Good to know", "pricing.good.deposit.text", "Deposit: text", "paragraph", "required, refunded when the appliance is returned in good condition.", { help: "Shown only while the deposit is switched on in Settings. Must match your deposit policy." }),
  text(PRICING, "Good to know", "pricing.good.waiver.label", "Damage waiver: name", "short", "Optional damage waiver:", { help: "Shown only while the damage waiver is switched on in Settings." }),
  text(PRICING, "Good to know", "pricing.good.waiver.text", "Damage waiver: text", "paragraph", "available if you'd rather not put down a deposit.", { help: "Shown only while the damage waiver is switched on in Settings. Must match your waiver policy." }),
  text(PRICING, "Good to know", "pricing.good.tax.label", "Sales tax: name", "short", "Sales tax:"),
  text(PRICING, "Good to know", "pricing.good.tax.text", "Sales tax: text", "paragraph", "plus sales tax for your service address, shown on your invoice."),
  text(PRICING, "Good to know", "pricing.good.late.label", "Late fee: name", "short", "Late fee:"),
  text(PRICING, "Good to know", "pricing.good.late.text", "Late fee: text", "paragraph", "a grace period of {graceDays} days applies before any late fee.", { placeholders: ["graceDays"], help: "{graceDays} comes from your late-fee setting, so it can never disagree with it." }),
  link(PRICING, "Bottom of the page", "pricing.cta", "Button", "Get a free quote", page("/contact")),
];

const CONTACT = "Get a quote";
const contact: SiteField[] = [
  text(CONTACT, "Top of the page", "contact.heading", "Heading", "short", "Get a free quote"),
  text(CONTACT, "Form: About you", "contact.form.about", "Section title", "short", "About you"),
  text(CONTACT, "Form: About you", "contact.form.accountType", "Question: who is renting", "short", "Are you renting for yourself or a business/property?"),
  text(CONTACT, "Form: About you", "contact.form.individual", "Choice: myself", "short", "Myself"),
  text(CONTACT, "Form: About you", "contact.form.business", "Choice: business", "short", "Business / property"),
  text(CONTACT, "Form: About you", "contact.form.companyName", "Company name label", "short", "Company name"),
  text(CONTACT, "Form: About you", "contact.form.propertyManager", "Landlord checkbox", "short", "I'm a landlord, property manager, or apartment operator"),
  text(CONTACT, "Form: About you", "contact.form.contactName", "Name label", "short", "Your name"),
  text(CONTACT, "Form: About you", "contact.form.phone", "Phone label", "short", "Phone number"),
  text(CONTACT, "Form: About you", "contact.form.email", "Email label", "short", "Email"),
  text(CONTACT, "Form: About you", "contact.form.emailHelp", "Email hint", "short", "Optional, but recommended"),
  text(CONTACT, "Form: About you", "contact.form.bestTime", "Best time label", "short", "Best time to reach you"),
  text(CONTACT, "Form: About you", "contact.form.bestTimeExample", "Best time example", "short", "e.g. weekday afternoons"),
  text(CONTACT, "Form: What you need", "contact.form.need", "Section title", "short", "What you need"),
  text(CONTACT, "Form: What you need", "contact.form.appliances", "Appliances label", "short", "Appliances you're interested in"),
  text(CONTACT, "Form: What you need", "contact.form.noAppliances", "When none are listed", "paragraph", "No appliance options are listed yet. Tell us what you need in the notes below."),
  text(CONTACT, "Form: What you need", "contact.form.quantity", "Quantity label", "short", "Quantity"),
  text(CONTACT, "Form: What you need", "contact.form.term", "Term label", "short", "Desired term"),
  text(CONTACT, "Form: What you need", "contact.form.startDate", "Start date label", "short", "Desired start date"),
  text(CONTACT, "Form: Where", "contact.form.where", "Section title", "short", "Where"),
  text(CONTACT, "Form: Where", "contact.form.address", "Address label", "short", "Service address"),
  text(CONTACT, "Form: Where", "contact.form.city", "City label", "short", "City"),
  text(CONTACT, "Form: Where", "contact.form.zip", "ZIP label", "short", "ZIP code"),
  text(CONTACT, "Form: Anything else", "contact.form.more", "Section title", "short", "Anything else"),
  text(CONTACT, "Form: Anything else", "contact.form.howHeard", "How heard label", "short", "How did you hear about us?"),
  text(CONTACT, "Form: Anything else", "contact.form.notes", "Notes label", "short", "Notes"),
  text(CONTACT, "Form: Anything else", "contact.form.referral", "Referral code label", "short", "Referral code (optional)"),
  text(CONTACT, "Form: Anything else", "contact.form.referralExample", "Referral code example", "short", "Got a code from a friend? Enter it here"),
  text(CONTACT, "Form: Agreement", "contact.form.consent", "Agreement line", "paragraph", "I agree to the [privacy policy](/privacy) and [terms](/terms).", { links: true, help: "The checkbox words. Keep links to the privacy policy and terms so people can read what they agree to." }),
  text(CONTACT, "Form: Buttons", "contact.form.submit", "Send button", "short", "Request a quote"),
  text(CONTACT, "Form: Buttons", "contact.form.sending", "Sending words", "short", "Sending…"),
  text(CONTACT, "After sending", "contact.thanks.title", "Thank-you title", "short", "Thanks — we've got your request."),
  text(CONTACT, "After sending", "contact.thanks.body", "Thank-you text", "paragraph", "We'll follow up soon, usually the same day, to confirm details and get you a firm quote."),
];

const HOW = "How it works";
const how: SiteField[] = [
  text(HOW, "Top of the page", "how.heading", "Heading", "short", "How it works"),
  link(HOW, "Bottom of the page", "how.cta", "Button", "Get a free quote", page("/contact")),
];

const AREA = "Service area";
const area: SiteField[] = [
  text(AREA, "Top of the page", "area.heading", "Heading", "short", "Service area"),
  text(AREA, "Top of the page", "area.intro", "Introduction", "paragraph", "We're growing — not sure if we cover your address yet? Ask us on the quote form and we'll tell you honestly."),
  text(AREA, "Lists", "area.cities.heading", "Heading above the cities", "short", "Cities we serve", { help: "The cities themselves come from Settings." }),
  text(AREA, "Lists", "area.zips.heading", "Heading above the ZIP codes", "short", "ZIP codes we serve", { help: "The ZIP codes themselves come from Settings." }),
  text(AREA, "Lists", "area.empty", "When no area is listed yet", "paragraph", "The service area list is being finalized. Send us your address on the quote form and we'll confirm whether we can deliver to you."),
  link(AREA, "Bottom of the page", "area.cta", "Button", "Check your address", page("/contact")),
];

const LAUNCH = "Launch list";
const launch: SiteField[] = [
  text(LAUNCH, "Left side", "launch.eyebrow", "Small line above the heading", "short", "Greeley, Colorado + surrounding areas"),
  text(LAUNCH, "Left side", "launch.heading", "Heading", "short", "Make room for everyday."),
  text(LAUNCH, "Left side", "launch.intro", "Introduction", "paragraph", "We're {businessName}, a small family business building a local option for washer and dryer rentals.", { placeholders: ["businessName"] }),
  ...[1, 2, 3].map((n) => text(LAUNCH, "Left side", `launch.point.${n}`, `Bullet ${n}`, "paragraph", [
    "Maintenance is always included.",
    "Delivery and installation are available. Requirements and any fees depend on your situation.",
    "For local households, landlords, and property managers.",
  ][n - 1])),
  text(LAUNCH, "Left side", "launch.status.open", "Status while the list is open", "paragraph", "We're still preparing to open. Join for launch news and a short introduction to how we plan to help. Our opening date is not yet confirmed.", { help: "Shown while the site is in “preparing to launch” mode. Do not promise an opening date unless it is confirmed." }),
  text(LAUNCH, "Left side", "launch.status.closed", "Status once the list is closed", "paragraph", "Our prelaunch list is closed. Contact us to discuss your rental needs."),
  text(LAUNCH, "Left side", "launch.question", "Question line", "paragraph", "Already have a specific question? [Contact us](/contact).", { links: true }),
  text(LAUNCH, "Right side", "launch.card.open", "Box title while open", "short", "Be part of our local launch"),
  text(LAUNCH, "Right side", "launch.card.closed", "Box title once closed", "short", "Let's talk about your needs"),
  link(LAUNCH, "Right side", "launch.card.cta", "Button once closed", "Request information", page("/contact")),
  text(LAUNCH, "Sign-up form", "launch.form.name", "Name label", "short", "Name"),
  text(LAUNCH, "Sign-up form", "launch.form.email", "Email label", "short", "Email"),
  text(LAUNCH, "Sign-up form", "launch.form.city", "City label", "short", "City"),
  text(LAUNCH, "Sign-up form", "launch.form.interest", "Interest label", "short", "What are you interested in?"),
  text(LAUNCH, "Sign-up form", "launch.form.privacy", "Privacy note", "paragraph", "Read our [privacy policy](/privacy). No payment, rental commitment, or phone number required.", { links: true }),
  text(LAUNCH, "Sign-up form", "launch.form.submit", "Join button", "short", "Join the interest list"),
  text(LAUNCH, "Sign-up form", "launch.form.saving", "Saving words", "short", "Saving…"),
  text("Search results", "Launch list", "seo.launch.title", "Launch page title in Google", "meta", "Greeley appliance rentals — launch interest list"),
  text("Search results", "Launch list", "seo.launch.description", "Launch page description in Google", "meta", "A family-owned washer and dryer rental business preparing to serve Greeley and surrounding areas. Join for launch news. Maintenance included."),
];

const RENT = "City pages";
const rent: SiteField[] = [
  text(RENT, "Top of the page", "rent.heading", "Heading", "short", "Appliance rental in {city}, Colorado", { placeholders: ["city"], help: "Every city in your service area gets its own page. {city} is that page's city." }),
  text(RENT, "Top of the page", "rent.intro", "Introduction", "paragraph", "{businessName} delivers, installs, and services washers and dryers for {city} renters and homeowners — no purchase, no long-term commitment required, and repairs are covered by us for as long as you rent.", { placeholders: ["businessName", "city"] }),
  link(RENT, "Top of the page", "rent.cta.top", "Top button", "Get a quote for {city}", page("/contact"), { placeholders: ["city"] }),
  text(RENT, "Prices", "rent.empty", "When no prices are listed yet", "paragraph", "Pricing is being finalized — send us your address on the quote form and we'll confirm what's available in {city}.", { placeholders: ["city"] }),
  text(RENT, "Coverage", "rent.serving.heading", "Coverage heading", "short", "Serving {city} and the surrounding area", { placeholders: ["city"] }),
  text(RENT, "Coverage", "rent.serving.body", "Coverage text", "paragraph", "Not sure if your exact address is covered yet? Ask on the quote form and we'll tell you honestly — we're growing our service area over time."),
  text(RENT, "Coverage", "rent.call", "Phone line", "short", "Call us at {phone}", { placeholders: ["phone"], help: "Shown only when your phone number is set in Settings." }),
  link(RENT, "Coverage", "rent.cta.bottom", "Bottom button", "Check your address in {city}", page("/contact"), { placeholders: ["city"] }),
  text("Search results", "City pages", "seo.rent.title", "City page title in Google", "meta", "Appliance Rental in {city}, CO", { placeholders: ["city"] }),
  text("Search results", "City pages", "seo.rent.description", "City page description in Google", "meta", "Washer and dryer rentals in {city}, Colorado from {businessName} — delivery, installation, and repairs included.", { placeholders: ["city", "businessName"] }),
];

export const PUBLIC_FIELDS: ReadonlyArray<SiteField> = [
  ...chrome, ...prices, ...home, ...prelaunch, ...pricing, ...contact, ...how, ...area, ...launch, ...rent,
];
