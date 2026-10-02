# Package 7 Audit — Product Integration, UI Coverage & Brand Accessibility

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** Owner-requested extension after Packages 1–6  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 7 asks a different question from Packages 1–6:

> Does Appliance Desk behave like one coherent, owner-manageable product — with the frontend exposing and faithfully controlling the capabilities already present in the backend, with complete end-to-end workflow integration, and with Robinson Appliance Rentals' real Evergreen brand carried consistently across the public site, owner desk, customer portal, authentication, email and business documents without sacrificing accessibility?

The answer is **not yet**, although the system has a much stronger foundation than the current UI consistency suggests.

The backend is materially richer than the owner-facing controls in several places. `SiteContent` exists as an editable-content model and is backed up, but there is no real website-content editor/publish surface on current `main`. `BusinessSettings.inspectionChecklist` actively changes the returned-appliance inspection workflow and is documented as owner-customizable, but the Settings UI cannot edit it. Other persisted configuration such as hours, holiday closures, social links and `logoUrl` is either dormant or only partially consumed. Integrations/notifications show safe non-secret status, which is good, but operational controls and health/history remain incomplete. These are direct examples of backend capability that is not fully manageable from the frontend.

The brand itself is **not the accessibility problem**. Evergreen v2.0's intended core pairings are strong: the brand QA record reports white-on-evergreen at 12.28:1, ink-on-ivory at 14.57:1, evergreen-on-fresh at 8.53:1, muted-on-ivory at 5.71:1, ivory-on-night at 15.85:1 and dark-muted-on-surface at 8.29:1. Those numbers comfortably support WCAG AA text contrast when the documented pairings are used correctly. The brand kit explicitly says these are mathematical pair checks rather than a deployed-interface accessibility audit, so the right response is to test the product implementation — not to replace the normal brand with generic gray.

The current implementation is split in two. The public site is largely built from semantic brand tokens such as `bg-canvas`, `text-ink`, `bg-surface`, `text-primary` and `border-line`. The owner desk, customer portal and authentication screens historically used hard-coded Tailwind gray classes across dozens of files; `globals.css` then globally retints or overrides those classes. In dark mode, many of those overrides use generic slate/gray values rather than the Evergreen dark palette. That architecture explains why the public brand can be correct while the operational product still feels generic or only partially branded.

The recommended accessibility strategy is therefore:

1. **Evergreen is the normal default UI**, in both light and dark themes, using semantic design tokens everywhere.
2. **Semantic status colors remain separate from decorative brand colors** and always carry text/icon/shape cues, never color alone.
3. **User-requested accessibility modes adapt the presentation** rather than watering down the standard brand for everyone:
   - respect `prefers-reduced-motion`;
   - support `prefers-contrast: more` with stronger borders/focus/surface separation where useful;
   - support Windows/system high-contrast via `forced-colors: active`, generally allowing system colors to take over and adding only targeted fixes;
   - preserve keyboard, focus, zoom/reflow, target-size, accessible-name and screen-reader behavior independently of color.
4. A screen reader does **not** imply an alternate color scheme. Color adaptation should respond to actual visual preferences/system modes, not to assistive technology generally.

Automated accessibility coverage is also weaker than the documentation implies. The authenticated axe suite does not cover all current owner/customer top-level routes, the dark-mode suite covers only a representative subset, dynamic/detail states are much less comprehensively exercised, and the documented baseline still says WCAG 2.1 AA rather than the current WCAG 2.2 AA target. Passing axe on selected pages is valuable evidence, but it is not complete conformance proof.

Finally, the application still lacks a single integrated acceptance scenario proving the whole business chain through the real UI and backend together — lead/customer creation, agreement/signing/payment requirements, delivery/job execution, billing, maintenance/swap/removal/return and inspection. The roadmap already anticipates this in O30/O31; Package 7 confirms that it is not optional if the goal is a coherent finished product.

### Overall assessment

**HIGH PRODUCT-INTEGRATION RISK until the frontend/backend coverage contract, brand-token migration and full accessibility/integration acceptance are completed.**

No Package 7 finding is rated Critical. The system's core records and domain boundaries are not broadly inaccessible or corrupt; the main problem is incomplete integration and presentation consistency. Several High findings are already anticipated by the existing overhaul roadmap, which is good — Package 7 turns them into explicit completion criteria rather than inventing a parallel roadmap.

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 7 |
| Medium | 9 |
| **Total** | **16** |

---

# Audit principles

## 1. Owner-manageability is a product requirement, not “put every secret in Settings”

Package 7 uses three control classes.

### Class A — business-operational configuration: must be manageable in Appliance Desk

Examples:

- public business information;
- products, prices and visibility;
- service area;
- rental policies and fees;
- inspection/checklist policy;
- staff access state;
- website content and publication state;
- communication preferences/templates/schedules where business-owned;
- automation health/history and retry/recovery actions;
- customer/rental/job/inventory workflows;
- business-report definitions and drill-through.

These are the kinds of things the owner should not need a coding agent or database console to change.

### Class B — infrastructure secrets: must **not** be exposed as editable raw values in the app

Examples:

- `BETTER_AUTH_SECRET`;
- database URLs;
- Stripe secret/webhook keys;
- Resend API key;
- Twilio auth token;
- Vercel Blob credential;
- platform deployment credentials.

The product may show safe status, verification health and a runbook link, but raw values should remain in the hosting/provider secret store.

### Class C — exceptional recovery/engineering controls: may remain runbook/CLI/provider-console actions

Examples:

- schema migrations;
- database point-in-time restore;
- signing-key rotation;
- provider account recovery;
- destructive bulk recovery/reconciliation.

These must have a documented reason, safe guardrails and acceptance evidence; they do not need a convenient button merely to satisfy “everything in the frontend.”

---

# Verified strengths / non-findings

These should be preserved while remediating Package 7.

- The official Evergreen v2.0 brand kit is checked into the repository and clearly identifies `brand-tokens.json` as the source of truth.
- The official palette includes both light and dark token sets and measured high-contrast core pairings.
- The public site already uses semantic token classes extensively rather than raw palette classes.
- The shared desk sidebar has begun moving signed-in UI toward semantic brand classes.
- Manrope is wired as the application font.
- Shared `StatusBadge`/status-label infrastructure exists and pairs state with text/icons so meaning is not supposed to rely on color alone.
- App-wide `prefers-reduced-motion` handling exists.
- Light-mode and dark-mode automated axe suites exist and provide useful regression coverage.
- The owner navigation is broad and role-aware; STAFF finance restrictions are filtered server-side rather than merely hidden with CSS.
- Settings already uses section-specific, field-whitelisted saves and keeps secrets out of the UI.
- Product/catalog pricing and visibility are owner-manageable.
- Staff account creation/deactivation/reactivation has a real Settings surface.
- Invoice and work-order data are built from backend DTOs rather than handwritten duplicate values.
- The roadmap already reserves O22/O23 for website revisions/editor and O24–O28 for automation/communications health, so several findings below can be resolved by completing the existing plan rather than starting over.

---

# High findings

## H1 — `SiteContent` exists as a backend business capability but the current frontend has no real content-management/publish workflow

**Severity:** High  
**Primary areas:** `prisma/schema.prisma`, `src/app/desk/settings`, public website, O22/O23

### Problem

The data model describes `SiteContent` as editable public-site text keyed by values such as `home.headline`, `rentals.body` and FAQ entries. It is included in the backup manifest. That creates a clear backend/product promise: website content is data, not a code deployment.

On current `main`, `/desk/settings?section=website` is effectively a link hub. It points to launch controls and the public site and tells the owner to use Business profile, Service area and Products/Pricing for the few public values those sections control. It does not provide a `SiteContent` editor, draft state, preview, publication history or rollback.

The existing overhaul plan correctly identifies this as O22/O23, but until those tasks are complete the frontend does not handle the backend content-management capability.

### Required remediation

Complete the existing O22/O23 design rather than adding a second CMS:

- bounded, typed editable content keys;
- draft vs published content;
- editor/version metadata;
- preview of the exact draft;
- explicit publish action;
- rollback to prior published revision;
- safe validation/escaping;
- owner/admin authorization and audit trail;
- public pages read only published content;
- no arbitrary executable HTML/script editor.

### Acceptance

The owner can change every supported public copy block, preview it, publish it, verify the public result and roll it back without code/database access.

---

## H2 — The appliance inspection checklist is live backend business logic but is not owner-configurable from Settings

**Severity:** High  
**Primary areas:** `BusinessSettings.inspectionChecklist`, `src/domains/inventory/guided-actions.ts`, `/desk/settings`

### Problem

Business rules explicitly describe `BusinessSettings.inspectionChecklist` as the reusable checklist the owner can customize. `getInspectionChecklist()` reads the field, and the returned-appliance guided-action UI consumes it.

But the Settings contract does not include `inspectionChecklist` in `BusinessSettingsUpdate`, the settings validation schema/section map does not expose it, and no Settings form edits it.

This is a direct frontend/backend mismatch: the workflow already supports the configuration, but the owner cannot manage it through the product.

### Required remediation

Add an Inventory/Operations policy section with a structured checklist editor:

- reorderable items;
- add/edit/remove;
- sensible maximum count and item length;
- reset to documented defaults;
- version/audit entry on change;
- existing inspections keep the checklist snapshot they actually used;
- new inspections receive the currently published checklist.

### Acceptance

Changing the checklist in Settings changes the next new inspection workflow without changing historical inspection evidence and without requiring a code deployment.

---

## H3 — BusinessSettings contains multiple “phantom configuration” fields with no complete owner-management/consumer path

**Severity:** High  
**Primary areas:** `BusinessSettings`, settings domain/UI, public site, documents

### Problem

The persistent singleton contains operational/business fields including:

- `hours`;
- `holidayClosures`;
- `socialLinks`;
- `logoUrl`;
- `announcementBannerText` / `announcementBannerOn`;
- `inspectionChecklist`.

Several of these are absent from the editable Settings contract; searches show hours/holiday closures/social links are effectively dormant, `logoUrl` is passed into document DTOs but is not owner-editable and is not actually rendered by the invoice/work-order components, and the announcement-banner fields do not form a clear current public editing/consumption path separate from the newer launch controls.

A database column is not a product feature. Keeping dormant fields creates false confidence for future agents and encourages new code to assume configuration is already supported.

### Required remediation

Create a BusinessSettings coverage table and make an explicit decision for every field:

- **active + owner-editable + consumed**;
- **read-only derived/system value**;
- **planned with an existing roadmap owner**;
- **deprecated/remove**.

Do not leave fields indefinitely in an ambiguous “maybe used later” state.

### Acceptance

Every BusinessSettings field has a documented owner, UI/consumer path or explicit deprecation, and tests prove the active fields are round-trippable through the intended frontend.

---

## H4 — The signed-in product does not use the Evergreen semantic token system consistently; generic gray utilities plus global retint overrides are the dominant legacy styling architecture

**Severity:** High  
**Primary areas:** `src/app/globals.css`, `/desk/**`, `/account/**`, auth pages

### Problem

The public website follows the right architecture: components use semantic classes backed by Evergreen light/dark tokens.

The owner desk/customer portal/auth areas were historically built with utilities such as:

- `bg-white`;
- `bg-gray-50`;
- `text-gray-900`;
- `text-gray-600`;
- `border-gray-200`;
- `bg-gray-900`.

`globals.css` then globally reinterprets those generic utilities and applies separate dark-mode overrides. In dark mode, many of the replacements are slate/gray values (`#111827`, `#1f2937`, `#374151`, etc.) rather than the Evergreen dark `night`/`surface`/`ivory` palette.

This creates several problems:

1. the operational product can look generic even when the public site is strongly branded;
2. a utility class's meaning depends on global override knowledge rather than the component's semantic intent;
3. a new Tailwind shade can silently fail to adapt until another special override is added;
4. brand and accessibility behavior are harder to reason about and test;
5. the user cannot trust that “Evergreen” means the same thing across surfaces.

### Required remediation

Migrate shared signed-in primitives and then page families to semantic roles, not one-off palette utilities:

```text
canvas / surface / elevated
text / text-muted
border / border-strong
primary / on-primary
accent / on-accent
action / on-action
focus
success / warning / danger / info
```

Use the official Evergreen light/dark palette for the normal themes. Keep semantic state colors separate and accessible.

Do this incrementally through reusable primitives (`SectionCard`, inputs, tables, buttons, menus, tabs, badges, alerts), not by mechanically replacing every class in one massive unsafe edit.

### Acceptance

A code search over production UI should show signed-in page families consuming semantic design primitives/tokens rather than relying on generic gray-class global reinterpretation. Light and dark screenshots should visibly belong to the same Evergreen product family.

---

## H5 — Accessibility CI does not cover the current product surface despite documentation implying complete authenticated coverage

**Severity:** High  
**Primary areas:** `e2e/accessibility-authenticated.spec.ts`, `e2e/accessibility-dark-mode.spec.ts`, `docs/DESIGN-SYSTEM.md`

### Problem

The authenticated axe suite covers many routes, but current owner navigation also includes top-level routes that are absent from that list, including:

- `/desk/tasks`;
- `/desk/estimates`;
- `/desk/driver`;
- `/desk/fleet`;
- `/desk/purchase-orders`;
- `/desk/suppliers`;
- `/desk/revenue`.

The customer portal exposes `/account/settings`, which is also absent.

The dark-mode suite covers only a much smaller sample. Dynamic detail pages, dialogs, expanded error states, complex forms, print surfaces and workflow transitions are not comprehensively represented by the route smoke set.

The design-system documentation still frames the required baseline as WCAG 2.1 AA. The product should now use WCAG 2.2 AA as its engineering target. Automated axe checks remain useful, but they cannot prove all success criteria or legal compliance by themselves.

### Required remediation

- derive top-level accessibility route coverage from the same navigation source where practical so new routes cannot silently escape;
- add `/account/settings` and every current owner navigation destination;
- add representative detail/workflow/error states, not only index pages;
- add WCAG 2.2-relevant automated rules supported by the installed tooling;
- retain manual keyboard, focus-order, zoom/reflow, touch target and screen-reader launch acceptance;
- record tested browsers/modes and evidence.

### Acceptance

No user-reachable primary page family exists outside the accessibility acceptance matrix, and the docs accurately distinguish automated scanning from full conformance/manual acceptance.

---

## H6 — There is no single end-to-end acceptance scenario proving the complete business lifecycle across UI + domain + database boundaries

**Severity:** High  
**Primary areas:** roadmap O30/O31; leads/customers/agreements/jobs/billing/maintenance/inventory/portal

### Problem

The codebase has many strong unit/integration/e2e tests for individual domains and recovery cases, but the finished product requires cross-domain invariants that no isolated test can prove.

The business lifecycle spans at least:

```text
lead / direct customer
→ estimate (when applicable)
→ customer + property
→ rental agreement
→ signature/payment requirements
→ equipment reservation/assignment
→ delivery/install job
→ billing starts only after the correct operational event
→ recurring billing/service
→ maintenance/swap when needed
→ removal/return
→ awaiting inspection
→ inspection result
→ available or maintenance
→ agreement/customer history remains coherent
```

A local domain can be correct while the handoff to the next domain is wrong or absent.

### Required remediation

Complete O30/O31 with durable integrated scenarios against disposable real Postgres data and real UI/server boundaries. Include success, retry and failure paths.

At minimum prove:

- happy-path rental lifecycle;
- delivery never occurs;
- payment requirement incomplete;
- maintenance and swap;
- removal/return/inspection;
- cancellation/termination/renewal once B34–B36 are implemented;
- provider send/payment failure does not lie to the operator;
- customer portal matches owner-side source of truth;
- audit history identifies consequential transitions.

### Acceptance

A release candidate cannot be declared ready unless the integrated lifecycle matrix passes at the exact release head.

---

## H7 — Integration/notification/automation configuration is safely status-only, but the operational management surface is not yet sufficient for a self-sufficient owner

**Severity:** High  
**Primary areas:** `/desk/settings?section=notifications`, `/desk/settings?section=integrations`, O24–O28

### Problem

`providerStatus()` correctly avoids exposing credentials and tells the owner whether Email/SMS/Payments/Webhook/Storage configuration exists. That is a strength.

But “configured” is not the same as operationally manageable. As communications/automations grow, an owner needs to answer from the product:

- Is this automation enabled?
- When did it last run?
- What did it attempt?
- What succeeded/failed/suppressed?
- Which record/customer was affected?
- Is a retry safe and available?
- What business-owned template/schedule/preference controls it?
- Is the provider configured but unhealthy?

The roadmap already anticipates this with O24–O28 and the durable message/run-history work. Package 7 confirms it is necessary to meet the user's “I should not need AI after completion” objective.

### Required remediation

Keep raw secrets in Vercel/provider stores, but add owner-safe operational controls and observability for supported automations/communications. Use durable run/message records rather than inferring health from environment variables.

### Acceptance

For every production automation/communication workflow, the owner can see configuration state, last-run/delivery state and actionable failures without opening Vercel logs or asking an agent to inspect code.

---

# Medium findings

## M1 — `brand-tokens.json` is declared the only source of brand colors, but production CSS duplicates raw brand hex values and adds local derived colors

**Severity:** Medium

### Problem

The brand README says colors come from `brand-tokens.json` and should not be hard-coded elsewhere. `globals.css` copies the palette into raw CSS literals and also introduces locally derived hover/border values.

The current values may look correct today, but two sources can drift.

### Required remediation

Generate/import the application's semantic CSS variables from one versioned token source or add a build/test assertion that production variables exactly match approved brand tokens plus an explicit semantic-extension file for statuses/hover derivations.

---

## M2 — The app handles reduced motion but has no explicit high-contrast adaptation layer for `forced-colors` or `prefers-contrast`

**Severity:** Medium

### Problem

`prefers-reduced-motion` is implemented. Searches of production CSS found no `forced-colors` or `prefers-contrast` strategy.

The official Evergreen pairings are sufficiently strong that the normal brand should remain the default. The missing piece is adaptation for users who explicitly request additional contrast or whose OS forces a high-contrast palette.

### Required remediation

- keep Evergreen as normal light/dark presentation;
- add `@media (prefers-contrast: more)` only where the default needs stronger differentiation — e.g. border strength, focus thickness, underlines, surface separation;
- support `@media (forced-colors: active)` and generally allow system colors to replace author colors; use targeted `forced-color-adjust` only when genuinely necessary;
- test Windows/high-contrast or equivalent forced-colors rendering;
- do not infer a color mode from screen-reader use.

---

## M3 — Invoice/work-order DTOs carry `logoUrl`, but the rendered business documents ignore it and do not use the official logo asset

**Severity:** Medium

### Problem

`getInvoiceDetail()` and `getWorkOrderDetail()` include business `logoUrl`. The document components describe themselves as matching the brand-kit forms, but their headers render business name/contact text in a generic dark band and never render `logoUrl` or the checked-in official Robinson logo.

This is both a frontend/backend mismatch and a brand-fidelity gap.

### Required remediation

Define the actual brand-document rule:

- preferably use the checked-in approved logo asset as the stable default;
- if owner-overridable `logoUrl` remains a real requirement, expose and validate it in Settings and fall back safely to the official asset;
- preserve print contrast/ink-saving behavior without removing brand identity;
- align Invoice/Estimate/Work Order components with the approved business-form hierarchy.

---

## M4 — There is no automated visual/brand regression contract spanning public site, desk, portal, auth, email and business documents

**Severity:** Medium

### Problem

Axe can catch many accessibility issues but cannot tell whether an owner page accidentally reverted to a generic gray palette, whether the wrong logo variant appears, whether card radius/spacing drifted, or whether email/document branding diverges from the kit.

### Required remediation

Add a small, intentional visual regression set for canonical surfaces and states:

- public home/pricing/contact;
- login;
- Today/dashboard/customer/agreement/job/settings;
- customer portal home/rental/billing/settings;
- invoice/estimate/work-order print views;
- light + dark;
- high-contrast/forced-colors representative checks.

Do not snapshot every page indiscriminately; use representative design-system surfaces and key workflows.

---

## M5 — Maintenance and Job transition availability is duplicated in UI maps rather than shared from the authoritative backend rule

**Severity:** Medium

### Problem

Maintenance detail defines an `ALLOWED_NEXT` map mirroring the domain transition rules. Job detail does the same and explicitly comments that it mirrors `ALLOWED_JOB_TRANSITIONS` in the domain.

Server enforcement prevents an invalid state write, but frontend duplication can still produce misleading buttons, hide a newly valid action or expose an action that always errors.

Inventory already demonstrates the better direction by reusing a shared transition constant.

### Required remediation

Export a UI-safe transition description/pure predicate from the domain layer and have both server validation and frontend action availability consume the same source.

---

## M6 — The required public accessibility statement/reporting path is still not implemented

**Severity:** Medium

### Problem

`docs/DESIGN-SYSTEM.md` requires an `/accessibility` statement and a way to report accessibility problems before launch. No current `/accessibility` page was found.

### Required remediation

Add a concise factual statement that includes:

- accessibility commitment;
- current target (WCAG 2.2 AA);
- known limitations if any;
- supported contact path for accessibility problems;
- date/version last reviewed;
- no unsupported claim of legal certification.

---

## M7 — Automated accessibility scans do not replace the required manual keyboard/screen-reader/zoom workflow acceptance

**Severity:** Medium

### Problem

The design docs correctly acknowledge this, but release readiness still lacks the evidence. Automated scanning cannot fully validate focus order, task usability, spoken context, modal behavior, error recovery, 200%/400% reflow or the practical usability of dense owner workflows.

### Required remediation

Add a repeatable manual launch checklist with evidence for at least:

- keyboard-only primary workflows;
- visible/non-obscured focus;
- screen-reader landmarks/names/status announcements;
- 200% and 400% zoom/reflow where applicable;
- phone-width operation;
- high-contrast/forced-colors;
- reduced motion;
- signing/payment/customer-support critical paths.

---

## M8 — Status and semantic presentation still has local one-off maps on branded documents, creating another drift channel

**Severity:** Medium

### Problem

The application has shared `StatusBadge` / status-label infrastructure, but invoice/work-order documents maintain their own `STATUS_STYLES` mappings with raw Tailwind state colors.

Print contexts may justify different layout, but status meaning/label/tone should not independently drift from the rest of the product.

### Required remediation

Share the semantic status mapping while allowing a document-specific renderer to choose print-safe presentation. The domain decides “success/attention/stopped/etc.”; the document decides how that semantic tone prints.

---

## M9 — The design-system token contract is incomplete beyond color/font: brand radius/spacing/component primitives are not consistently enforced in the signed-in product

**Severity:** Medium

### Problem

The official token file includes control/card radii and a spacing scale, but the signed-in product still largely composes raw Tailwind primitives and legacy page-specific patterns. Even after color retinting, this can make the desk/portal feel like a generic admin application with Robinson colors applied afterward rather than a Robinson product.

### Required remediation

Expand semantic primitives gradually:

- branded card/surface;
- field/control;
- primary/secondary/destructive actions;
- table/list row;
- tabs/filter bar;
- alert/status;
- navigation;
- page header;
- empty/error/loading states.

Use the approved radius/spacing/focus rules inside those primitives so page authors do not reinvent them.

---

# Capability coverage matrix

This matrix is the required shape for the later cross-package synthesis. “Partial” means the capability exists but owner/customer control, visibility or end-to-end acceptance is incomplete.

| Capability | Backend/domain | Frontend surface | Coverage | Package 7 conclusion |
| --- | --- | --- | --- | --- |
| Business profile | `BusinessSettings` | Settings → Business profile | Good | Preserve |
| Service area | `BusinessSettings` | Settings → Service area | Good | Preserve |
| Product types/prices/photos/public visibility | `ApplianceType`, pricing/settings domain | Settings → Products/Pricing | Good | Preserve; continue integration tests |
| Rental policy/fees/tax/prepay/referral | `BusinessSettings` | Settings → Policies | Mostly good | Package 2/5 correctness findings still apply |
| Staff account lifecycle | User/auth/staff domain | Settings → Staff | Good | Preserve Package 3 hardening |
| Website content (`SiteContent`) | Schema + backup | No true editor/publish surface | **Missing/Partial** | H1; complete O22/O23 |
| Website announcement/content revisions | mixed BusinessSettings/LaunchSettings/SiteContent | Launch + limited website section | Partial | Rationalize one ownership model |
| Inspection checklist | `BusinessSettings.inspectionChecklist` actively consumed | No editor | **Missing** | H2 |
| Business hours/closures/social links | persisted settings | No complete editor/consumer | Dormant | H3: surface or deprecate |
| Business logo configuration | `logoUrl` carried in document DTOs | No complete Settings control; documents ignore | Partial | H3/M3 |
| Integrations/provider secrets | environment/provider stores | safe status only | Correct boundary | Do **not** expose raw secrets |
| Integration health/automation run history | sender/cron/provider logic | incomplete | Partial | H7; O24–O28 |
| Customer portal rentals/maintenance/billing | portal domain | `/account/**` | Broad coverage | Continue O20/B34–B36 improvements |
| Customer SMS preference | portal consent domain | `/account/settings` | Present | Add accessibility coverage + Package 6 STOP sync |
| Reports/revenue/fleet | reporting domains | desk reports/revenue/fleet | Present | Package 5 corrections still required |
| Activity/audit history | `AuditLog` | `/desk/activity` | Present | Preserve/expand consequential actions |
| Backup/recovery | backup domain + Neon/provider | intentionally not ordinary UI | Correct Class C boundary | Package 6 recovery acceptance required |
| Full lifecycle | many domains | many disconnected pages | Partial | H6; O30/O31 required |

---

# Brand + accessibility operating standard

This section records the owner's stated intent as a concrete implementation policy.

## Normal mode: use the real brand

The standard Appliance Desk experience should use the official Evergreen v2.0 system, not a generic gray “accessible” substitute.

Approved core pairings already have strong measured contrast:

| Pair | Brand QA ratio |
| --- | ---: |
| White on Evergreen | 12.28:1 |
| Ink on Ivory | 14.57:1 |
| Evergreen on Fresh | 8.53:1 |
| Muted on Ivory | 5.71:1 |
| Ivory on Night | 15.85:1 |
| Dark muted on surface | 8.29:1 |

Use those pairings as designed. Do not put white text on the light Fresh accent merely because it is a “brand color”; use Evergreen/on-accent as the kit specifies.

## Dark mode: still Evergreen

Dark mode is a normal theme, not an accessibility fallback. Its surfaces should come from the official `night` / dark `surface` / `ivory` / dark-muted / Fresh token set rather than a parallel generic slate design.

## High-contrast / forced-colors: adapt when the user/system asks

- `prefers-contrast: more`: strengthen borders/focus/separation without needlessly discarding brand identity.
- `forced-colors: active`: allow system colors to take precedence; verify links, focus, icons, controls and selected/disabled states remain understandable.
- avoid `forced-color-adjust: none` except narrowly where the authored color itself carries unavoidable meaning and an equivalent accessible representation is maintained.

## Reduced motion

Keep the existing app-wide reduced-motion behavior and verify any new animation respects it.

## Screen readers

Do not switch visual branding merely because a screen reader is active. Screen-reader accessibility is primarily semantic structure, names, relationships, announcements, focus and task flow.

## Compliance language

Engineering should target **WCAG 2.2 AA** and keep evidence, but the product should not claim blanket ADA/legal certification merely because color ratios and axe scans pass. Legal obligations depend on context and complete conformance requires more than automated testing.

---

# Cross-package overlap / deduplication notes

Package 7 intentionally records integration-level symptoms without pretending the underlying remediation belongs only here.

- H1 aligns with roadmap O22/O23 rather than creating a new website-editor project.
- H6 aligns with O30/O31 and should become the acceptance spine for the final cross-package synthesis.
- H7 aligns with O24–O28.
- Package 6 private-media/auth/privacy findings remain Package 6 root causes; Package 7 only requires the frontend to present the corrected behavior coherently.
- Package 5 reporting correctness remains Package 5; Package 7 asks whether corrected reporting is understandable/manageable from the UI.
- Packages 1–4 business-domain defects should not be duplicated merely because they also appear in a screen. The synthesis should map one implementation batch to all findings it resolves.

---

# Recommended remediation order

## Phase P7-A — Define product contracts before changing visuals

1. Create the backend-capability → UI coverage inventory as a maintained artifact/test.
2. Classify BusinessSettings/SiteContent fields as active, planned, system-only or deprecated.
3. Establish Class A/B/C management boundaries.
4. Complete O22/O23 and the inspection-checklist control.
5. Make O24–O28 operational management/observability owner-usable.

## Phase P7-B — Brand-system convergence

1. Make `brand-tokens.json` + explicit semantic extension the source of truth.
2. Convert shared signed-in primitives to semantic Evergreen tokens.
3. Migrate page families incrementally.
4. Bring invoice/estimate/work-order surfaces back to approved brand assets/hierarchy.
5. Remove legacy generic-gray override rules as their last consumers disappear.

## Phase P7-C — Accessibility adaptation and acceptance

1. Update target to WCAG 2.2 AA.
2. Expand route/dynamic-state coverage.
3. Add `prefers-contrast`/`forced-colors` acceptance.
4. Keep reduced-motion tests.
5. Execute manual keyboard/screen-reader/zoom/high-contrast pass.
6. Publish the factual accessibility statement.

## Phase P7-D — Full integrated product proof

Use O30/O31 to execute the full business lifecycle at the exact release head across desktop/mobile/light/dark and representative accessibility modes. Record failures as product defects, not as “test-only” cleanup.

---

# Required completion artifacts

Package 7 is not considered remediated until the implementation phase produces:

1. **Capability coverage register** — backend capability, intended actor, UI surface, authorization, tests, status.
2. **BusinessSettings/SiteContent ownership register** — every field/key classified; no phantom configuration.
3. **Semantic design-token contract** — one brand source plus documented semantic state extensions.
4. **Brand surface matrix** — public / desk / portal / auth / email / invoice / estimate / work-order / print.
5. **Accessibility matrix** — route/state × light/dark/high-contrast/reduced-motion/keyboard/zoom/screen-reader acceptance.
6. **Integrated lifecycle matrix** — happy path + key failure/retry paths.
7. **Owner self-sufficiency check** — ordinary business changes require no code/database console.
8. **Exact-head evidence** — focused tests, full CI once for the substantial batch, preview/live walkthrough where applicable.

---

# Final Package 7 conclusion

The owner’s instinct behind this package is correct: Appliance Desk should not be evaluated as a collection of backend functions and individual screens. The finished product must prove that every intended business capability is reachable, understandable and safely manageable by the correct human actor, that the frontend cannot silently drift from backend rules, that workflows connect all the way through the business lifecycle, and that the real Robinson Appliance Rentals brand survives throughout the operational product.

The Evergreen brand does **not** need to be diluted for accessibility. Its intended core combinations already have strong contrast. The better architecture is to use Evergreen semantically and consistently as the default, then respect actual user/system accessibility preferences with targeted adaptation and complete non-color accessibility behavior.

Package 7 therefore becomes the bridge between the first six domain audits and the next step: the **cross-package synthesis**. The synthesis should deduplicate all seven packages, map shared root causes, preserve the existing overhaul plan where it already owns the solution, and produce a small number of large, ordered implementation batches whose completion can be proven end to end.
