# Robinson Appliance Rentals — complete implementation handoff for Claude

This is the consolidated handoff, including mandatory light and dark modes. It supersedes the earlier brief and separate theme addendum. Follow this document as a single specification.

## Assignment

Improve the existing Robinson Appliance Rentals website and Appliance Desk application. Implement this brief in the existing repository, preserving working business logic, accounts, records, integrations, and URLs. Deliver a cohesive brand, a conversion-focused public website, an efficient owner workspace, and a simple customer portal. Do not stop at mockups or cosmetic changes: connect the redesigned controls to real persisted behavior and verify the important workflows.

Work in a branch and staging environment. Inspect the current implementation before modifying it. Map every existing capability to its new location, use additive database migrations where possible, and provide a migration/rollback plan for material changes. Do not replace the stack merely to redesign the interface. Do not deploy or modify live customer records as part of review testing.

### Review basis and limits

This brief is based on a browser review on September 28, 2026, of the public homepage, quote form, authenticated owner dashboard, Jobs, Customers, and Settings at the correctly spelled domain, `www.robinsonappliancerentals.com`. The supplied address had a spelling error. No business records or settings were changed. This was a UI review, not a source-code or backend audit.

The customer account experience was not inspected: the owner account displayed no customers and no customer preview was available in the screens reviewed. Its redesign below is a proposed specification; inspect the existing customer implementation before changing it. Do not assume a capability is missing just because it was not visible in these screens.

## 1. Problems to resolve first

| Observed issue | Required improvement |
|---|---|
| Owner dashboard is a grid of 14 equally prominent counters, mostly zero | Replace it with a prioritized work queue and daily schedule. Retain secondary counts in relevant modules and reports. |
| Eleven owner navigation links form one undifferentiated list | Group navigation around daily work, rentals, assets, and business administration. Keep common destinations one click away. |
| Public hero uses a large serif headline, cream background, rust buttons, and a relatively small generic four-appliance image | Establish the brand system below; give the current washer/dryer offer and pricing stronger visual hierarchy. |
| Homepage emphasizes month-to-month, while the owner values longer commitments and bulk accounts | Present three distinct paths: household rentals, longer-term rentals, and property/portfolio rentals. |
| Public copy promises permanent pricing, easy changes of mind, rapid service, and old-unit haul-away | Replace unsupported promises with language driven by actual approved terms, services, and fees. |
| Quote form defaults to month-to-month and has one quantity for several selectable products | Require an explicit term choice and quantities per product or bundle. Add a clear property-manager path. |
| Settings mixes categories, URLs, fees, deposits, discounts, holds, and tax in one long form | Split settings into focused screens with clear save scope, validation, and change previews. |
| Settings describes a “set” as two or more appliances on one line and mixes lease length with prepayment | Model explicit bundles, lease commitment, billing cadence, and promotions separately. Audit existing calculations before migration. |
| Customers page requires conversion from a lead and displays a raw internal route in the empty state | Support direct owner-created customers and replace internal route text with useful actions and plain-language guidance. |

Preserve useful work already present: extensible appliance categories, category visibility, published prices, separate fees, custom agreement workflows, inventory holds, activity logging, and manual job scheduling. Verify their backend behavior rather than rebuilding them blindly.

## 2. Brand identity

**Public name:** Robinson Appliance Rentals. Use the complete legal name, Robinson Appliance Rentals LLC, in agreements, invoices, legal notices, and the footer. Keep “Appliance Desk” as the owner software name, shown beneath or beside the Robinson identity. Customers should see “Your account,” not internal software terminology.

**Positioning:** Dependable local appliance rentals for Greeley households and rental properties. Straightforward costs, helpful people, and practical service.

**Tagline:** “Everyday appliances. Local people.”

**Personality:** Capable, approachable, orderly, and transparent. Avoid luxury showroom styling, bargain-bin graphics, startup jargon, and language that assumes customers are in financial distress.

### Logo system

Create a custom vector wordmark: **Robinson** prominent, **APPLIANCE RENTALS** as a smaller descriptor. Pair it with a simple rounded appliance outline containing a restrained circular door/R motif. It must remain legible at favicon size and must not resemble an existing appliance manufacturer's logo. Do not use stock emoji as the mark.

Deliver horizontal and stacked lockups, standalone symbol, one-color dark, reversed white, SVG masters, transparent PNG exports, favicon assets, and social avatar. Keep the symbol broad enough for refrigerators and ranges later. Use a typographic fallback while the mark is being developed; do not block core implementation on artwork.

### Color tokens

| Token | Hex | Usage |
|---|---|---|
| Brand navy | `#17324D` | Wordmark, headers, primary text, owner navigation |
| Deep teal | `#006B66` | Primary buttons, selected controls, links |
| Teal hover | `#00534F` | Hover/pressed primary actions |
| Warm canvas | `#F7F8F5` | Public page background |
| App canvas | `#F3F5F7` | Owner/customer workspace background |
| Surface | `#FFFFFF` | Tables, forms, cards |
| Body ink | `#243746` | Body text |
| Secondary ink | `#526271` | Supporting text |
| Border | `#D7DFE5` | Dividers and field borders; strengthen where contrast requires |
| Amber accent | `#E8AE45` | Small highlights with navy text; never white body text |

Use separate semantic success, warning, danger, and information tokens. Status must include text and/or an icon, never color alone. Test contrast across every state. Complete light and dark modes are required for the public website, owner workspace, and customer portal.

### Required light/dark theme system

Implement coordinated themes using semantic CSS variables/design tokens. Do not invert the page or hard-code component colors. Navy and teal remain the brand anchors, with brighter teal actions and links in dark mode.

| Semantic role | Light mode | Dark mode |
|---|---|---|
| Page background | `#F7F8F5` | `#0D1722` |
| Application background | `#F3F5F7` | `#0D1722` |
| Card/form surface | `#FFFFFF` | `#152332` |
| Elevated surface | `#FFFFFF` | `#1D3042` |
| Primary text | `#243746` | `#F1F5F8` |
| Secondary text | `#526271` | `#B2C0CD` |
| Decorative border | `#D7DFE5` | `#35495B` |
| Primary button | `#006B66` | `#69D5CA` |
| Primary button text | `#FFFFFF` | `#0D1722` |
| Primary hover | `#00534F` | `#80E0D6` |
| Link/focus accent | `#006B66` | `#80E0D6` |
| Amber accent | `#E8AE45` | `#F0BD60` |

These are starting tokens, not a claim of verified accessibility. Check contrast for the actual foreground/background combinations and adjust as necessary. Decorative borders need not serve as input boundaries: define stronger control-border tokens where required. Use separate interaction and semantic-status tokens for success, warning, danger, information, selected, hover, pressed, focus, and disabled states. Make focus rings visible on both primary buttons and surrounding surfaces, using an offset or two-color treatment when needed.

**Theme preference and rendering**

- Offer **Light / Dark / System**, defaulting to System until the user chooses otherwise.
- Keep the control accessible in the public menu and both portal headers/account menus. Use text labels or a labeled selector; an unexplained moon icon alone is insufficient.
- Remember anonymous preferences across visits. Persist a signed-in user's explicit preference to their account for use across devices. Define deterministic precedence: saved signed-in choice, otherwise local explicit choice, otherwise System. Account preference updates should synchronize the current device.
- Apply the initial theme before visible rendering to prevent a bright flash, respecting the framework's hydration and content-security-policy requirements. Use the corresponding browser color-scheme for native controls.
- Follow operating-system theme changes only while System is selected. Explicit Light or Dark choices must remain stable.
- If persistence fails, preserve the current selection and show a recoverable message where appropriate. Theme failures must not break sign-in, billing, or form submission.

**Brand and imagery**

Use the navy logo on light surfaces and white/soft-teal variants on dark surfaces. Supply transparent SVG/PNG variants. Keep original photo colors: do not invert appliance photos or apply global darkening filters. Style their containers intentionally so white appliances remain natural. On dark pages, distinguish surfaces through subtle borders and tonal separation, avoiding excessive glow or heavy shadows.

**Complete component coverage**

Theme every table, form field, dropdown, date picker/calendar, drawer, dialog, toast, tooltip, chart, notification, skeleton, empty state, error, and authentication screen. Cover autofill, validation, selected rows, disabled controls, and file-upload previews. Charts require readable axes and labels plus non-color distinctions. Confirm third-party widgets/hosted payment pages support coordinated appearance where configurable; document provider-controlled limitations instead of promising exact theme continuity.

Keep printed agreements, invoices, and receipts on a white background with dark text, independent of screen mode. Verify print previews and generated PDFs. Review email templates separately because email clients apply their own dark-mode transformations; use robust logo treatments and test supported clients rather than assuming website CSS controls email rendering.

**Theme acceptance**

Verify public, owner, and customer screens in both modes at mobile and desktop sizes. Test fresh loading, refresh, navigation, sign-in/out, preference persistence, cross-device account preference, System changes, form errors, dialogs, keyboard focus, payment handoffs, and printing. Include screenshots of both modes in the final handoff. Dark mode is a completion requirement, not a later optional task.

### Typography, spacing, and components

Use **Manrope** for the wordmark treatment and public headings; **Inter** for body text and all application controls. Self-host appropriately licensed font files, limit weights, and supply system fallbacks. Public H1: approximately 52–60 px desktop, 34–40 px mobile; app page titles: 26–30 px; body: 16 px; compact desktop table text: 14 px. Use tabular numbers for prices and financial columns.

Use an 8 px spacing rhythm, 8–12 px corner radii, restrained shadows, and strong alignment. Reserve cards for meaningful groups rather than boxing every label. Buttons should be at least 44 px tall for touch use. Show visible keyboard focus, persistent field labels, inline validation, and useful loading, error, empty, and success states. Respect reduced-motion settings.

Build shared primitives for buttons, inputs, selects, badges, tables, tabs, drawers, dialogs, alerts, page headers, empty states, confirmation summaries, and currency/date display. Public, owner, and customer interfaces share these tokens but have different layouts.

### Photography and voice

Use bright, believable laundry-room photography showing basic appliances consistent with the actual offering. Prefer real inventory and installation photos with permission. Keep product crops and backgrounds consistent. Do not imply premium machines, stocked products, staff, or completed jobs that do not exist. Mark representative imagery appropriately. Do not put a range and refrigerator in the primary offer unless those categories are enabled.

Write short, direct copy: “Request a quote,” “View your next payment,” “Request a pickup.” Avoid “frictionless,” “revolutionary,” and exaggerated savings. Use consistent currency, dates, and formatted telephone numbers. Create matching email, invoice, agreement-cover, maintenance-update, and social-sharing templates. Supply a simple vehicle/signage and business-card layout specification using the same logo and colors, without fabricating contact details.

## 3. Public website

### Header and navigation

Desktop: logo; Rentals & Pricing; Property Managers; How It Works; Service Area; Customer Login; primary “Get a Quote.” Keep Owner Login in the footer and accessible from the shared sign-in flow. Enforce roles on the server; hiding owner links is not authorization.

Mobile: compact header and accessible menu. A small bottom “Get a Quote” / “Call” bar may be used on marketing pages if it does not cover content, forms, or cookie controls. Do not use the marketing header inside either portal.

### Homepage composition

1. **Hero:** two-column layout, generous but efficient spacing, large relevant washer/dryer photograph. Eyebrow: “Greeley & surrounding communities.” H1: **“Washer & dryer rentals for your home or property.”** Supporting text: “Rent individually from $35/month or together from $60/month. Tell us what you need—we’ll confirm availability, pricing, and delivery details.” Prices must come from enabled catalog records, not duplicated literals. Primary CTA “Get My Quote”; secondary “Rentals for Property Managers.”
2. **Compact price strip:** Washer $35/month; Dryer $35/month; Washer + Dryer Set $60/month. Show separate applicable charges and qualification notes near the offer. Do not imply tax or every service is included without configured support.
3. **Two customer paths:** “For your home” and “For your properties.” The second discusses multiple units, coordinated installations, and one account for several locations where supported.
4. **Rental term choices:** month-to-month, six months, twelve months. Explain commitment separately from how often payment is collected. Do not invent discounts or silently change existing ones.
5. **How it works:** Request → Owner confirms details → Agreement → Scheduled delivery. Explicitly say that quote requests do not reserve equipment or confirm delivery.
6. **Property-manager feature section:** several properties, one contact, tailored quotes, maintenance tracking. CTA preselects the business inquiry path.
7. **Local service section:** Greeley plus only configured, actually served communities. Include “Not sure whether we serve your address? Ask us.”
8. **FAQ:** availability, hookups, terms, fees, maintenance, moves, pickup, and model variation. Answers must match approved policies.
9. **Closing quote CTA and useful footer:** verified contact information, hours if configured, service area, customer login, owner login, and policies.

Do not invent testimonials, star ratings, installation counts, response-time guarantees, same-day delivery, unlimited replacements, or “no surprise fees.” Remove the current permanent-price promise unless the actual agreement policy supports it. Price changes must follow the signed agreement; marketing must not override it.

### Lead capture

Use a short three-step form with visible progress: **Needs → Location & timing → Contact & review**. Preserve input when moving backward. Do not require account creation.

- Start with “My home” or “Properties I manage.”
- Capture each appliance or bundle and its quantity independently; show “1 set = 1 washer + 1 dryer.” Do not double-count singles included in a set.
- Present explicit lease-term choices: month-to-month, six months, twelve months, “Not sure.” No silent default.
- Ask city/ZIP and desired start window first. Request the full service address only where needed for a useful quote; bulk inquiries may span several properties.
- Property branch: company, role, units needed now, number of locations, optional future demand, staggered delivery needs, and preferred contact method.
- Contact: name and at least one usable contact channel, with conditional requirements. Do not collect payment cards, identity documents, or unnecessary sensitive data in a lead form.
- Show a final summary and distinguish a quote request from agreement acceptance. Keep any marketing consent separate from service contact and optional.
- Confirmation: “Request received. We’ll contact you to confirm availability and next steps.” Add a response window only if the owner has configured and can meet it.

Persist submissions server-side, prevent duplicate submits, add rate limiting/spam protection, and display recoverable errors. Track source/UTM information without placing personal information in analytics events.

**Internal prioritization:** bulk/property-manager opportunities first, then twelve-month, six-month, and month-to-month inquiries. Show reason labels such as “8 sets · Property manager” and “12-month interest.” Make weights editable, allow manual priority, and use inquiry age/desired start to avoid ignoring older leads. Keep commercial priority internal; it is a follow-up aid, not automatic approval or denial of service.

## 4. Owner workspace: redesign around work

### Application shell

Use a 232–248 px desktop sidebar and a compact top bar. Top bar: page title/breadcrumb, global search, actionable notifications, and “Create” menu. Search should find customers, property addresses, agreement numbers, and inventory identifiers without exposing unauthorized records.

Group sidebar navigation:

- **Daily work:** Overview, Leads, Schedule, Service requests.
- **Rentals:** Customers & properties, Agreements, Billing.
- **Assets:** Appliances, Parts & supplies.
- **Business:** Website & catalog, Reports & activity, Settings.

Keep all common destinations visible on desktop; do not hide them behind many accordion clicks. Use restrained icons plus text. Mobile owner navigation: Today, Leads, Schedule, More, with customer search readily available.

### Overview screen

Header: **“Today”**, local date, “Create job,” secondary “Add customer.” Use America/Denver for business scheduling and handle daylight-saving changes.

- One compact summary row: active rentals, available appliances, overdue balances, unhandled leads. Avoid revenue claims unless the underlying metric is well defined.
- Main column, approximately two-thirds width: **Needs attention**, followed by **Today’s schedule**. Render actual items with customer/property, reason, age/due date, status, and one clear next action.
- Side column: priority lead follow-ups and genuinely relevant operational notices.
- Separate “Upcoming” for jobs beyond today. Schedule rows show time window, job type, city/address, customer, assigned units, and status.
- Put detailed conversion/asset metrics in Reports. Make every count navigate to the exact matching filtered list; the existing “High-value new leads” link currently goes to the same NEW-status URL as ordinary new leads, so verify and correct its filtering.

At startup, show a useful checklist: business details, prices/fees, first appliance, first customer, first agreement, first job. Hide completed items and allow dismissal. No fabricated charts, sample revenue, or a screen full of zeros.

### Lists, details, and forms

Use searchable tables with saved filters, sorting, pagination, meaningful status labels, and a clear primary action. Mobile rows become readable summaries rather than compressed desktop tables. Keep financial columns aligned. Preserve filters and scroll position when returning from detail pages.

Customer detail is a central record with tabs: Overview, Properties, Rentals, Billing, Service, Documents, Activity. Include contacts, property/unit relationships, agreements, assigned appliances, upcoming jobs, and account history. Clearly separate internal notes from customer-visible messages. Support direct “Add customer,” not only lead conversion; account invitation is a separate explicit action.

For complex workflows use full pages with sections and a review step. Use drawers for quick viewing/small edits, not large agreements or dense schedules. Show unsaved-change warnings and precise save feedback. Confirm consequential actions with their billing/inventory/customer impact.

### Scheduling and service

Make Schedule support agenda, week, and list views. Jobs include delivery, installation, maintenance, swap, pickup, and other owner-defined types. Capture customer/property, agreement, appliances, date/time window, duration, assignee, access notes, and completion checklist.

**Manual dispatch remains the default.** Customers submit preferred windows; the owner creates/confirms jobs. Display Requested, Confirmed, In progress, Completed, and Cancelled distinctly. Warn about overlapping staff/equipment reservations. Completion should record outcome and actual inventory movements; a cancelled job must not imply a completed pickup.

Service requests connect to the customer, property, and appliance, with issue category, description, optional photos, urgency, visible updates, and related job. Do not promise a response time without configured operating policy.

## 5. Customer portal: simple, separate, task focused

Do not reuse the owner sidebar or metrics dashboard. Desktop navigation: Overview, My Rentals, Billing, Service & Pickup, Documents. Mobile: Home, Rentals, Billing, Help. Account/profile is accessible from the header. Use the same brand with a lighter layout and comfortable touch spacing.

The customer home answers, in order:

1. **What do I owe and when?** Show next amount, due date, payment status, and autopay state. “Manage billing” opens the actual configured payment flow.
2. **What am I renting?** Show appliances/bundles, property, monthly charge, term, and agreement link.
3. **What happens next?** Confirmed appointments and submitted requests with clear status.
4. **What can I do?** Request maintenance, request pickup, ask a question, download an agreement or receipt.

Use progressive disclosure for details. For property managers, add an “All properties” selector, address/unit filters, and clear per-property rental and charge breakdowns. Do not force ordinary households through portfolio controls.

Maintenance form: select appliance → describe issue/add optional photo → choose preferred availability → review/submit. Pickup form: select items/property → desired date/window → reason optional → show applicable agreement process → submit request. Include: **“Your requested date is not confirmed until we contact you.”** Submission must not automatically end the agreement, stop billing, release inventory, or impose a new charge. Confirmation shows next steps and a reference number.

Use the existing payment provider's secure hosted flow where available. Never simulate a successful payment or store raw card data. Clearly distinguish payment submitted, pending, failed, and settled. If payments are not connected, show an honest explanatory state and an available contact method.

Require server-side access checks for every customer record, invoice, photo, document, and action. A customer must never reach another customer's data by changing an ID. If owner “View as customer” is added, make it explicitly read-only, visibly labeled, and audited; financial actions still need the proper authenticated actor.

## 6. Pricing and inventory rules that must survive the redesign

Initial public base rates: washer $35/month, dryer $35/month, washer + dryer set $60/month. Preserve existing saved rates and promotions until deliberately changed; do not overwrite them with seed data.

- Categories are data-driven and owner-manageable. Add refrigerators, ranges, or other types without code changes. Separate draft, published, hidden, and retired states where useful.
- A catalog product is not a physical appliance. Track actual units with identifier/serial, type, model, condition, location, acquisition cost, repair history, and availability state as supported by the current system.
- A bundle explicitly lists its component types/quantities. Two refrigerators do not automatically become a washer/dryer set or receive a set discount.
- Keep lease term, billing frequency, and prepaid period as distinct fields. A twelve-month agreement paid monthly is different from twelve months prepaid.
- Owner can set catalog rates, per-agreement recurring rates, bulk rates, temporary promotions with start/end dates, and one-time credits. Show the resulting effective price before saving.
- Define adjustment precedence and stacking explicitly. Distinguish rate overrides from credits; never apply the same discount twice. Show a line-by-line calculation preview.
- Snapshot signed agreement pricing and terms. Catalog changes affect new quotes by default. Changes to active agreements use a dated amendment/change record and any required customer acceptance; do not rewrite historical invoices or silently reprice signed contracts.
- Temporary discounts automatically revert on the recorded date. One-time satisfaction credits do not permanently lower rent. Use integer minor currency units/decimal-safe arithmetic and deterministic rounding.
- Track deposits, fees, tax, rent, credits, and refunds separately. Display tax input as a human-readable percentage, not permille. Tax configuration needs appropriate business validation; this brief does not set legal/tax policy.
- A completed pickup moves a unit into returned/inspection status before it becomes available again. Reservations must prevent double allocation and expose stale holds for owner review.

If rent-to-own already exists, preserve it as a distinct agreement type with its own price/ownership ledger and reviewed disclosures; do not infer that ordinary rental payments earn ownership.

## 7. Owner control without a developer

Split the existing Settings page into Business profile, Pricing & promotions, Fees & billing rules, Scheduling, Notifications, Team/access, and Integrations. Move public content and catalog management into **Website & catalog**.

Provide manageable fields for logo/images, contact details, service areas, hours, homepage sections, FAQs, product descriptions, public visibility, SEO titles/descriptions, and approved policy content. Use an image upload/media picker with preview and alt text instead of requiring raw photo URLs. Preserve existing URLs during migration.

Provide draft/preview/publish for public content, audit history, validation, and rollback to a previous revision. Pricing changes get an impact summary identifying whether they affect only new quotes or require separate agreement changes. Use focused forms with one clear save action; do not scatter ambiguous Save buttons across a long settings table. Retiring a type hides future sale options but retains historical records.

Future customer ordering should have a separate feature flag, default OFF. Do not enable it just because the UI exists. Before activation require available/reserved inventory accounting, slot capacity, geographic constraints, lead times, blocked dates, concurrency protection, agreement/payment rules, notifications, and an owner override path. Keep public copy and CTAs aligned with the active operating mode.

## 8. SEO, accessibility, and performance

Use Greeley-specific, readable service content. Suggested homepage title: **“Washer & Dryer Rentals in Greeley, CO | Robinson”**. Give rentals/pricing, property managers, how-it-works, and service-area pages distinct titles, descriptions, headings, and useful content. Do not manufacture thin city pages or pretend there are offices in surrounding towns.

Serve indexable public content, maintain canonical URLs and redirects for changed routes, generate a sitemap containing public canonical pages, and keep private portals out of indexing. Authentication protects private data; robots directives do not replace it. Add accurate business/organization structured data that matches visible facts. Validate applicable required fields; do not fabricate a street address, opening hours, ratings, or availability to satisfy markup requirements. No ranking or rich-result guarantees.

Optimize responsive images, provide dimensions, lazy-load below-fold media, avoid lazy-loading the primary hero, minimize font weights/scripts, and test mobile loading. Target WCAG 2.2 AA in implementation and verification: keyboard navigation, meaningful labels, contrast, status announcements, usable zoom, dialog focus management, and understandable errors. Never label the site compliant without testing.

Reference Google’s official guidance during implementation:

- SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Local business structured data: https://developers.google.com/search/docs/appearance/structured-data/local-business
- Organization structured data: https://developers.google.com/search/docs/appearance/structured-data/organization
- Sitemaps: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap

## 9. Implementation order and acceptance criteria

Implement in reviewable stages, keeping the application runnable:

1. Audit routes, roles, data models, pricing rules, payment integrations, and existing capabilities. Document discrepancies; preserve production records. Establish shared semantic tokens/components for both required themes and preview representative screens in light and dark modes with staging data.
2. Replace owner shell/Overview and reorganize existing screens. Add direct customer entry, improve Schedule and customer records, and preserve all existing actions.
3. Implement the customer layout and real billing/service/pickup flows, using test accounts and test payments where available.
4. Rebuild public pages and lead capture, add website/catalog editing, and finish SEO/accessibility/performance work.
5. Verify the complete workflows below and present screenshots, test results, migrations, known limitations, and deployment/rollback instructions. Distinguish implemented, tested, and still unconnected features.

Acceptance checks:

- A household can request one washer, a set, or mixed items with correct quantities; a property manager can request several sets across properties. Leads persist once and show understandable internal priority.
- Owner can create a customer manually, configure a refrigerator category, publish/hide it, and quote it without code edits.
- $35 individual/$60 set pricing is correct. A bulk override, a dated promotional rate, and a one-time credit produce the expected invoice breakdown without changing prior signed agreements.
- Six/twelve-month commitments work with monthly billing independently of prepaid promotions. A set uses defined components, not arbitrary quantity inference.
- A requested appointment stays pending until owner confirmation. Conflicting reservations are prevented, and a pickup request does not itself terminate billing or release an appliance.
- Customer A cannot access Customer B's records/files by changing URLs or request IDs; customer roles cannot reach owner APIs.
- Payment retries/webhook replays do not duplicate charges or ledger entries. Test only through the provider's supported sandbox; never initiate live charges for verification.
- Every dashboard count/action opens the correct filtered destination. Empty, loading, failed-save, and offline/interrupted form states are usable.
- Public, owner, and customer workflows work in both light and dark modes at approximately 390 px mobile, 768 px tablet, and 1440 px desktop without clipped actions. Keyboard focus, status labels, and form errors are visible. Theme selection persists correctly, System follows OS changes, initial rendering does not flash the wrong background, and printing remains light.
- Public pricing, catalog visibility, metadata, imagery, emails, receipts, and agreements use the same business configuration and brand assets.
- Final handoff includes the brand asset folder, reusable design tokens, updated workflow documentation, screenshots of public/owner/customer screens in both themes, test evidence, and specific unresolved integrations. Do not claim completion for decorative controls that do not work.

**Success means:** the owner can open Appliance Desk and immediately know what to do next; a customer can understand their rental and handle routine requests from a phone; a property manager can see that Robinson can discuss a portfolio relationship; and the owner can update ordinary business content and pricing without asking an AI to edit code.
