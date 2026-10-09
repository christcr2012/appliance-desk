# Design — Batch V: "Evergreen Signature" visual redesign (public site first, then desk and portal polish)

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-06: "I love all of this! Update the repo!"). Run the drift check in section 0 before starting.
Written 2026-10-06 by Claude Opus 5.5 against `main` 0a52c98 (after E2-8). Answers the deferred item in
`docs/ROADMAP.md` ("Deferred public-site visual redesign follow-up": Chris judged E2's public site "too similar to the
previous site"). Visual reference: the published concept **Evergreen Signature**
(https://claude.ai/artifact/FQiYP2YvfGBP5QfZw66U3J — private to Chris) and its copy in
`docs/design-mockups/signature-2026-10-06/` (layout and feel only; every price, name and number there is an example).

**Who this is written for.** An implementing model (for example Sol 5.6) following it literally. Batch E2 already built
the shared components (`src/components/ui/*`) and the token layer; V **restyles and recomposes on top of them**. It is
not a rewrite and not a rollback.

**What does not change:** routes, permissions, queries, money, statuses, published-content controls, SEO metadata
behaviour, prelaunch/live switching, provider and payment safety gates, accessibility requirements. The only new
behaviour is the hero address check (V-6), which is a small, separately tested public action.

---

## 0. Verify before starting

| # | Fact | How to check |
|---|---|---|
| V-A1 | E2 is merged; `src/components/ui/` has `app-shell, attention-list, bottom-tab-bar, button, card, data-list, form-controls, page-header, stat-card, status-pill, visit-row`; public shell is `src/components/site/{header,footer,container,button-link}.tsx`. | `ls` |
| V-A2 | Tokens live in `src/app/globals.css` `:root` / `.dark` and `@theme inline`; the lint guard forbids hex colours, arbitrary bracket values and `rounded-(sm…3xl)` in components. | read; `npm run lint` |
| V-A3 | Home page copy keys exist for hero heading/body, prelaunch heading/body, household, property manager, FAQ 1–8 and How-it-works steps (`src/domains/site-content/fields.ts`), but the home page also **hard-codes** marketing text: the three benefit cards ("No long-term contract", "Delivered & installed … haul away your old unit", "We fix it, fast"), the step list on the home page, "Chris personally reviews every request", the pricing intro ("never changes for you once you sign"). | read `src/app/(public)/page.tsx` |
| V-A4 | `BusinessSettings.serviceAreaZips` / `serviceAreaCities` are the owner's service-area definition (`parseServiceArea`). | grep |
| V-A5 | Dark-mode `--color-success` (#1e6b3e) and `--color-danger` (#a3271f) have **no** `.dark` override (contrast 2.2:1 and 2.0:1 on the dark surface). If Batch G already fixed this, skip V-2's first bullet. | read `globals.css` `.dark` block |
| V-A6 | Public pages are covered by the generated accessibility route specs (`e2e/accessibility-routes-public.spec.ts`, `e2e/accessibility-dark-mode.spec.ts`). | ls |

## 1. Design direction (decided)

**V-D1 Keep the brand exactly.** Colours stay the kit's: evergreen #123C2D, fresh #B9E66B, ivory #F7F5EC, ink #17251E,
sage #DCE7DF, muted #4E6658, night #0C1E16 (dark surface #152E22). One typeface: Manrope (kit rule). Radii 8 / 16. Premium
comes from *how* they are used: bigger, tighter type; more space; fewer, stronger elements; one signature shape.

**V-D2 The signature shape: the Split-R cut.** The logo mark is an R with a 45° diagonal cut. That cut becomes the
recurring motif: (a) photo frames lose their bottom-left corner at 45°; (b) primary buttons get a small 12px cut on the
bottom-right corner; (c) the featured price card and evergreen bands have a 28–48px cut corner; (d) list bullets are
small 45° triangles. Implement once as utilities (`.cut-corner-sm`, `.cut-corner-md`, `.cut-corner-photo`, `.cut-band`)
using `clip-path: polygon(...)`. Focus rings must stay fully visible: put the focus outline on a wrapper or use
`outline-offset` on an element without the clip (test it — section 4).

**V-D3 Hairline ledgers instead of card grids.** Benefit rows, included-services and fact lists become full-width rows
separated by hairlines (`--color-line` mixed toward the canvas), not identical boxed cards. Cards are kept only for
things that are objects (a price, a visit, a bill).

**V-D4 Type scale (add to tokens; nothing else may set font sizes for these roles).**
`--text-display: clamp(2.5rem, 5.6vw, 4.6rem)` weight 800, line-height .98, letter-spacing −0.045em;
`--text-h2: clamp(2rem, 3.6vw, 3rem)` 800 / 1.02 / −0.035em; `--text-h3: 1.25rem` 800 / −0.015em;
`--text-lede: 1.1875rem`; `--text-eyebrow: .75rem` 700 uppercase +0.12em; money uses `font-variant-numeric: tabular-nums`
and `--text-price: 2.75rem` 800 −0.045em. Headings use `text-wrap: balance`.

**V-D5 One highlight per page.** The fresh-green "highlighter" (a band behind the lower 30% of the text) marks **one**
phrase in the hero. Fresh is **never** used as text or as a thin line on ivory (contrast 1.3:1); on ivory it appears only
as a filled shape with evergreen text on it.

**V-D6 Depth.** Two shadow tokens only, tinted toward evergreen: `--shadow-raise` (floating price ticket, address
field, segmented controls) and none elsewhere. Dark mode replaces the tint with black at 70% opacity.

**V-D7 Motion.** One moment: on the home page the hero headline and photo fade/slide in 12px over 320ms on first paint
(content is visible at rest; animation only enhances). Buttons lift 1px on hover. Everything is disabled under
`prefers-reduced-motion`. No scroll-triggered animations.

**V-D8 Copy moves into settings.** Every marketing sentence on the public pages becomes a site-content field (V-3), so
Chris can change it and nothing unverified ("haul away your old unit", "fast") is promised in code.

## 2. Token changes (`src/app/globals.css`, additive)

- V-2a **Accessibility fix (if not already done by Batch G):** `.dark { --color-success: #7fd39a; --color-danger: #ff9b8f; }`
  (8.1:1 and 7.2:1 on #152E22). Add a unit test `tests/theme-contrast.test.ts` that parses the token blocks and asserts
  every text/background pair listed in section 4 meets 4.5:1 (3:1 for large text and UI shapes).
- V-2b Type tokens from V-D4, exposed through `@theme inline` as `text-display`, `text-h2`, `text-h3`, `text-lede`,
  `text-eyebrow`, `text-price`.
- V-2c `--color-hairline: color-mix(in srgb, var(--color-line-strong) 55%, var(--color-canvas))` and
  `--color-tint: color-mix(in srgb, var(--color-canvas-alt) 60%, var(--color-canvas))` (dark: computed from the dark
  values the same way). Use `in srgb` (oklch mixing produced a visible pink cast in testing).
- V-2d `--shadow-raise` (light: `0 1px 0 rgb(18 60 45 / .06), 0 18px 40px -22px rgb(18 60 45 / .35)`; dark:
  `0 18px 40px -24px rgb(0 0 0 / .7)`). The lint guard allows `rgb(` **only** inside `globals.css`.
- V-2e Cut utilities from V-D2 in `@layer utilities`.

## 3. Work units

> PR boundaries below are superseded by `docs/MASTER-ROADMAP.md` section 7 (smaller PRs, same work units and order).

**PR V-1 (foundation + home):** V-2 tokens; V-3 content fields; V-4 home page; V-6 address check.
**PR V-2 (rest of public site):** V-5 pricing, how it works, service area, rent/[city], contact, launch, legal pages.
**PR V-3 (desk and portal polish):** V-7 Today and shells. **PR V-4:** V-8 docs and screenshots.

### V-3 Site-content fields (in `src/domains/site-content/fields.ts`, same pattern as existing fields)

Add, each with label, plain help text and today's wording as the default (so nothing changes until Chris edits):
`home.hero.eyebrow` ("Now renting"), `home.hero.highlight` (the phrase to highlight; must be a substring of the
heading or it is ignored), `home.included.{1..4}.title/body` (defaults: Delivered / Installed / Repairs included / Easy to
end, with neutral bodies that promise nothing the business has not confirmed), `home.pricing.heading`,
`home.pricing.body`, `home.how.heading`, `home.pm.heading`, `home.pm.body`, `home.pm.facts.{1..4}.title/body`,
`home.faq.heading`. Remove the hard-coded strings listed in V-A3 from the page. The website editor (Batch D) shows the
new fields automatically from `SITE_FIELDS`; verify its draft preview renders them.

### V-4 Home page composition (both prelaunch and live variants keep their existing logic)

Top to bottom, matching the concept: header (logo, quiet links, one primary "Check your address" button) → hero
(eyebrow pill with the first service-area city from settings; display heading with one highlighted phrase; lede;
**address check field** (V-6) as the dominant action; secondary link "See prices"; photo in a `.cut-corner-photo` frame
over a tinted offset panel; floating price ticket built from the published set price if one exists, else omitted) →
included-services ledger (4 columns → 2 → 1) with the kit's service icons → pricing (term switch from the existing
prepay-discount settings; three price cards, the set card featured on evergreen) → how it works (numbered real sequence,
dashed connector on desktop) → property-manager band (evergreen in light, dark surface in dark, cut top-left corner) →
FAQ in two columns (`<details>`) → night footer. Prelaunch mode: same composition, the address check is replaced by the
launch-list call to action, and prices are hidden exactly as today.

### V-5 Other public pages
Same header/footer, same type scale, ledgers instead of card grids, price cards reused from V-4 on `/pricing`, the
`/rent/[city]` landing pages reuse the home hero with the city name. No layout may introduce horizontal scroll at 360px.

### V-6 Hero address check (the one behaviour addition)
`checkServiceAddress(input: { line1: string; zip: string })` server action in `src/app/(public)/check-address-actions.ts`
calling a pure `src/domains/site-content/service-area-check.ts` → `{ status: "SERVED" | "NOT_YET" | "INVALID", city? }`
using **only** `serviceAreaZips`/`serviceAreaCities` from settings (no external calls). Public rate limit through the
existing durable limiter (`src/lib/rate-limit.ts`, same key shape as the lead form). `SERVED` → message "We serve
<zip>. Next: tell us what you need." and a link to the lead form with the address pre-filled (query params, never stored
before the visitor submits). `NOT_YET` → "We don't deliver to <zip> yet" + launch-list link. No address is logged or
stored by the check. Wording is site-content (`home.check.*`). Tests: `tests/service-area-check.test.ts` (pure: zip
match, city fallback, whitespace, invalid), `tests/check-address-action.test.ts` (rate limit, no persistence). After
Batch T ships, the check may also show "Tax for your address is calculated when we confirm details" — not in V.

### V-7 Desk and portal polish (no behaviour change)
- Today: the headline `StatCard` gets the cut corner; add the **day timeline** (`src/components/ui/day-timeline.tsx`):
  visits from the data Today already loads, placed by scheduled time on an 8 am–7 pm axis, each block with type icon and
  word, status in words (Done / Next / time), a "Now" marker; on phones it degrades to the existing `VisitRow` list.
  Attention items get a severity stripe **and** a severity word (Urgent / Today / Soon) from the existing exception
  severity. Money tiles show an "Actual" / "Estimate" tag taken from the `METRICS` registry `kind`.
- Sidebar: add a "Search or jump to… ⌘K" trigger that opens the existing global search (no new search backend).
- Portal home: the four existing questions as cards in order; "Report a problem" card on evergreen with the fresh button.
- Tables keep `DataList`; numbers right-aligned with tabular figures.

### V-8 Docs and evidence
Update `docs/DESIGN-SYSTEM.md` (signature cut, type scale, ledger rule, highlight rule, shadow rule),
`docs/OWNER-GUIDE.md` (new editable home-page fields), screenshots at 360/768/1440 light and dark attached to each PR,
`docs/ROADMAP.md` (close the deferred visual item once Chris accepts), `CHANGES-SINCE-DESIGN.md`.

## 4. Acceptance and checks

- [ ] Chris compares before/after screenshots and says the public site now looks clearly different and premium (human
      gate — merge waits for it, exactly like #262's comparison).
- [ ] No hard-coded marketing copy remains on public pages (grep test `tests/public-copy-from-settings.test.ts` scans
      `src/app/(public)/**/*.tsx` for the strings listed in V-A3).
- [ ] Contrast test (V-2a) passes for: ink/ivory, muted/ivory, muted/white, evergreen-on-fresh, white-on-evergreen,
      ivory/night, dark muted/dark surface, dark success/danger/warning on dark surface, button text on both buttons.
- [ ] Axe clean on every public route in light and dark (existing generated specs) and on Today/portal home.
- [ ] Keyboard: every clipped element shows a complete focus ring (browser spec `e2e/signature-focus.spec.ts`, assign a
      shard: tab through header, address check, term switch, price buttons; screenshot-compare the focus ring box).
- [ ] 360px: no horizontal scroll on any public route (existing route inventory + one assertion per page).
- [ ] Reduced motion: no animation (spec emulates `prefers-reduced-motion`).
- [ ] Lighthouse-style budget recorded in `docs/PERF-BASELINE.md`: home LCP image is the hero photo with `priority`,
      no layout shift from the price ticket (reserve its space).
- [ ] Every item in PLAN.md "Rules that apply to every batch".

## 5. Stop-and-ask

- **S-V1** A screen would need data the page does not already load (other than V-6).
- **S-V2** A clip-path cannot be combined with a visible focus ring on some component.
- **S-V3** Chris rejects the concept direction after the first PR's screenshots — stop; do not iterate blindly.
- **S-V4** The website editor cannot show a new field without a schema change.
## 2026-10-08 amendment — complete owner content control and redesign compatibility

Owner request: edit any website text, photo or content link from Appliance Desk;
keep content editing simple and keep future redesigns compatible. This is an
extension of the built Batch D editor, delivered within V before final F proof.
It adds content controls without giving the editor control over page structure,
CSS, scripts or transaction behavior. The design is authorized by this request;
legal wording, live activation and money-policy gates still apply.

### V-C0 — current-code reconciliation and scope

Verified: `site-content/{fields,index,request}.ts` implements whitelisted string
fields, one locked published pointer, stale-draft checks, authenticated revision
preview and restore-as-new-version. `/desk/settings/website` groups fields by
page/section. `settings/index.ts` owns business profile, prices and catalog photo
URLs. `components/site/{header,footer,nav-links}.ts[x]` and public pages still
contain visible literals; hero `src` is static and editor thumbnails are static.
Empty string currently means fallback, so intentional clearing is unsupported.
Upload namespace `appliance-types` is public and disabled outside Production;
operational evidence uses isolated private storage. Never borrow customer photos
or production upload credentials for a website draft or preview.

The exact inventory is an implementation deliverable, not a claim this static
inspection found every literal. Cover public layout/header/footer, home live and
prelaunch, pricing/catalog, contact and launch forms, how-it-works, service-area,
city pages, accessibility/privacy/terms and their metadata/error/success states.
Every rendered content item gets a stable field/source binding or a documented
non-content exception (e.g. generated date, loading state). No visible marketing
copy/photo/link may disappear from owner control during a redesign.

### D-VC1 — one typed content registry and explicit source ownership

Extend `SiteField` in `site-content/fields.ts`, not a competing CMS. Each
manifest entry defines stable `key`, plain label/help, page/section, route and
location description, kind, default, required/optional, length/collection limits,
allowed placeholders, preview anchor and source ownership. Page/section grouping
is editor metadata, not the layout definition. Stable keys name meaning, not
positions such as `hero.leftColumn`. Keep existing keys via compatibility mapping.

Define new discriminated values in `site-content/types.ts`:
`SiteValue = TextValue | LinkValue | ImageValue | ItemsValue | PromotionValue | HiddenValue`.
Text has `{kind:'text',text:string}`; a link has
`{kind:'link',label:string,target:SiteLinkTarget}`; image has
`{kind:'image',assetId:string,alt:string,decorative:boolean,focalX:number,focalY:number}`;
items have `{kind:'items',items:{id:string,values:Record<string,SiteValue>}[]}`
with one allowed nesting level; promotion has
`{kind:'promotion',title:string,body:string,image?:ImageValue,cta?:LinkValue,
enabled:boolean,startsAtUtc?:string,endsAtUtc?:string,offerVersionId?:string}`.
Validate ISO UTC instants, end after start, and offer existence/readiness before
publication; owner time entry/preview uses America/Denver. Hidden has `{kind:'hidden'}` only for explicitly
optional content. Coordinates are integers 0..100. Lists edit content within
existing slots (FAQ, benefit descriptions, gallery/ad slots); order within such a
list is content, but adding/reordering page sections is a redesign.

`SiteLinkTarget` is an explicit union: internal known route + permitted anchor;
HTTPS external URL; telephone/email bound to verified profile sources. Parse
URLs, reject credentials/protocol-relative/script/data URLs and invalid schemes;
external links receive safe rel attributes. No server fetch of an arbitrary link
for previews. Telephone/email editors reuse profile validation. Plain text and
bounded paragraph formatting only; no raw HTML or third-party embed/script input.

Add `SiteContentRevision.contentSchemaVersion Int @default(1)` and
`templateVersion String?`. Existing Json `fields` stays; version 1 decodes old
string fields, version 2 stores typed values. `decodeContentRevision()` handles
both explicitly and rejects invalid known values. Never rewrite signed customer
artifacts or historical revisions. Missing = manifest default; explicit empty
text is distinct and permitted only when optional; hidden is explicit. Unknown
retired keys are preserved in immutable history but not rendered; publishing
rejects new unknown keys rather than silently stripping them.

Shared business facts use `source:{domain:'profile'|'pricing'|'catalog'|'policy',key}`
and link to their existing owner edit screen within the Website workspace.
Phone, email, address, hours, zones and prices have one source. Show “Used on the
website and in quotes” and effective-date/customer impact before changing a real
price. Website publish does not publish a price change. Price previews use the
normal pricing resolver and label current vs future effective facts; cosmetic
caption editing cannot alter charged amounts. Signed agreement prices/terms stay
unchanged. Template-based promises must agree with the selected business policy;
free marketing prose can be edited, with a plain warning for claim-sensitive
fields and existing legal/owner gates, not an unprovable automated legal check.

### D-VC2 — website photo library with a separate public-intent boundary

One additive migration in V-C2 owns `WebsiteAsset` and
`WebsiteAssetState { DRAFT PUBLIC RETIRED }`. Fields: `id String @id @default(cuid())`,
`storageKey String @unique`, `state WebsiteAssetState @default(DRAFT)`,
`sha256 String`, `mimeType String`, `width Int`, `height Int`, `byteSize Int`,
`createdByUserId String`, `createdAt DateTime @default(now())`,
`publishedAt DateTime?`, `retiredAt DateTime?`; index `[state,createdAt,id]`.
Asset IDs resolve only in this dedicated namespace. Immutable image bytes get
server-generated object paths, never client-supplied arbitrary storage paths.
Use the existing private-storage selector and isolated preview guard; public
website imagery has explicit publication intent, never a customer/receipt/job
Photo reference. If configured storage is unavailable show a manual prerequisite;
no provider purchase or production fallback. Built-in assets remain selectable.

Authenticated upload decodes JPEG/PNG/WebP, verifies file content, caps input at
10 MB and 24 megapixels, strips metadata and re-encodes a deterministic WebP.
Use available image processing dependency after current-code inspection; a new
library needs a justified card amendment. Owner sees progress/error, thumbnail,
alt text and focal-point crop preview. No SVG/HTML or arbitrary remote import.
Existing built-in SVG logos may remain trusted static choices. The original
upload filename is not a public URL; do not expose storage tokens or private
signed URLs. UI offers uploads from phone/gallery and reuse from website library.

`/api/site-media/[assetId]` serves only PUBLIC website assets with verified content
type, `nosniff`, immutable byte identity and no token; draft media uses a separate
active OWNER/ADMIN authenticated, no-store preview route. The first publish marks
only validated referenced DRAFT assets PUBLIC in the pointer transaction after
upload/rendition readiness. Draft uploads stay inaccessible to anonymous viewers
until then. Publication is irreversible exposure of approved bytes; unpublishing
cannot promise removal from caches. Retire prevents new selection; never delete
media required by retained/restorable website revisions. Garbage-collect only
unreferenced stale DRAFT uploads through a bounded documented maintenance path.

Catalog photos remain sourced from the catalog's existing setter. Extend that
setter's domain actor/URL validation and transaction/audit safety where current
inspection requires; do not rely on a hidden form as authorization. Website
library assets may be selected into catalog after PUBLIC approval. Show that a
catalog photo edit has its own source save and affects all pages using that item.

### D-VC3 — publication, promotions and safe restoration

Reuse `saveDraft`, `publishDraft`, `restoreRevision`, pointer lock and audit;
refactor through typed codecs/validators rather than adding a second pointer.
`publishDraft(actorId,id,expectedVersion,expectedPublishedRevisionId)` validates
all referenced assets, links, required content and current template compatibility
inside the transaction. Compare the live pointer as well as draft revision;
stale screens cannot publish over another editor's changes. Extend old callers
in the same card; no new optional argument that silently skips concurrency checks.
Repeated publication of the same revision has a truthful idempotent result;
distinct stale revisions conflict. Invalidation/cache refresh is retryable after
commit, and its failure cannot falsely report rollback or duplicate publication.

Advertisements/promotions use supported content slots with image, title, body,
CTA, visible/off and optional start/end Colorado times. Resolve schedules on
request using shared business-time helpers; no new cron just to hide a banner.
Default off; marketing-only content never invents a discount. A priced offer
links the BP/pricing version and cannot become active until that offer is ready.
No paid ad purchase or third-party tracking injection. Preview permits a labeled
future date so the owner sees the scheduled result. Show “Starts ... / ends ... /
visible now” and test Denver DST edges. One expired ad must not hide unrelated
content. Required site navigation/accessibility/legal links cannot be removed;
labels and copy remain editable through their supported content controls.

Restore becomes **restore to draft → compare/preview → publish**, preserving the
old immutable revision and recording `restoredFromId`. It restores website-owned
content only; clearly lists profile/pricing/catalog facts outside that revision.
Missing assets or incompatible older schema block publishing with field-level
fix instructions; never silently drop text/photos. Undo one field is a draft edit
with revision conflict checks. “Use recommended text” previews a default before
saving; not the same action as clearing/hiding an optional field.

### D-VC4 — plain owner experience at /desk/settings/website

Add a clearly labeled **Website** destination to owner/admin navigation, keeping
the existing route. Entry shows site state, live version/time, draft changes and
four tasks: Edit a page; Photos; Contact & prices; Review & publish. Page list
uses familiar names and thumbnail/location references. Search finds a phrase or
field label without displaying a wall of inputs. Optional quick tour is
skippable, and contextual help explains each field without developer terms.

On desktop: page/section list, real rendered preview and selected field panel.
On phones: Page → Section → Edit; switch between Edit and Preview rather than a
cramped three-column screen. “Select this content to edit” is available inside
an authenticated same-origin preview, with a matching keyboard-accessible list.
Preview selection message validates origin, revision and known field key. Public
render has no edit markers, owner data or editable endpoints. Selected field
shows: **where it appears**, current live value/image, proposed value, related
locations sharing it, and when the change takes effect. Link fields show label
and destination separately. Prices display the source/impact shortcut.

Sticky action area says **Save draft**, **Preview**, **Review N changes**; it must
never suggest Save means Published. Show Saving/Saved/error honestly. Preserve
unsaved form values on failure; prompt before leaving a dirty form. Background
save is optional only after stale-version correctness is proved. Publish review
shows plain before/after text, photo thumbnails/crop and link destinations,
source edits outside the draft, validation problems and affected pages.
“Publish website changes” changes only the reviewed draft, and success links to
the live pages. Long text wraps, keyboard focus and error summaries work, photos
have descriptive alt or an intentional decorative choice, and controls remain
usable at 360/768/1440 widths in both themes. Do not require technical vocabulary,
CSS, a filename or a URL to replace a photo.

### D-VC5 — every future redesign must preserve this contract

A template declares `templateVersion`, supported content keys/kinds and bounded
slot capabilities in `site-content/template-contract.ts`. A redesign includes a
mapping from old stable keys to new locations, keeps unmapped values in history,
and reports keys retired, renamed or newly required. Expand the registry/editor
and codec first when new content types are necessary; never ship the redesign
with new hardcoded owner content. Defaults apply only to new/unset fields, never
overwrite the owner's customized live text/photos. Compatibility transforms are
pure, versioned and tested on both customized and untouched historical revisions.
Do not apply schema transforms by mutating a published Json row.

If template N cannot render content version N-1, block that deployment until a
compatible release or deliberate content migration exists. Code rollback must
be able to render the last published content version; otherwise the release's
rollback plan first restores a compatible content draft/pointer with owner proof.
Maintain a small fixture for each supported historical schema version. Test
missing/retired/new field behavior; add one shared CI content coverage check:
every declared public slot and link/image is either registry-owned, bound to a
single domain source, or explicitly non-content. Runtime route/DOM coverage is
needed; regex searching JSX literals alone cannot prove complete coverage.
Each public redesign PR inherits these acceptance requirements and the owner
rendered visual acceptance gate. No separate CMS, service bill or layout builder.

### Delivery ownership and high-value acceptance

| Unit | Contract | Proof |
|---|---|---|
| V-C1 | Typed registry/codec, revision metadata, baseline compatibility | old strings/new values, intentional empty/default/hidden, unknown keys, populated-upgrade/backup |
| V-C2 | Website image library and private draft/public serving boundary | anonymous draft denial, active-role checks, cross-namespace denial, forged format/size, EXIF removal, referenced-asset restore |
| V-C3 | Complete public binding and promotion lifecycle | all routes/variants/header/footer/forms/metadata mapped; source prices/contact equal domain facts; expired/DST ad |
| V-C4 | Editor workflow and publication/restore safety | edit/select/preview phone and keyboard, stale save/publish, duplicate submit, photo/link diffs, error preservation, axe |
| V-C5 | Redesign compatibility and end-to-end content proof | customized content survives new template and rollback; every public content slot owned; no anonymous draft data |

Order: COM-L15 → V-C1 → V-C2 → V-C3 → V-C4 → V-C5 → existing V-1…V-4.
These are coherent planning boundaries, not five mandatory tiny PRs. V-C1 owns
revision schema; V-C2 owns asset schema. Existing V-1's marketing-field work now
reuses this registry and tests; do not implement it twice. V-C4 owns changed
publish/restore signatures, with V-C1 preserving old behavior until callers switch.
The implementer writes bounded execution cards at the actual predecessor head.
F-part-2 proves the final editor and resulting public content, not just defaults.

Design references: [W3C form validation](https://www.w3.org/WAI/tutorials/forms/validation/),
[W3C clear notifications](https://www.w3.org/WAI/tutorials/forms/notifications/),
[OWASP file uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html),
[WordPress preview pattern](https://wordpress.org/documentation/article/how-to-use-the-preview-function/).
These inform error/review/media patterns; they do not require adding WordPress.

### Implementation clarifications for typed content

V-C1 preserves current string-reader signatures through a versioned adapter until
V-C3 converts all public consumers to the typed resolver. Known type mismatches
are explicit errors, not `[object Object]` or silently hidden content. A server
`WebsiteContentContext` identifies revision, template and live/draft status;
header, footer, metadata and page body use the same revision per request. Active
actor verification is required for preview, and draft HTML/media are no-store.
Missing draft produces a clear preview error; do not silently show live content
under a draft label. New legal-page copy uses the existing legal publication/
acceptance gate and a versioned content hash; editable web legal copy must not
mutate an already signed customer agreement's terms snapshot.

## 2026-10-09 amendment — connected business (pending IN-69)

`BATCH-W-AMENDMENT-B.md` section 9 adds to Batch V: the plain-language kit (`<Money>`, `<MoneyInput>`, `<InfoTip>`,
status labels) on every screen; styling for the new W screens (Record a purchase, Tax proof, Audit pack, Rental
packages, Related/History, portal timelines and Pay now); phone-first acceptance for intake, visits, pickups and
inspections; and V-4 grows from polish to consistent Related/History/To do components. V still changes no routes,
permissions, money or statuses — those come from W.
