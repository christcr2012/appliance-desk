# V-C3 — every public page bound to editable content and owner sources, with scheduled promotions (approved original subsection)
Source: docs/designs/BATCH-V.md D-VC1 inventory and D-VC3 promotions (2026-10-08 amendment, authorized by the owner's request for complete website control). Prerequisite V-C2 merged (#487).
One coherent outcome: no visible marketing word, link, button or photo on a public page is hard-coded any more. Each is an editable website item, or comes from one named owner source (profile, prices, catalog, service area), or is a named exception; scheduled promotions exist; and a render test proves it for every page and variant.

## Frozen original complete acceptance
### V-C3
- Every visible marketing item on the shared header, footer and launch notice, the home page (opened and preparing-to-launch), pricing, contact (page and form words and messages), how it works, service area, launch (open and closed, page and form) and every city page, plus their page titles and search descriptions, is either an editable website item (words, link or picture) or declared as coming from one named owner source (business profile, price list, catalog, service area, launch settings) or as a named non-content exception; the legal pages are declared as coming from their legal-approval versions, not casual text.
- With nothing changed, each of those pages and variants shows exactly the same words, links and pictures it showed before this work, proved by comparing the saved visible text of every route and variant before and after.
- A runtime coverage test renders every route and variant with every editable text replaced by a unique marker and proves each editable item shows its marker and that no other visible words appear except declared owner-source facts and named exceptions; it does not rely on searching the code.
- Sentences may hold checked links written [words](/page) or [words](https://...) and named facts ({businessName}, {phone}, {email}, {city}, {graceDays} and similar) that are filled from their owner at render; an unknown fact name, a link to an unknown page or a non-https address is refused when saving and publishing; phone, email, address, hours, prices, fees and service area come only from their one owner source and a test proves the page text equals that source.
- Buttons and calls to action are link items (words plus a destination chosen from known pages, an https address, or the profile's phone or email); the header and footer navigation, accessibility and legal links keep their fixed destinations with editable words and cannot be removed; link words and destination are shown separately.
- The home page photo uses the website photo library picture with its description, decorative choice and focus point when one is set and the built-in photo otherwise; a draft picture is never shown to a visitor, and the draft preview shows it only to an active owner or admin.
- A site-wide banner and a home page featured slot each hold a promotion (title, text, optional picture and button, on or off, optional Colorado start and end), default off, shown or hidden on each page view from the stored times with no schedule job; an ended or not-yet-started promotion disappears without hiding any other content; the schedule is tested across the spring-forward and fall-back changes; a promotion linked to a priced offer is refused until a priced-offer source exists.
- Every public page, including service area and city pages, reads the draft or old-version preview content through the same request reader, so the owner's preview can show any page, while anonymous visitors only ever get live content.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "f92d1ace5b056776a2f8cb5ab94130a5de545621",
  "outcome": "Owners can change any marketing word, button, link, hero photo or promotion on the public site through stored website content, defaults reproduce today's pages exactly, facts stay single-sourced, and a runtime test proves coverage.",
  "integrationBoundary": "The site-content domain (registry additions in a new fields-public file, placeholders, inline links, typed request reader, promotion schedule), shared site components (rich text, call-to-action link, hero picture, promotion banner), the public layout, header, footer and every public page and its form components, plus tests and the saved before/after page text. No migration, no owner-editor screen (V-C4), no redesign.",
  "newEngineering": "About 250 registry items with plain labels and starting text equal to today's words; fact and link placeholders; inline link parser and checker; typed values for requests; call-to-action, picture and promotion components; schedule rules in Colorado time with spring-forward and fall-back tests; page-by-page rewiring; before/after and marker render tests; docs",
  "estimatedProductionLines": 2300,
  "relatedWorkDecision": "These are one subsection because the coverage proof only holds when every page is bound at once; binding some pages leaves hard-coded words that the same test would flag. The owner editor that exposes all of this is V-C4 and the template contract is V-C5.",
  "subsections": [
    {
      "id": "V-C3",
      "acceptance": [
        "Every visible marketing item on the shared header, footer and launch notice, the home page (opened and preparing-to-launch), pricing, contact (page and form words and messages), how it works, service area, launch (open and closed, page and form) and every city page, plus their page titles and search descriptions, is either an editable website item (words, link or picture) or declared as coming from one named owner source (business profile, price list, catalog, service area, launch settings) or as a named non-content exception; the legal pages are declared as coming from their legal-approval versions, not casual text.",
        "With nothing changed, each of those pages and variants shows exactly the same words, links and pictures it showed before this work, proved by comparing the saved visible text of every route and variant before and after.",
        "A runtime coverage test renders every route and variant with every editable text replaced by a unique marker and proves each editable item shows its marker and that no other visible words appear except declared owner-source facts and named exceptions; it does not rely on searching the code.",
        "Sentences may hold checked links written [words](/page) or [words](https://...) and named facts ({businessName}, {phone}, {email}, {city}, {graceDays} and similar) that are filled from their owner at render; an unknown fact name, a link to an unknown page or a non-https address is refused when saving and publishing; phone, email, address, hours, prices, fees and service area come only from their one owner source and a test proves the page text equals that source.",
        "Buttons and calls to action are link items (words plus a destination chosen from known pages, an https address, or the profile's phone or email); the header and footer navigation, accessibility and legal links keep their fixed destinations with editable words and cannot be removed; link words and destination are shown separately.",
        "The home page photo uses the website photo library picture with its description, decorative choice and focus point when one is set and the built-in photo otherwise; a draft picture is never shown to a visitor, and the draft preview shows it only to an active owner or admin.",
        "A site-wide banner and a home page featured slot each hold a promotion (title, text, optional picture and button, on or off, optional Colorado start and end), default off, shown or hidden on each page view from the stored times with no schedule job; an ended or not-yet-started promotion disappears without hiding any other content; the schedule is tested across the spring-forward and fall-back changes; a promotion linked to a priced offer is refused until a priced-offer source exists.",
        "Every public page, including service area and city pages, reads the draft or old-version preview content through the same request reader, so the owner's preview can show any page, while anonymous visitors only ever get live content."
      ],
      "remainingEngineering": [
        "Registry items, facts and inline links, promotion rules, request reader, shared components, header/footer/layout and every public page and form rewired, before/after and marker tests, docs"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Gates and exclusions
No Stripe LIVE, customer email, SMS, spending or production storage. No paid ads, no third-party tracking. No migration and no new dependency. Legal page bodies (privacy, terms, accessibility) stay tied to their legal-approval versions and are not made casual edit boxes; their chrome (header, footer) is bound. Prices, fees, phone, email, address, hours and service area stay owned by Settings and the price list. The owner editor for these items, publish concurrency and restore-to-draft are V-C4; the template contract and CI coverage wiring are V-C5; the visual redesign is V-1 to V-4.
