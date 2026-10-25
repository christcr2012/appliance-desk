# Screen spec — Settings: one place, sections, search, setting rows with history (AR-8)

Built in **AR-8**. Design: `APP-REDESIGN.md` 4.2(4) (settings page type), 4C (what belongs in Settings), 4D.4/4D.5
(explains itself, grow into it), 4D.7 (notifications you control). Kit: KIT.md (`SettingRow`, `SettingsLayout` are
specified here — KIT 4.18 says AR-8 builds them; `Sheet` 4.19; `ConfirmDialog` 4.12; `InfoTip`). Rules: AGENTS
section 4 "Owner-configurable by default" — every row says what it does, its starting value and why, who can change
it, and offers "Restore recommended".

**No setting behaviour changes.** Every save goes through the existing domain save function for that setting (same
locks, actor checks, audit rows, effective-date rules). New code is: a catalog that describes the rows, the layout,
one generic row save for plain `BusinessSettings` scalars, and the five save paths that are missing today (section 1).

Roles: the Settings area is OWNER and ADMIN (`requireRole("OWNER","ADMIN")` on every page, as today). Rows marked
**owner** are read-only for ADMIN with the reason "Only the owner can change this." (and the server action refuses —
the existing owner-only pages already refuse). STAFF never reaches Settings; their personal settings live in "Your
account" (`/desk/account`).

## 1. Fixes found while specifying (do them in this card)

- **Settings with no screen.** These stored settings are read by the app but nothing lets Chris change them (no
  action writes them): `deliveryMorningStartHour`, `deliveryMorningEndHour`, `deliveryAfternoonStartHour`,
  `deliveryAfternoonEndHour` (read in `src/domains/jobs/scheduling.ts`), `relocationFeeCents` and `missedTripFeeCents`
  (read in `src/domains/orders/owner-job-fees.ts`; only displayed on the visit page), `lemonRepairPercent`
  (`src/domains/books/reports.ts`), `exportPayoutLines` (`src/domains/books/exports/index.ts`). Each becomes a row
  (section 4) saved through the generic row save (section 5). `retiredFollowUpDays` and `approvalExpiryDays` have
  domain writers (`src/domains/inventory/retired-plans.ts` ~457, `src/domains/approvals/index.ts` ~89) — their rows
  call those writers.
- **A save path that skips the stale-page check.** `settings-form.tsx` falls back to `updateSettingsAction(values)`
  (`src/app/desk/settings/actions.ts:46`), which saves the whole form with no revision check, so an old tab can
  overwrite a newer change. After this card every BusinessSettings save carries a revision (section 5); delete the
  fallback branch and `updateSettingsAction` (no other caller — `grep -rn updateSettingsAction src` shows only the
  form) and its test expectations move to the row/section actions.
- **History lookups are unbounded.** `checkUndo` in `src/domains/settings/history.ts` loads every newer
  `settings.update` row with no limit. Cap it with `take: 500` ordered by `createdAt asc`; if 500 newer rows exist,
  refuse with "This change is too old to undo here." (test with 501 rows).
- **The settings home is a wall of link buttons** (`page.tsx` ~378–393: "Manage my business", "Settings history and
  undo", "All switches in one place", "Price changes…", "What each admin may do", "Goals and alerts", "Approval
  limits", "Approvals waiting") — the DESIGN-SYSTEM "no bare link lists" rule. They become rows in their sections
  (section 4); "Approvals waiting" is a Today item already (AR-2) and leaves Settings.
- `listSettingsHistory` has no role check of its own (the page checks). Add `await requireRole("OWNER","ADMIN")`
  inside it (same reason as PR #594: data reads guard themselves).

## 2. Routes

- `/desk/settings` — the settings home. Phone: the section list (full screen). Desktop: redirects to the first
  section the person can see (`/desk/settings?section=decisions` for OWNER — "Decisions & reviews" — and
  `?section=business` for ADMIN).
- `/desk/settings?section={id}` — one section (all sections render in the same page component).
- Existing sub-pages keep their URLs and open inside the settings frame (`src/app/desk/settings/layout.tsx` renders
  `SettingsLayout` around `children`; each page still calls its own `requireRole` — the layout is not the guard):
  `approvals`, `goals`, `history`, `lead-response`, `payment-links`, `permissions`, `policies`, `preview-storage`,
  `price-changes`, `rental-endings`, `switches`, `telecom`, `unsigned-follow-up`, `website`, plus AR-12's `features`,
  DEC-1's `decisions`, AR-13's notification page lives in Your account (section 4.3).
- Old section ids redirect to the new ones (in the page, before rendering): `profile`→`business`,
  `service-area`→`business`, `products`→`prices`, `policies`→`rentals`, `terms`→`rentals`, `pickups`→`rentals`,
  `jobs`→`rentals`, `notifications`→`messages`, `security`→`team`, `staff`→`team`, `integrations`→`advanced`
  (keep the anchor: `…&section=rentals#terms`). Unit test the map.
- Pages that stay elsewhere but are listed as rows (link rows, section 4): Taxes setup `/desk/sales-tax/setup`, record
  retention `/desk/sales-tax/record-retention`, use-tax settings `/desk/sales-tax/use-tax/settings` (AR-7 keeps them in
  Money › Taxes), Books setup `/desk/books/setup`, budget settings `/desk/books/budget` (shown only when the budget
  feature is shown — AR-12), System health `/desk/automations`, Privacy requests `/desk/privacy` (owner), Business
  paperwork `/desk/paperwork` (owner), Website editor `/desk/settings/website`, Launch list `/desk/launch`.

## 3. Layout (`SettingsLayout`, kit)

- Desktop (`lg:`): left column 260 px, sticky: `ScreenHeader` "Settings" (no description), a search field
  `[data-kit-search]` "Search settings", then the section list (one row per section: `Icon` + label; current section
  `bg-primary-soft font-bold`; an attention dot when the section has a row in state "Starting value — not confirmed"
  or "Needs setup"). Right: the section's content, max width 760.
- Phone: `/desk/settings` shows the search field and the section list as large rows (`min-h-14`, chevron);
  tapping opens the section full screen with a back button "Settings" (TopBar `back` crumb, NAVIGATION 2).
- **Search** (client, no server call): filters the catalog's `label`, `keywords` and section label; results replace
  the section list with matching rows grouped by section ("Late fee — Rentals & policies"); Enter or tap goes to the
  row (`/desk/settings?section={id}#row-{key}`), which scrolls into view and flashes `bg-attention-soft` for 1.5 s
  (`prefers-reduced-motion`: no flash, focus only). Empty: "No setting called “{q}”. Try another word." The catalog's
  labels (not values) are also added to AR-1's command bar "Go to" group (`settingsCommandEntries()` from the
  catalog, filtered by role).

## 4. Sections and rows (the catalog)

`src/domains/settings/catalog.ts` (pure data + types, no database):
```ts
export type SettingKind = "money" | "days" | "hours" | "minutes" | "number" | "percent" | "yesno" | "text" | "list" | "choice" | "panel" | "link";
export type SettingRowDef = {
  key: string;                 // BusinessSettings field, or a stable id for panel/link rows ("team", "packages")
  section: SettingsSectionId; group?: string;   // sub-heading inside the section
  label: string; keywords: string[];
  kind: SettingKind;
  choices?: { value: string; label: string }[];   // for "choice"
  min?: number; max?: number;                      // validation, in the unit shown (dollars for money)
  what: string;                // one sentence: what it does
  recommended?: unknown;       // stored value (cents for money); absent for panels/links and free text
  why?: string;                // one sentence: why the recommended value
  who: "owner" | "finance";    // finance = owner or admin
  appliesTo?: string;          // effect line from `settingEffect(key)` (effects.ts) — leave empty to use it
  editor: "row" | { domainWriter: string } | { panelHref: string } | { panelComponent: string };
  feature?: FeatureKey;        // AR-12: row shown only when the feature is shown
  decisionId?: string;         // DEC-1 subject id when the value is a researched starting value
};
export const SETTINGS_SECTIONS_V2: { id: SettingsSectionId; label: string; icon: IconName }[];
export const SETTING_ROWS: SettingRowDef[];
export const NOT_A_SETTING: Record<string, string>;   // BusinessSettings fields that are not owner settings, with the reason
```
A unit test (`tests/settings-catalog.test.ts`) reads the `BusinessSettings` model from `prisma/schema.prisma` and
fails when a field is in neither `SETTING_ROWS` (by key, or listed in a panel row's `covers: string[]`) nor
`NOT_A_SETTING`. Later units that add settings add their rows here (MCP-1, MCP-2, BILL-1, DEC-2, MCP-10a…); MCP-8's
settings map reads this catalog instead of building its own.

`recommended` = the schema default for that field (also in `DEFAULT_SETTINGS`, `src/domains/settings/index.ts`),
except where a dated owner answer or DEC-2 research gives another value — then `decisionId` is set and the
recommended value comes from the DEC-1 registry at render time (`getDecision(decisionId).recommended.value`), so there
is one source.

**Sections, in order** (`id` · label · icon) and their rows. "row" = edit in place (section 5); "panel" = the row
shows a one-line summary and **Change…** opens the existing editor (in a `Sheet` when it is a small form, or its page
for big editors); "link" = goes to a page that lives elsewhere.

### 4.1 `decisions` · "Decisions & reviews" · `scale` (OWNER sees it first; ADMIN read-only)
- Panel row "Questions waiting" → `/desk/settings/decisions` (DEC-1), summary "{n} starting values not confirmed ·
  {m} with your professionals". Until DEC-1 ships this section shows one line "Coming soon" and is hidden from the
  list (feature-detect: the route file exists — a build-time constant `HAS_DECISIONS_CENTER`).

### 4.2 `business` · "Business" · `store`
- Group "Public details": rows `publicBusinessName`, `publicPhone`, `publicEmail`, `publicAddress` (text); panel
  `hours` "Opening hours" (covers `hours`, `holidayClosures`), panel `socialLinks` "Social links", panel `logoUrl`
  "Logo" — the three panels open the existing profile-extras fields of `settings-form.tsx` in a Sheet and save with
  `updateSettingsSectionAction("profile", …)` (unchanged).
- Group "Where you work": panel "Service area" (covers `serviceAreaCities`, `serviceAreaZips`; summary "{n} cities ·
  {m} ZIP codes"); panel "Where deliveries are measured from" (owner; covers `drivingOriginAddress`; summary the
  street or "Not set") → Sheet with "Street address" and "Where you checked it" fields calling the existing
  `setVerifiedDrivingOrigin(userId, street, reference)` (`src/domains/orders/route-evidence.ts`; today only reachable
  from a quote page).
- Group "Goals": panel "Goals and alerts" → `/desk/settings/goals` (covers `idleApplianceAlertDays`,
  `utilizationAlertPercent`).
- Link "Business paperwork" (owner) → `/desk/paperwork`.

### 4.3 `prices` · "Prices & packages" · `tag`
- Panel "Appliance prices" → the existing `AppliancePricingTable` (page section; summary "{n} appliance types").
- Panel "Sets and packages" → `PackageTable` (summary "{n} sets").
- Panel "Price changes with a start date" → `/desk/settings/price-changes`.
- Panel "New-order setup fee and down payment" → `SigningChargeForm` (owner; covers `administrativeSetupFeeCents`,
  `largeOrderMachineThreshold`, `largeOrderCancellationFullRefundHours`, `businessRequiresDownPayment` and the
  setup-fee tax fields — the tax fields are also DEC subjects).
- Panel "Required fees on complete quotes" → `MandatorySigningPolicyForm` (owner; covers
  `signingMandatoryPolicyVersions`).

### 4.4 `rentals` · "Rentals & policies" · `file-text`
- Group "Fees": rows `oneTimeDeliveryFeeCents`, `oneTimeInstallationFeeCents`, `oneTimeRemovalFeeCents` (money),
  `relocationFeeCents` "Moving an appliance to a new address" (money, recommended $75.00 — schema default),
  `missedTripFeeCents` "Trip fee when nobody is home" (money, recommended $0.00 — "Off until you decide to charge
  one"), `damageWaiverEnabled`, `depositEnabled` (yesno).
- Group "Late payments": `lateFeeGraceDays` (days), `lateFeeFlatCents` (money), `lateFeePercent` (percent) —
  `decisionId: "IN-84"`; BILL-1's `bankPaymentSlowBusinessDays` joins here (the late-fee pause while a bank payment confirms is a fixed rule, not a setting — LATE-FEES.md Rule 2) when
  that card ships.
- Group "Prepay discounts": the five prepay rows; `referralRewardCents`.
- Group "Ending and renewing": panel "Ending terms" → `TermsPolicyForm` (covers the `earlyTermination*`,
  `unusedTermTreatment`, `autoRenewNoticeDays`, `autoRenewTermsVersion`, `renewalTermsText`, `terminationTermsText`
  fields); panel "Automatic renewals" → `AutoRenewSwitch` (owner); panel "Month-to-month rentals" →
  `MonthToMonthForm` (covers `monthToMonthChangeNoticeDays`, `termsChangeNoticeText`, `annualReminderText`); panel
  "When equipment comes back early" → `EarlyReturnForm` (covers the `earlyReturn*` fields); panel "Rental ending
  reminder" → `/desk/settings/rental-endings` (owner; covers `rentalEndingNoticeDays`); panel "Notices" →
  `NoticeDeliveryForm` (covers `noticeCertifierRoles`, `mailNoticeTransitDays`).
- Group "Pickups and returns": panel → `PickupBillingForm` (covers `lateReturnRateMode`, `lateReturnFixedDailyCents`,
  `lateDeliveryProrationBasis`, `earlyReturnProrationBasis`, `pickupDayNotBilled`, `outOfServiceEscalationDays`).
- Group "Visits": panel → `JobSchedulingForm` (covers `defaultJobDurationMinutes`, `staffMayWorkUnassignedJobs`);
  rows `deliveryMorningStartHour`, `deliveryMorningEndHour`, `deliveryAfternoonStartHour`,
  `deliveryAfternoonEndHour` (kind `hours`, 0–23, shown as "8 am"; recommended = the schema defaults — read them from
  `prisma/schema.prisma` when building; validation: start < end within each window, refused with "The window must
  start before it ends.").
- Group "Leads and quotes": panel "Lead scoring" → `LeadScoringForm` (covers `leadScoringPolicy`); panel "Lead response
  time" → `/desk/settings/lead-response` (owner; covers `leadResponseDays`); panel "Unsigned rental reminder" →
  `/desk/settings/unsigned-follow-up` (owner; covers `unsignedFollowUpDays`); rows `draftReservationHoldDays`.
- Group "Retired appliances": row `retiredFollowUpDays` (days; editor `{ domainWriter: "setRetiredFollowUpDays" }` —
  the existing writer in `retired-plans.ts`; export it under that name if it is not exported).

### 4.5 `team` · "Team & access" · `users`
- Panel "Team members" → `TeamSection` (covers `invitationLinkDays`, `adminsMayInviteStaff`).
- Panel "Job roles" → `JobRolesEditor`. Panel "What each admin may do" → `/desk/settings/permissions` (owner).
- Panel "Owner approval for large money actions" → `/desk/settings/approvals` (owner; covers `approvalThresholds`);
  row `approvalExpiryDays` (days, editor `{ domainWriter: "setApprovalExpiryDays" }` from `approvals/index.ts`).
- Group "Sign-in safety": the security panels already on today's `security` section — two-step sign-in required for
  (covers `twoFactorRequiredRoles`), second-step methods (covers `secondStepMethodsByLevel`, `securitySmsEnabled`),
  sign-in pause (covers `signInPauseAttempts`, `signInPauseMinutes`), "Sign out every staff member" (existing action
  with its confirmation). The person's own sessions (`SessionControls`) move to Your account.

### 4.6 `messages` · "Messages & phone" · `message`
- Panel "Email to customers" → `CustomerEmailSwitch` (owner; covers `customerEmailEnabled`) — the switch keeps its
  existing confirmation; this card does not change when email goes live.
- Panel "Text messages" → `/desk/settings/telecom` (covers `customerSmsEnabled`, `communicationsPolicy`,
  `communicationsPolicyVersion`); its cost report moves there from Reports (AR-9 section 6).
- Panel "Payment link wording" → `/desk/settings/payment-links` (owner; covers `paymentLinkTemplates`).
- Panel "Spanish wording" (feature `spanishDocuments`) → `SpanishReviewForm` + `SpanishDraftsEditor` (covers
  `legalApprovals` only as read; the Spanish review records live in their own tables).
- Link "Your notifications" → `/desk/account/notifications` (AR-13), with the line "Each person chooses their own."

### 4.7 `money` · "Money & taxes" · `wallet`
- Links (AR-7 keeps the pages in Money › Taxes and Books): "Tax setup" `/desk/sales-tax/setup` (covers `taxRate*`,
  `shortTermLeaseElection*`, `useTaxMonthlyThresholdCents`, `retailDeliveryFeeDecision`, `rdf*`, `businessTaxAddress`,
  `autoApplyOfficialRateChanges`, `autoRateChangeMaxMilliPercent`), "How long tax records are kept"
  `/desk/sales-tax/record-retention` (covers `recordRetentionYears`), "Books setup" `/desk/books/setup` (covers
  `booksStartDate`, `depreciationMonthsDefault`, `depreciationSalvagePercent`, `badDebtTaxRecovery`), "Budget"
  `/desk/books/budget` (feature `budget`; covers `cashBudget*`, `bankEvidenceMaxAgeDays`, `budget*`).
- Rows `receiptFileKeepDays`, `unsentPhotoKeepDays` (days); `lemonRepairPercent` "Flag an appliance when repairs
  reach this share of its rent" (percent 5–100, recommended 30, why "Repairs costing more than about a third of what an
  appliance earns usually mean it should be replaced."); `exportPayoutLines` (feature `accountantExports`; kind
  `choice` multi — three yes/no rows "Include Stripe payouts in QuickBooks / Xero / plain CSV exports", recommended
  the schema default `{QBO: on, XERO: off, GENERIC: on}`).

### 4.8 `website` · "Website" · `globe`
- Link "Edit the website" → `/desk/settings/website`; link "Launch list" → `/desk/launch`; link "View the website" →
  `/` (new tab).

### 4.9 `advanced` · "Advanced" · `sliders`
- Link "System health" → `/desk/automations` (covers `pausedAutomations`; MCP-1/2/7 rows — late grace, backup retention,
  monitoring — are edited on that page and listed here as link rows when those cards ship).
- Panel "All switches in one place" → `/desk/settings/switches` (read-only list, unchanged).
- Panel "Settings history and undo" → `/desk/settings/history`.
- Panel "Features" → `/desk/settings/features` (AR-12, owner).
- Link "Privacy requests" (owner) → `/desk/privacy`; link "Preview storage check" (owner) → `/desk/settings/preview-storage`.
- Panel "Connected services" (today's `integrations` section content: `providerStatus()` list, read-only).
- Link "Activity log" → `/desk/activity`.

`NOT_A_SETTING` (with reasons in the file): `id`, `updatedAt`, `setupFeeTaxConfirmedOn`/`ApprovedAt`/`EffectiveFrom`/
`AdviserReference`/`DecisionNote` ("recorded by the setup-fee tax decision"), `rdfCpaConfirmedOn`,
`rdfThresholdCrossedOn` ("recorded by the delivery-fee check"), `drivingOriginVerifiedAt`,
`drivingOriginSourceReference` ("recorded with the origin"), `tenantContactPurgeApproved*` ("approval evidence"),
`taxRateConfirmed` ("recorded by tax setup"), `inspectionChecklist` ("edited on the appliance record"),
`announcementBannerText` / `announcementBannerOn` ("no screen reads these today — see the note below").
`tenantContactRetentionMonths` **is** a row: `rentals`, group "Property managers" (feature `propertyManagers`;
months; recommended the schema default; why "Keeps a former tenant's contact details long enough for move-out
questions, then removes them."; editor = the existing writer used by `customers/[id]/locations`, or the generic row
save if that page only reads it).

Note: the old website banner fields (`announcementBannerText`, `announcementBannerOn`) exist in the schema but nothing
reads or writes them; the website editor's **Featured promotion** block (`home.feature.promotion` in
`src/domains/site-content/fields-public.ts`, with start/end times) already does that job. List both fields in
`NOT_A_SETTING` with reason "Replaced by the website's Featured promotion" (columns stay; migrations are additive).
**Every later card that adds a setting adds its catalog row in the same PR** (the coverage test fails otherwise):
MCP-1, MCP-2, BILL-1, DEC-2, MCP-10a, AR-13, ACC-6 and AR-9 each add settings.

## 5. `SettingRow` and saving

**`SettingRow`** (kit, client): `{ def: SettingRowDef; value: unknown; display: string; lastChange: { by: string; at:
Date } | null; state?: "starting" | "confirmed" | "needs-setup"; editable: boolean; revision: string }`.
- Layout: `id="row-{key}"`, `min-h-14`, label (`font-semibold`) + InfoTip, value on the right (desktop) or under the
  label (phone), a small line "Changed by {by} · {formatShortDate(at)}" (or "Not changed yet"), and a state pill when
  `state` is set: "Starting value — not confirmed" (attention, links to the DEC-1 card), "Needs setup" (attention).
- InfoTip text (exact order): `what`; "Starting value: {formatted recommended} — {why}"; `appliesTo` (or
  `settingEffect(key)`); "Who can change it: the owner" / "the owner or an admin".
- Actions (⋯ and the row tap): **Change…** opens a `Sheet` titled with the label: one input of the row's kind
  (money in dollars with `$`, days/hours/minutes/percent as numbers with the unit after, yesno as a switch, choice as
  native select, text as input with the max length), the effect line, then a preview of the change ("From $45.00 to
  $50.00") from `previewSettingsUpdate`; buttons "Save" / "Cancel". **Restore recommended** (shown only when `value ≠
  recommended`): `ConfirmDialog` "Set {label} back to {recommended}?" then the same save. **History** opens a Sheet with
  this key's changes (newest first, max 20, from section 6) and an **Undo** per change when `previewSettingsUndo`
  allows it (existing behaviour and messages).
- Not editable (`editable=false`): no Change/Restore; tapping shows "Only the owner can change this."

**Generic row save** `saveSettingRowAction(key: string, value: unknown, revision: string)` in
`src/app/desk/settings/row-actions.ts`:
1. `requireRole("OWNER","ADMIN")`; the row must exist in `SETTING_ROWS` with `editor: "row"`; `who: "owner"` and not
   OWNER → refused "Only the owner can change this."
2. Validate with a per-kind zod schema built from the def (`min`/`max`; money ≥ 0 with two decimals; hours 0–23
   integers; text trimmed, max from the def); the delivery-window rule (start < end) is **not** checked here against a
   pre-read — it runs inside the save transaction (step 4), so two people changing opposite ends at once can't store
   an impossible window.
3. Convert money dollars → cents with `dollarsToCents`; build `{ [key]: stored }`.
4. Call `updateBusinessSettings(userId, update, { expectedRevision: { keys: [key], value: revision } })`.
   Inside `updateBusinessSettings`' transaction, **after** it locks the settings row, run the new
   `validateSettingsCrossFields(lockedBefore, update)` (`src/domains/settings/cross-fields.ts`, pure): for each
   delivery window (morning/afternoon start/end hours) the merged values must have start < end, else throw
   `SettingsValidationError("The window must end after it starts.")`; the same function is the single place for any
   later cross-field rule. Test: from 08:00–12:00, one save sets start 11:00 and another sets end 10:00 concurrently →
   one succeeds, the other is refused; both orders.
   Extend `updateBusinessSettings`' option to accept `{ keys: string[]; value: string }` (compared with
   `fieldsRevision(before, keys)` — the helper already exists in `preview.ts`) besides the section form; the section
   form keeps working. `SettingsConflictError` → the existing conflict message.
5. `revalidatePath("/desk/settings")`; toast "Saved {label}" with **Undo** (KIT 6.2) that calls the existing
   `undoSettingsChange` with the audit row id returned by `updateBusinessSettings` (return `{ after, auditId }` — update
   its three callers).
Rows with `{ domainWriter }` call that writer instead (each already locks and audits); panels keep their own forms.

## 6. Data for the page (read-only)

`getSettingsPage(sectionId)` in `src/domains/settings/page-data.ts` (`requireRole("OWNER","ADMIN")`): the settings
row once (`getBusinessSettings`), the visible rows of that section (role + AR-12 feature filter), each row's
`display` (`formatSettingValue` from `history.ts`, extended with `hours` → "8 am", `percent` → "30%"), `revision`
(`fieldsRevision(row, [key])`), and `lastChange` from **one** query: the newest 300 `settings.update`/`settings.undo`
audit rows (`select: oldValue, newValue, createdAt, user name`), walked newest first to find, per key, the first row
whose before/after differ (the walk is the existing `describeSettingsChange`). Rows written by domain writers with
their own audit actions (`settings.retired_follow…`, `settings.approval_…`, `settings.customer_email_on/off`, …) are
found by adding those actions to the same query (list them in the catalog as `auditActions`). DEC states come from
DEC-1's `listDecisions` when it exists (one call per page).

## 7. Words (exact)
Section labels as in section 4; "Settings"; "Search settings"; "Change…"; "Restore recommended"; "History";
"Save"; "Cancel"; "Saved {label}"; "Not changed yet"; "Changed by {name} · {date}"; "Starting value: {value} — {why}";
"Who can change it: the owner" / "Who can change it: the owner or an admin"; "Only the owner can change this.";
"No setting called “{q}”. Try another word."; "Set {label} back to {value}?"; "The window must start before it ends."

## 8. Tests
- `tests/settings-catalog.test.ts`: every BusinessSettings field is covered or excluded with a reason; every row has
  `what`, and `recommended`+`why` unless panel/link/text; every `panelHref`/link href is a real route file; old
  section ids map; recommended values equal schema defaults unless `decisionId` is set.
- `tests/settings-row-save-integration.test.ts` (throwaway Postgres): save a money row (dollars → cents, audit row);
  stale revision → conflict; owner-only row refused for ADMIN; delivery window start ≥ end refused; restore
  recommended; undo from the toast; STAFF refused; a domain-writer row (retiredFollowUpDays) uses its writer.
- `tests/settings-history-bounds.test.ts`: `checkUndo` with 501 newer rows refuses; `listSettingsHistory` refuses
  STAFF.
- Update `tests/` that used `updateSettingsAction` to the row/section actions.
- `e2e/ar8-settings.spec.ts` (add to a shard): search "late fee" → row → change to $6 → saved toast → Undo; phone
  section list → section → back; ADMIN sees owner rows read-only; old URL `/desk/settings?section=policies` lands on
  Rentals & policies; axe + 5 sizes; keyboard: search, open a Sheet, Escape returns focus.
