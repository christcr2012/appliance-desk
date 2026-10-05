# Design — Batch D: Owner/customer control plane, website, evidence & privacy

Status: **APPROVED DESIGN — implement from this document.** Originally approved 2026-10-02; **rewritten 2026-10-05 by
Claude Opus 5.5 against `main` 47bd833** after Batches A, B, C and Remediation R merged, so the drift check is already
done (section 0 records what moved). Decisions are unchanged except where the code proved an old assumption wrong;
each such change is marked **(changed 2026-10-05)** with the reason. The 2026-10-02 text is in
`docs/archive/designs-2026-10-02/BATCH-D.md` for history only.

Scope and acceptance: `docs/PLAN.md` → Batch D. Screen specs: `docs/plans/overhaul/DESIGN.md` §6 "Money and
reporting", "Customer portal", "Owner configuration and website". **Starts after Batch B2 merges** (D's customer
renewal/ending screens are built on B2's functions).

**For the implementing model (Sonnet 5.5 or Sol 5.6):** follow this literally. Do not add tables, columns, settings,
libraries or patterns it does not name. Where it is silent on something that matters, stop (section 4). Every
owner-changeable value must be a stored setting explained on its screen in plain words with a "restore recommended
value" control (`AGENTS.md`).

---

## 0. Verify before starting

Checked against 47bd833 on 2026-10-05. Re-check only rows whose files changed since (`git log 47bd833..main -- <path>`).

| # | Fact (as of 47bd833 + B2) | How to check |
|---|---|---|
| A1 | B2 is merged; STATUS says D is next. | `docs/STATUS.md` |
| A2 | Money functions D calls: `decideDepositRefund` (`src/domains/billing/deposit-refunds.ts`, exported from `refunds.ts`), `issueInvoiceRefund` / `prepareInvoiceRefundInTx` (`refunds-base.ts`, exported from `refunds.ts`), `applyCreditToInvoice` (`ledger-base.ts`, exported from `ledger.ts`), `collectedBetween` (`collected.ts`), `resolveDepositRefundRail` (`deposit-provenance.ts`), `getCustomerStatement` (`statements.ts`), held payments at `/desk/billing/held-payments`, drift workbench at `/desk/billing/reconciliation`. | grep each name |
| A3 | Agreement-ending functions D shows to customers: `getEarlyTerminationQuote` / `requestEarlyTermination` and `setAutoRenew` (`src/domains/agreements/term.ts`); from B2: `getMonthToMonthEndQuote` / `requestMonthToMonthEnd` (`src/domains/agreements/month-to-month.ts`). The portal already has "Turn off automatic renewal" (`src/app/account/rentals/turn-off-auto-renew.tsx`) and B2's "End my rental". | grep |
| A4 | `SiteContent` is a flat key/value table with **no reader** except the backup manifest. | `grep -rln "siteContent\|SiteContent" src` → only `src/domains/backup/manifest.ts` |
| A5 | `BusinessSettings` has unedited fields `hours`, `holidayClosures`, `socialLinks`, `logoUrl`, `announcementBannerText/On`; `inspectionChecklist` is no longer read (Batch C moved checklists to `InspectionChecklistVersion`). `SETTINGS_FIELDS` (`src/domains/settings/section-config.ts`) only covers `profile`, `service-area`, `policies`; other sections (`terms`, `pickups`, `jobs`, `notifications`) have their own forms and actions. The "website" section is only links today. | read the two files and `src/app/desk/settings/page.tsx` |
| A6 | `settingsSectionUpdate` (`src/domains/settings/sections.ts`) is the whitelisted save path for the three generic sections. | file |
| A7 | **Signing is in-house** (changed 2026-10-05): `sendForSignature` creates a `SignatureRecord` with `provider: "typed_signature"`; `signAgreement` stores name/email/IP/`signedAt` in one transaction. `signedPdfUrl` is never written. There is no provider PDF to copy. | `grep -rn "signatureRecord\.\(create\|update\)" src`; `grep -rn signedPdfUrl src` → nothing |
| A8 | Private photos: `getPrivatePhotoStore`, `privatePhotoReadPath` in `src/lib/photo-storage.ts`; reads are authenticated. | file |
| A9 | Public routes: `src/app/(public)/{accessibility,contact,how-it-works,launch,pricing,privacy,rent,service-area,terms}`, `src/app/sitemap.ts` lists `/privacy` and `/terms` in `PUBLIC_ROUTES`; `src/app/robots.ts` exists; privacy/terms pages show the `draft-notice` component. | ls + read |
| A10 | Reports: `src/domains/reports/{earnings,accounting-export,index}.ts`, `src/app/desk/reports/page.tsx`, `src/app/desk/revenue/page.tsx`, fleet profitability in `src/domains/inventory/analytics.ts` (labelled "Estimated rent"). No screen says "ROI" any more; the word survives only in code comments. | `grep -rniw roi src/app` → nothing |
| A11 | Rate limiting is `isRateLimited(key, { max, windowMs })` in `src/lib/rate-limit.ts` (Postgres-backed). | file |
| A12 | Customer email goes through `sendCustomerEmail` (`src/lib/customer-email.ts`) — owner switch, OFF by default; returns `{ sent, outcome, providerMessageId? }` after B2. | file |
| A13 | Supplier archive screens exist (`src/app/desk/suppliers/[id]/supplier-archive-button.tsx`); parts have a stock panel; **no screen shows a part's movement history** (Batch C leftover). | ls `src/app/desk/parts` |
| A14 | `InspectionChecklistVersion` exists (Batch C), highest `version` is current, `publishedByUserId` nullable; `recordApplianceInspection` takes `expectedChecklistVersionId`. | schema; `src/domains/inventory` |
| A15 | Today categories are bounded (≤ 50, true totals, oldest first; R17). | `src/domains/exceptions/index.ts` |

If any row is false, stop and report.

## 1. Decisions

**D1. Website content = bounded, whitelisted fields in linear revisions; the public site reads exactly one
published revision.** (O22/O23, P7 H1.) The field list is code (`src/domains/site-content/fields.ts`): each entry has
`key`, `label`, `help` (one plain sentence shown under the field), `kind` (`short` ≤ 120 chars · `paragraph` ≤ 2,000
· `url` · `alt` ≤ 160 · `meta` ≤ 160), the page and section it renders in, an optional `ownerInput` id
(IN-05/IN-06/IN-11) and a default equal to today's hard-coded text. Values are plain text: every `<` and `>` is
removed on save; no markdown, HTML or scripts. Prices, phone, email, address and service area are never fields (they
come from the catalog and Settings). A revision is immutable once published; "restore" publishes a *new* revision
copying an old one. Drafts are invisible to the public. Preview renders the real page with `?revision=<id>`, honoured
only for an OWNER/ADMIN session.

**D2. Every `BusinessSettings` column gets exactly one written disposition.** `docs/SETTINGS-COVERAGE.md` (new)
lists every column as `editable (section)`, `shown read-only (where)` or `deprecated (no reader; dropped in a later
cleanup)`. This batch makes `hours`, `holidayClosures`, `socialLinks` and `logoUrl` editable (profile section) and
rendered (footer; contact page; printed documents for `logoUrl`). `announcementBannerText/On`, `inspectionChecklist`,
`taxRatePermille` are `deprecated` (`earlyReturnProrationBasis` is read again by Batch B2's early-return rule, so it is `editable (terms)`). Nothing is dropped from the schema here.

**D3. The money workspace and reports are read-only views of the ledger. No new money math.** (O18/O19.) Every
report number is declared once as a `MetricDefinition` and the screen prints its definition beside it: date basis
(Colorado calendar), calculation, actual vs estimated, source records, and a drill-through link. Unknown cost shows
as "unknown", never as profit. (changed 2026-10-05: no "ROI" label exists on any screen any more, so the rename is
only a guard test.)

**D4. Customer ending/renewal screens are consent surfaces over B and B2 functions, using each agreement's own
frozen terms.** (B34–B36, O20.) Fixed term: the early-ending quote (`getEarlyTerminationQuote`) and auto-renew on/off
(`setAutoRenew`) appear only when the agreement's `termsSnapshot` has that section; otherwise "Not available for
this rental — contact us". Month-to-month: B2's "End my rental". The customer always sees the quote (ending date,
last billed day, fee, unused prepaid amount and that the owner settles it, pickup to be arranged) before one confirm
button; the confirm sends back the quote it showed and is refused if anything changed. Nothing auto-charges. The
portal never shows current system-wide terms for a signed agreement.

**D5. Deposit, refund and credit decisions are OWNER/ADMIN forms over existing functions**
(`decideDepositRefund`, `issueInvoiceRefund`, `applyCreditToInvoice`), each with amount + reason, a confirmation that
repeats the amount in words, and afterwards the provider operation's state (from `ProviderOperation`). STAFF cannot
load these screens (server-side role check; a hidden link is not protection). Deposit liability (B03) is a query over
`Deposit`: amount − refunded per customer/agreement, age buckets 0–30/31–90/>90 days since the agreement ended, and a
">90 days" flag; refunds always resolve the rail through `resolveDepositRefundRail`.

**D6. Evidence artifacts are frozen input + frozen HTML produced by a pure renderer, stored in the database, private
and reproducible.** (RC11.) **(changed 2026-10-05:** signing is in-house — A7 — so there is no provider PDF to copy;
the bytes-in-blob-store part of the old design is removed.) New `DocumentArtifact` keeps, per document version: the
render input as JSON (`payload`), the HTML (`html`) produced by a pure string renderer in
`src/domains/documents/render.ts` (no React, no clock, no settings read), and its `sha256`. "Reproducible" = rendering
`payload` again gives the same hash (a test). Artifacts are created:
- **Signed agreement:** inside `signAgreement`'s transaction (payload: agreement terms snapshot, lines with prices,
  tax rate, deposit, waiver, signer name/email/IP, `signedAt`, business name/contact as of signing, the exact terms
  text shown on the signing page). Signing fails if the artifact cannot be written.
- **Invoice:** once it reaches a final state (PAID, VOID, WRITTEN_OFF, REFUNDED) — by a bounded nightly sweep
  `freezeFinalInvoiceArtifacts(limit 200)` in the `billing-reconcile` cron, and on first download. A later change to a
  frozen invoice makes version 2, never edits version 1.
- **Statement:** a customer's statement for a finished Colorado month, on first download after that month ends.
Downloads (`/api/documents/[id]`) serve the stored HTML (OWNER/ADMIN, or the customer who owns the subject). PDF
generation is not built (no renderer dependency without an owner decision); the browser's print-to-PDF of the
stored HTML is the download path. The desk's existing React invoice/print views stay as they are.

**D7. The inspection checklist editor only adds versions.** Batch C created `InspectionChecklistVersion`; D adds
`publishChecklistVersion` and the editor. Editing never changes past inspections.

**D8. Privacy requests are a tracked workflow that never destroys required evidence.** `PrivacyRequest` (kind
`EXPORT | DELETE`). Intake: a signed-in customer is verified by session; a public requester gets an emailed single-use
link **through `sendCustomerEmail`** (changed 2026-10-05: so the owner email switch governs it); when that returns
anything but SENT the request stays `RECEIVED` with "verify by phone" for the owner. Fulfilment is by OWNER only:
*export* = JSON of the customer's own rows from a fixed table list; *delete* = pseudonymize personal fields on `User`,
`Customer`, `ServiceAddress`, `CustomerContact`, `Lead` (name → "Deleted customer", email → `deleted-<id>@invalid`,
phone/address lines → null), archive the user, revoke sessions, delete private photos tied only to that customer's
maintenance requests; **keep** invoices, payments, receipts, refunds, credits, signatures, `DocumentArtifact`s,
`CustomerNotice`s and audit rows (financial/legal retention). Rules in `docs/runbooks/PRIVACY-REQUESTS.md` (new).

**D9. Legal pages are gated.** `BusinessSettings.legalApprovals Json` =
`{ privacy?: { version, approvedOn, approvedBy }, terms?: {…} }`. Until a page's approval matches its
`LEGAL_PAGE_VERSION` constant, the page renders `<meta name="robots" content="noindex">`, keeps its draft notice and
is removed from `PUBLIC_ROUTES` in `sitemap.ts` and from the footer's "final" links. (P8 M7, IN-07.)

**D10. No new roles.** OWNER/ADMIN/STAFF stay; IN-13 is not triggered.

## 2. Schema changes (additive) — migration `20261007010000_batch_d_control_plane`

```prisma
enum RevisionStatus { DRAFT PUBLISHED ARCHIVED }

model SiteContentRevision {             // D1
  id                String         @id @default(cuid())
  status            RevisionStatus @default(DRAFT)
  version           Int            @unique   // monotonically increasing
  fields            Json           // { [key]: string } — whitelisted keys only
  note              String?
  createdByUserId   String
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  publishedAt       DateTime?
  publishedByUserId String?
  restoredFromId    String?        // when this revision republishes an older one
  @@index([status, publishedAt])
}

model SiteContentPointer {              // D1 — one row, id "published"
  id                  String   @id @default("published")
  publishedRevisionId String?
  updatedAt           DateTime @updatedAt
}

enum DocumentArtifactKind { SIGNED_AGREEMENT INVOICE STATEMENT }

model DocumentArtifact {                // D6
  id                String               @id @default(cuid())
  kind              DocumentArtifactKind
  subjectType       String               // "RentalAgreement" | "Invoice" | "CustomerStatement"
  subjectId         String               // statement: "<customerId>:<YYYY-MM>"
  customerId        String               // owner of the document, for access checks
  version           Int                  @default(1)
  payload           Json
  html              String
  sha256            String
  rendererVersion   Int                  // bump when render.ts output changes on purpose
  generatedAt       DateTime             @default(now())
  generatedByUserId String?
  @@unique([kind, subjectType, subjectId, version])
  @@index([customerId])
}

enum PrivacyRequestKind   { EXPORT DELETE }
enum PrivacyRequestStatus { RECEIVED VERIFIED FULFILLED REJECTED }

model PrivacyRequest {                  // D8
  id                    String               @id @default(cuid())
  kind                  PrivacyRequestKind
  status                PrivacyRequestStatus @default(RECEIVED)
  customerId            String?
  requesterEmail        String
  verificationTokenHash String?              // sha256 of the single-use token
  verificationExpiresAt DateTime?
  verifiedAt            DateTime?
  fulfilledAt           DateTime?
  fulfilledByUserId     String?
  rejectedReason        String?
  notes                 String?
  createdAt             DateTime             @default(now())
  @@index([status, createdAt])
  @@index([customerId])
}

model BusinessSettings {
  legalApprovals Json @default("{}")    // D9
}
```
Every new table: `BACKUP_MODEL_POLICY`, schema-health list, `docs/DATABASE.md`. (`InspectionChecklistVersion` already
exists — do not add it.)

## 3. Work units (in order; PR stack: [D1–D4] → [D5–D6] → [D7–D9] → [D10–D12])

### WU-D1 — Schema, backup, health, `docs/SETTINGS-COVERAGE.md`
Section 2. The coverage document is written by reading `prisma/schema.prisma` model `BusinessSettings` line by line
(every column, including those added by B2), not from memory. Test: backup export contains the four new tables;
migration upgrade drill passes.

### WU-D2 — Site content fields, revisions, public reader (D1)
Closes: O22, P7 H1.
Files: `src/domains/site-content/{fields.ts,index.ts}` (new); every `src/app/(public)/**` page whose copy becomes a
field reads `getPublishedContent()`; `tests/site-content.test.ts`, `tests/site-content-integration.test.ts`.
```ts
export const SITE_FIELDS: ReadonlyArray<{ key: string; label: string; help: string;
  kind: "short" | "paragraph" | "url" | "alt" | "meta"; page: string; section: string;
  ownerInput?: "IN-05" | "IN-06" | "IN-11"; default: string }>;
export async function getPublishedContent(): Promise<Record<string, string>>;   // defaults for missing keys; React cache() per request
export async function getRevisionContent(revisionId: string): Promise<Record<string, string>>; // caller has checked OWNER/ADMIN
export async function saveDraft(userId: string, input: { draftId?: string; expectedVersion?: number;
  fields: Record<string, string>; note?: string }): Promise<{ draftId: string; version: number }>;
export async function publishDraft(userId: string, draftId: string, expectedVersion: number): Promise<{ revisionId: string; version: number }>;
export async function restoreRevision(userId: string, revisionId: string): Promise<{ newRevisionId: string }>;
```
Rules: actor OWNER/ADMIN re-checked inside each transaction (`assertActiveTeamActor`); unknown key → reject; length by
kind; strip `<>`; `url` must start with `https://`; publish locks the pointer row (`SELECT … FOR UPDATE`), sets
PUBLISHED, archives the previous published revision, moves the pointer, writes an audit row; a stale
`expectedVersion` → "Someone else changed this draft. Reload to see their changes."
Field list for the first release: home hero heading and sub-heading, "how it works" three steps (heading + paragraph
each), FAQ (up to 8 question/answer pairs as numbered keys `faq.1.q` … `faq.8.a`), property-manager paragraph,
contact-page intro, alt text for each image in `public/appliances`, and SEO title/description per public page. Every
default is the exact text the page shows today (copy it from the page source).
Tests: unknown key rejected; HTML stripped; publish moves pointer and archives old; restore creates a new version with
the same fields and `restoredFromId`; the public reader never returns draft text; (integration) two concurrent
publishes → one wins, pointer consistent; STAFF refused.

### WU-D3 — Website editor screen (O23)
Files: `src/app/desk/settings/website/**` (replaces the links-only "website" section), preview handling in
`src/app/(public)/layout.tsx`, `e2e/owner-portal-workspaces.spec.ts` (extend; group `browser-a`).
Spec: one form grouped by page and section; each field shows its label, help sentence and character count; image-alt
fields beside a thumbnail; fields with `ownerInput` show "Needs your decision (IN-05)" and stay at their default until
the owner edits them; "Preview" opens the public page with `?revision=`; "Publish" asks for confirmation naming what
changes; "History" lists revisions with who/when and "Restore this version". Household and property-manager pathways
are present as fields. Nothing about opening dates, free delivery or testimonials is added to defaults.
Tests (browser): save draft → preview shows draft → public page still shows the old text → publish → public updated;
axe clean at 360 and 1440, light and dark.

### WU-D4 — Settings coverage (O21, D2)
Files: `src/domains/settings/section-config.ts` (add `hours`, `holidayClosures`, `socialLinks`, `logoUrl` to
`profile`), `src/domains/settings/form-schema.ts` (validation: hours = 7 days × {closed | open "HH:MM"–"HH:MM"};
closures = list of `YYYY-MM-DD` + label, max 30; social = `facebook | instagram | google | nextdoor` → https URL;
logo = an https URL or one of the files already in `public/brand/` (`logo-light.svg`, `logo-dark.svg`, `mark.svg`)), `src/app/desk/settings/**`
(form and explanations), `src/components/site/footer.tsx` and the contact page (render hours, closures, social),
`tests/settings-sections.test.ts` (extend: unrelated-field preservation and unauthorized save already exist — add the
new fields).
Rules: secrets are never fields; saving one section cannot touch another; deprecated fields are rendered nowhere.

### WU-D5 — Money workspace (O18, D3, D5)
Files: `src/app/desk/billing/page.tsx` (tabs: Balances · Waiting for Stripe · Deposits · Held payments (link) ·
Reconciliation (link)), `src/domains/billing/deposit-liability.ts` (new query), decision forms on the invoice and
agreement pages calling `decideDepositRefund`, `issueInvoiceRefund`, `applyCreditToInvoice`; B2's late-return waiver
form is already on the job page — link to it from the invoice; `tests/billing-deposit-liability.test.ts`,
`tests/billing-money-screens-access.test.ts` (STAFF gets a 403/redirect for every route and action listed here).
"Waiting for Stripe" lists `ProviderOperation` rows in PENDING/UNKNOWN/FAILED and `SubscriptionEndIntent` rows not yet
applied, each with its plain-English meaning and the link to the reconciliation workbench (read-only; no retry button
— retries are the nightly pass).
Rules: refunds/deposits never counted as rent (`categories.ts`); amounts in integer cents through existing helpers.

### WU-D6 — Report definitions and drill-through (O19, D3)
Files: `src/domains/reports/definitions.ts` (new):
```ts
export type MetricDefinition = { key: string; label: string; dateBasis: string; calculation: string;
  kind: "ACTUAL" | "ESTIMATE"; sources: string[]; drillHref: (params: Record<string, string>) => string };
export const METRICS: Record<string, MetricDefinition>;
```
Every number on `desk/reports`, `desk/revenue`, `desk/fleet` and `desk/growth` takes its label and the small "How this is
counted" text from `METRICS`. Missing parts/labour cost shows "unknown" and the row is excluded from totals that claim
profit. Test `tests/reports-definitions.test.ts`: a fixture with known invoices (one refunded, one unpaid, one written
off, one late-return with a waiver) reconciles every metric to its source rows; a guard test fails if any `src/app` file
contains the word "ROI".

### WU-D7 — Inspection checklist editor (D7)
Files: `src/domains/inventory/checklist-versions.ts` (`publishChecklistVersion(userId, items: string[]): Promise<{ versionId: string; version: number }>`;
OWNER/ADMIN; 1–40 items, each 2–200 chars, de-duplicated; hash = `checklistHash(items)` from `src/domains/inventory/guided-actions.ts`, version = current highest + 1 inside a transaction that locks the newest row),
`src/app/desk/settings/policies/**` (editor with current version, history, and "this only affects inspections from now
on"), `tests/inspection-integration.test.ts` (extend: an inspection keeps its own version after a new one is published;
a stale `expectedChecklistVersionId` is refused).

### WU-D8 — Customer portal completion (O20, D4)
Files: `src/app/account/{page,rentals,maintenance,billing,settings}/**`, `src/domains/portal/index.ts`,
`tests/portal-*.test.ts`, `e2e/accessibility-authenticated.spec.ts` (cover every new page/state).
Rules: task-first layout per DESIGN.md §6 "Customer portal"; per-agreement section shows status in words, next visit,
items, monthly total, the agreement's own terms (from `describeSnapshotTerms` for fixed terms; month-to-month terms
from `effectiveMonthToMonthTerms`), and the D4 actions. A SCHEDULED renewal shows as "Renewal starts on <date>". An
ending in progress shows "Ends on <date> — last billed day <date>". Identity always from the session; `getPortalData`
reads are bounded (latest 20 jobs, 20 maintenance requests, with "show more" pages) and selected through a DTO
whitelist (no staff notes, no internal task text, no cost fields). Tests: customer A cannot read or act on B's agreement,
request, invoice, document or privacy request (each through URL, action and download route); DTO whitelist test lists
the exact keys returned.

### WU-D9 — Evidence artifacts (D6)
Files: `src/domains/documents/{render.ts,artifacts.ts}` (new), `signAgreement` (create the SIGNED_AGREEMENT artifact
in its transaction), `freezeFinalInvoiceArtifacts` in the `billing-reconcile` cron, `src/app/api/documents/[id]/route.ts`
(new; `Content-Type: text/html`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`), download links on the
desk agreement/invoice pages and the portal.
```ts
export const RENDERER_VERSION = 1;
export function renderSignedAgreement(payload: SignedAgreementPayload): string;   // pure
export function renderInvoice(payload: InvoicePayload): string;                     // pure
export function renderStatement(payload: StatementPayload): string;                 // pure
export async function createSignedAgreementArtifactInTx(tx: Prisma.TransactionClient, agreementId: string): Promise<string>;
export async function freezeInvoiceArtifact(invoiceId: string): Promise<string | null>;   // null when not final
export async function statementArtifact(customerId: string, month: string /* YYYY-MM */): Promise<string>; // refuses the current or a future month
export async function readArtifactForViewer(artifactId: string, viewer: { userId: string; role: string }): Promise<{ html: string; filename: string } | null>;
```
Renderer output: semantic HTML with `lang="en"`, a print stylesheet inline, the Evergreen colours as literal hex
values (no CSS variables — it must render the same anywhere), business name/contact from the payload, money through
`formatCents`, dates through `formatBusinessDate`.
Tests (`tests/documents-artifacts.test.ts`): render the same payload twice → same sha256; changing a setting after
signing does not change the artifact; signing rolls back if the artifact insert fails; customer A cannot download B's
artifact; STAFF cannot download invoice/statement artifacts; a frozen invoice that later changes gets version 2.

### WU-D10 — Privacy requests (D8)
Files: `src/domains/privacy/index.ts` (new), portal page `src/app/account/settings/privacy/**`, public intake on
`src/app/(public)/privacy/` (a small form under the policy), `src/app/desk/privacy/**` (OWNER), `docs/runbooks/PRIVACY-REQUESTS.md`.
```ts
export async function openPrivacyRequest(input: { kind: "EXPORT" | "DELETE"; email: string; customerId?: string; ipKey: string }):
  Promise<{ requestId: string; verification: "SESSION" | "EMAIL_SENT" | "OWNER_WILL_CALL" }>;
export async function verifyPrivacyRequest(requestId: string, token: string): Promise<void>;
export async function buildPrivacyExport(userId: string, requestId: string): Promise<Buffer>;   // OWNER; JSON; fixed table list
export async function fulfillPrivacyDeletion(userId: string, requestId: string, confirmation: "DELETE"):
  Promise<{ pseudonymized: string[]; retained: string[] }>;
export async function rejectPrivacyRequest(userId: string, requestId: string, reason: string): Promise<void>;
```
Public intake is rate-limited with `isRateLimited(\`privacy:\${ip}\`, { max: 5, windowMs: 3_600_000 })` and always answers
the same neutral message (never reveals whether the email exists). Token: 32 random bytes, stored as sha256, 48-hour
expiry, single use.
Tests (`tests/privacy-requests.test.ts`, real Postgres for deletion): export contains only the customer's own rows;
deletion pseudonymizes the listed fields, keeps invoices/payments/signatures/artifacts/notices/audit, revokes sessions;
a second deletion is a no-op; an expired or reused token is refused; the public form gives the same response for a
known and an unknown email; rate limit enforced.

### WU-D11 — Legal page gate (D9)
Files: `src/app/(public)/{privacy,terms}/page.tsx` (export `LEGAL_PAGE_VERSION` per page; `generateMetadata` adds
`robots: { index: false }` until approved), `src/app/sitemap.ts` (drop unapproved pages), footer links, Settings →
Rental policies: "Legal page approval" (OWNER only: page, version shown, date, approver name — a record, not legal
advice), `tests/legal-gate.test.ts` (noindex and absent from sitemap when unapproved or when the version moved on;
indexed and listed when the approved version matches).

### WU-D12 — Batch C leftovers, business-audit items, docs, PR
- Part movement history screen (C leftover): `src/app/desk/parts/[id]/page.tsx` (new) — the part's `PartStockMovement`
  rows newest first, paginated (stable `[createdAt desc, id desc]`), each with kind, quantity, the job or order link,
  who and when; "Undo" stays only where Batch C put it (job page).
- Business-audit frontend items B03, B06, B08, B09, B13, B19, B21, B23, B24, B28, B30, B34–B36: map each to a WU above
  in the PR's disposition table; any item no WU covers → stop and ask (do not invent a screen).
- Docs: `OWNER-GUIDE.md` (website editor, settings, money decisions, documents, privacy requests), `BUSINESS-RULES.md`
  (legal gate, privacy retention, artifact rules), `DATABASE.md`, `OWNER-INPUTS.md` (IN-07 approval entries; a new
  optional input "PDF documents" if Chris wants real PDFs later), `CHANGES-SINCE-DESIGN.md` (what E/E2/F must know),
  `STATUS.md`, `GO-LIVE-CHECKLIST.md` (legal page approval line).

## 4. Stop-and-ask
1. Any section 0 row is false.
2. A public (not signed-in) privacy request in production would need an email while customer email is off — the
   design falls back to "owner will call"; any other behaviour is Chris's decision.
3. Any request to publish legal text, opening dates, free-delivery claims or testimonials (owner inputs).
4. Real PDF generation (adds a dependency; owner decision).
5. A business-audit item that no work unit covers.

## 5. Acceptance mapping
| PLAN D line | Evidence |
|---|---|
| Owner changes every Class-A setting without code | WU-D4 tests + browser check |
| Public site reads published content only | WU-D2 tests |
| Preview / publish / restore keep exact version and actor | WU-D2 integration + WU-D3 browser |
| Settings/contract changes never rewrite signed evidence | WU-D9 tests |
| Customer A/B isolation (agreement, privacy request, document) | WU-D8, WU-D9, WU-D10 tests |
| Signed artifacts private, reproducible, downloadable, backed up | WU-D9 tests; backup test in WU-D1 |
| Privacy deletion keeps financial/signature/audit evidence | WU-D10 tests |
| Secrets never visible | WU-D4 rule + existing provider-status test |
| Reports reconcile; unknown cost never profit | WU-D6 tests |
| Unrelated-field preservation; unauthorized save refused | `tests/settings-sections.test.ts` |

## Amendments
(Dated entries only.)
