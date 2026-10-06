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
