# Design — Batch D: Owner/customer control plane, website, evidence & privacy

Status: **APPROVED DESIGN — implement from this document** (written
2026-10-02 against `main` f272f51; Batches B and C land first). Scope and
acceptance: `docs/PLAN.md` → Batch D. Screen specs: `docs/plans/overhaul/DESIGN.md`
§6 "Money and reporting", "Customer portal", "Owner configuration and website".

## 0. Verify before starting

| # | Assumption | Check |
|---|---|---|
| A1 | B and C are merged; STATUS says D is NEXT. | `docs/STATUS.md` |
| A2 | Batch B shipped `ProviderOperation`, `Receipt`, `CreditApplication`, the term/renewal functions in `src/domains/agreements/term.ts`, `collectedBetween` in `src/domains/billing/categories.ts`, and the deposit/invoice refund functions (WU-B7b). | grep each name. If any is missing, stop: D depends on them. |
| A3 | `SiteContent` is still a flat key/value table with **no reader in `src/`**. | `grep -rn "siteContent" src` returns nothing. (P7 H1) |
| A4 | `BusinessSettings` still has dormant fields `hours`, `holidayClosures`, `socialLinks`, `logoUrl`, `announcementBannerText/On`, `inspectionChecklist`, and `SETTINGS_FIELDS` in `src/domains/settings/section-config.ts` lists what is editable. | schema + file. (P7 H3) |
| A5 | Settings saves go through `settingsSectionUpdate` with per-section field whitelists and an atomic audit (shipped in #130). | `src/domains/settings/sections.ts`. Reuse; do not write a second save path. |
| A6 | Private photo storage exists (`src/lib/photo-storage.ts`: `getPrivatePhotoStore`, `privatePhotoReadPath`) and reads are authenticated (Batch A). | file. |
| A7 | Public routes are `src/app/(public)/{accessibility,contact,how-it-works,launch,pricing,privacy,rent,service-area,terms}`; `privacy` and `terms` carry a "draft, pending legal review" notice. | ls + grep "pending". |
| A8 | `SignatureRecord.signedPdfUrl` is a provider URL, not a stored copy. | schema. |
| A9 | Reports live in `src/domains/reports/{earnings,accounting-export,index}.ts` and `src/app/desk/reports`. | ls. |

## 1. Decisions

**D1. Website content = bounded, whitelisted fields in linear revisions; the public site reads exactly one published revision.** (O22/O23, P7 H1.) The field list is code (`src/domains/site-content/fields.ts`): each entry has `key`, `label`, `kind` (`short` ≤ 120 chars · `paragraph` ≤ 2,000 · `url` · `alt` ≤ 160 · `meta` ≤ 160), the page and section it renders in, and a default. Values are plain text: strip every `<`/`>` on save; no markdown, no HTML, no scripts. Prices are never a field (they come from the catalog). A revision is immutable once published; "rollback" publishes a *new* revision copying an old one, so history is a straight line and the published pointer only ever moves forward in time. Drafts are invisible to the public. Preview renders the real public page with `?revision=<id>`, allowed only for an OWNER/ADMIN session.

**D2. Every `BusinessSettings` column gets exactly one disposition, written down.** (O21, P7 H3.) `docs/SETTINGS-COVERAGE.md` (new) lists each column as `editable (section)`, `displayed read-only (where)`, or `deprecated (no reader; do not use; dropped in a later batch)`. This batch makes `hours`, `holidayClosures`, `socialLinks`, `logoUrl` editable and *rendered* (footer, documents); `announcementBanner*` and the old `inspectionChecklist` text field become `deprecated` (launch controls and the checklist editor in D7 replace them). Nothing is dropped from the schema here.

**D3. The money workspace and reports are read-only projections of Batch B's ledger. No new money math in D.** (O18/O19.) Every report metric is declared as a `MetricDefinition` object and the UI prints the definition next to the number: date basis (business calendar), calculation, actual-vs-estimated, source records, drill-through link. "ROI" is renamed "conversion" unless real spend attribution exists (it doesn't). Unknown cost is shown as "unknown", never as profit.

**D4. Customer renewal / cancellation / auto-renew are consent surfaces over Batch B's domain functions, hidden until the owner policy exists.** (B34–B36, O20.) If `loadTerminationPolicy()` returns null, the portal shows "Not available yet — contact us" for cancellation and the section is not interactive; same for auto-renew without `autoRenewTermsVersion`. The customer sees the quote (effective date, remaining obligation, fee, credits/refunds, pickup requirement) *before* a single confirm button; confirmation calls `requestEarlyTermination` with the quote it was shown, which re-quotes and rejects if anything changed. Nothing auto-cancels or charges. Consent text version is stored with the action.

**D5. Deposit/refund/dispute decisions are OWNER/ADMIN forms over Batch B's functions (`decideDepositRefund`, `issueInvoiceRefund`), with amount + reason confirmation and the provider operation shown afterwards.** STAFF cannot see these screens. The deposit-liability view (B03) is a query over `Deposit` rows: collected − refunded per customer/agreement with age buckets and a ">90 days" flag.

**D6. Evidence artifacts are frozen data + a stored copy of provider bytes; reproducible, private, exportable.** (RC11.) New `DocumentArtifact` stores, per signed agreement / invoice / statement: the exact render input as JSON (`payload`), the rendered HTML (`html`), `sha256`, and — for the signed agreement — the provider's PDF bytes copied into the private store (`storagePath`). "Reproducible" means re-rendering `payload` through the same component yields the same `html` hash; a test proves it. PDF generation of invoices/statements is **not** in this batch (no renderer dependency is added without an owner decision — IN-20); the print view remains the download path. Artifacts are created at the moments that matter: agreement signed (webhook or callback), invoice becomes PAID or is sent, statement generated. Backup export includes `DocumentArtifact` rows and the private-store inventory (P6 H5 is addressed fully in Batch F's recovery drill; here we only make the bytes exist and be listed).

**D7. The inspection checklist becomes owner-editable with versions; Batch C's `checklistVersion` points at them.** `InspectionChecklistVersion { id, items Json, version Int, publishedAt, publishedByUserId }`; publishing creates a new version; C7's `recordInspection` snapshots the current version's hash. Editing never changes past inspections.

**D8. Privacy requests are a tracked workflow with identity verification and evidence-preserving fulfillment.** `PrivacyRequest` (kind `EXPORT | DELETE`). Intake: a signed-in customer is verified by session; a public requester gets an emailed single-use token (uses the existing Resend transactional path — allowed; it is not marketing — but **only if** email sending is enabled in that environment; otherwise the request is recorded as `RECEIVED` with "verify by phone" for the owner). Fulfillment is manual by OWNER: *export* = JSON of the customer's own records from a fixed list; *delete* = pseudonymize personal fields on `User`, `Customer`, `ServiceAddress`, `CustomerContact`, `Lead` (`name → "Deleted customer"`, `email → deleted-<id>@invalid`, phone/address → null), archive the user, revoke sessions, delete photos tied only to that customer's maintenance requests; **keep** invoices, payments, receipts, refunds, signatures, audit rows and the `DocumentArtifact`s (legal/financial retention). The retention and legal-hold rules go in `docs/runbooks/PRIVACY-REQUESTS.md`.

**D9. Legal pages are gated.** `BusinessSettings.legalApprovals Json` = `{ privacy: { version, approvedOn, approvedBy }, terms: {...} }`. Until a page's approval exists and matches the page's `LEGAL_PAGE_VERSION` constant, it renders `<meta name="robots" content="noindex">`, keeps the draft notice, and is excluded from the sitemap and footer "final" links. (P8 M7, IN-07.)

**D10. No new roles.** OWNER/ADMIN/STAFF stay; IN-13 is untriggered.

## 2. Schema changes (additive)

```prisma
enum RevisionStatus { DRAFT PUBLISHED ARCHIVED }

model SiteContentRevision {            // D1
  id              String         @id @default(cuid())
  status          RevisionStatus @default(DRAFT)
  version         Int            // monotonically increasing; unique
  fields          Json           // { [key]: string } — only whitelisted keys
  note            String?
  createdByUserId String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  publishedAt     DateTime?
  publishedByUserId String?
  rolledBackFromId String?       // when this revision republishes an older one
  @@unique([version])
  @@index([status, publishedAt])
}

model SiteContentPointer {             // D1 — singleton, id "published"
  id                  String @id @default("published")
  publishedRevisionId String?
  updatedAt           DateTime @updatedAt
}

model InspectionChecklistVersion {    // D7
  id                String   @id @default(cuid())
  version           Int      @unique
  items             Json     // string[]
  hash              String   // = Batch C checklistVersion(items)
  publishedAt       DateTime @default(now())
  publishedByUserId String
}

enum DocumentArtifactKind { SIGNED_AGREEMENT INVOICE STATEMENT }

model DocumentArtifact {               // D6
  id            String               @id @default(cuid())
  kind          DocumentArtifactKind
  subjectType   String               // "RentalAgreement" | "Invoice" | "Customer" (statement)
  subjectId     String
  version       Int                  @default(1)
  payload       Json                 // frozen render input
  html          String               // rendered document
  sha256        String               // of html
  storagePath   String?              // private store path of provider PDF bytes (signed agreements)
  byteSize      Int?
  contentType   String?
  generatedAt   DateTime             @default(now())
  generatedByUserId String?
  @@unique([kind, subjectType, subjectId, version])
  @@index([subjectType, subjectId])
}

enum PrivacyRequestKind   { EXPORT DELETE }
enum PrivacyRequestStatus { RECEIVED VERIFIED FULFILLED REJECTED }

model PrivacyRequest {                 // D8
  id                String               @id @default(cuid())
  kind              PrivacyRequestKind
  status            PrivacyRequestStatus @default(RECEIVED)
  customerId        String?
  requesterEmail    String
  verificationTokenHash String?        // sha256 of the single-use token
  verificationExpiresAt DateTime?
  verifiedAt        DateTime?
  fulfilledAt       DateTime?
  fulfilledByUserId String?
  rejectedReason    String?
  notes             String?
  createdAt         DateTime             @default(now())
  @@index([status, createdAt])
  @@index([customerId])
}

model BusinessSettings {
  legalApprovals Json @default("{}")   // D9
}
model RentalAgreement { artifacts DocumentArtifact[] @relation("AgreementArtifacts") }  // optional relation; may be omitted if you use subjectType/subjectId only
```

## 3. Work units

### WU-D1 — Schema, health, backup, `docs/SETTINGS-COVERAGE.md`
Section 2; the coverage document lists every `BusinessSettings` column with its disposition (D2) — write it by reading the schema, not from memory.

### WU-D2 — Site content fields, revisions, public reader (D1)
Closes: O22, P7 H1.
Files: `src/domains/site-content/{fields.ts,index.ts}` (new), `src/app/(public)/**` (replace hard-coded copy for the whitelisted fields with `getPublishedContent()`), `tests/site-content.test.ts`, `tests/site-content-integration.test.ts`.
```ts
export const SITE_FIELDS: ReadonlyArray<{ key: string; label: string; kind: "short"|"paragraph"|"url"|"alt"|"meta"; page: string; section: string; default: string }>;
export async function getPublishedContent(): Promise<Record<string, string>>;         // cached per request; defaults for missing keys
export async function getRevisionContent(revisionId: string): Promise<Record<string,string>>; // OWNER/ADMIN preview only (caller checks role)
export async function saveDraft(userId, input: { draftId?: string; expectedVersion?: number; fields: Record<string,string>; note?: string }): Promise<{ draftId; version }>;
export async function publish(userId, draftId: string, expectedVersion: number): Promise<{ revisionId; version }>;
export async function rollbackTo(userId, revisionId: string): Promise<{ newRevisionId }>;  // copies fields into a new PUBLISHED revision
```
Validation: unknown key → reject; length by kind; strip `<>`; `url` must be https. Publish: tx locks the pointer row, sets status PUBLISHED, archives the previously published revision, moves the pointer, audits. Version conflict → "someone else edited this draft".
Tests: unknown key rejected; HTML stripped; publish moves pointer and archives old; rollback creates new version with same fields and `rolledBackFromId`; public reader never returns draft values; (integration) two concurrent publishes → one wins, pointer consistent.

### WU-D3 — Website editor UI (O23)
Files: `src/app/desk/settings/website/**`, preview query handling in public layout, `e2e/owner-portal-workspaces.spec.ts` (extend; lightest shard).
Spec: one form grouped by page/section with labels and helper text, image-alt fields beside images, "Preview" (opens public page with `?revision=`), "Publish" with confirm, history list with "Restore this version". Household and property-manager pathways present in the copy fields. Guard rails in copy: no opening date, "free delivery" or testimonials unless the matching IN-05/IN-06/IN-11 is answered (the editor shows the input ID next to those fields). No personal address inference.
Tests: browser: save draft → preview shows draft → public page still shows old → publish → public updated; axe.

### WU-D4 — Settings IA completion (O21, D2)
Files: `src/domains/settings/section-config.ts` (add fields: `hours`, `holidayClosures`, `socialLinks`, `logoUrl` under the right sections), `src/domains/settings/form-schema.ts`, `src/app/desk/settings/**`, footer/document renderers that consume them, `tests/settings-sections.test.ts` (unrelated-field preservation + unauthorized negative test already exist — extend).
Rules: secrets are never fields; saving one section cannot touch another (existing whitelist); deprecated fields are not rendered anywhere.

### WU-D5 — Money workspace completion (O18, D3, D5)
Files: `src/app/desk/billing/**` (balances, pending/failed sync from `ProviderOperation`, deposits liability, invoice history), `src/domains/billing/deposit-liability.ts` (new query), decision forms calling `decideDepositRefund` / `issueInvoiceRefund` / `applyCreditToInvoice`, `tests/billing-deposit-liability.test.ts`.
Rules: refunds/deposits never counted as rent (use `categories.ts`); OWNER/ADMIN only (loader test); STAFF 403.

### WU-D6 — Reporting definitions and drill-through (O19, D3)
Files: `src/domains/reports/definitions.ts` (new: `MetricDefinition` list), `src/domains/reports/*.ts` (attach definitions, rename ROI → conversion, missing-cost flags), `src/app/desk/reports/**`, `tests/reports-definitions.test.ts` (fixture with known values incl. refunds/unpaid reconciles to source records).

### WU-D7 — Inspection checklist editor (D7)
Files: `src/domains/inventory/checklist-versions.ts`, `src/app/desk/settings/policies/**`, update C7's `recordInspection` to read the latest published version (fallback to `DEFAULT_INSPECTION_CHECKLIST` when none), `tests/inventory-inspection.test.ts` (extend: editing after an inspection does not change it).

### WU-D8 — Customer portal completion (O20, D4)
Files: `src/app/account/{rentals,maintenance,billing}/**`, `src/domains/portal/*`, `tests/portal-*.test.ts`, `e2e/accessibility-authenticated.spec.ts` (extend coverage to new pages).
Rules: task-first layout; renewal/cancel/auto-renew sections per D4; identity always from the session (never from a URL id); A/B isolation tests for agreement, request, document, privacy request; no staff notes exposed (DTO whitelist test).

### WU-D9 — Evidence artifacts (D6)
Files: `src/domains/documents/artifacts.ts` (new), hooks at: signature completion (wherever `SignatureRecord.signedAt` is set), invoice PAID (webhook tx, after B's receipt), statement generation; download route `src/app/api/documents/[id]/route.ts` (auth: OWNER/ADMIN, or the owning customer), `tests/documents-artifacts.test.ts` (reproducibility: render payload twice → same sha256; customer A cannot download B's; artifact unchanged after settings/contract edits).
Signed PDF copy: fetch `signedPdfUrl` server-side once, write to the private store under `documents/agreements/<id>/signed-v<n>.pdf`, record size/sha. Failure to fetch → artifact row with `storagePath null` and a `ProviderOperation`-style retry is **not** built; instead a StaffTask "signed PDF copy failed" is created (same C1 pattern).

### WU-D10 — Privacy requests (D8)
Files: `src/domains/privacy/index.ts` (new), portal + public intake forms, `src/app/desk/privacy/**` (OWNER), `docs/runbooks/PRIVACY-REQUESTS.md` (new), `tests/privacy-requests.test.ts`.
```ts
export async function openRequest(input: { kind; email; customerId?: string /* when session-verified */ }): Promise<{ requestId; needsEmailVerification: boolean }>;
export async function verifyByToken(requestId, token): Promise<void>;
export async function buildExport(requestId): Promise<Buffer>;   // JSON; fixed table list; no secrets, no other customers' data
export async function fulfillDeletion(userId, requestId, confirmation: "DELETE"): Promise<{ pseudonymized: string[]; retained: string[] }>;
```
Tests: export contains only the customer's own rows; deletion pseudonymizes the listed fields, keeps invoices/payments/signatures/artifacts/audit, revokes sessions; a second deletion is a no-op; public intake rate-limited via Batch A's limiter.

### WU-D11 — Legal page gate (D9)
Files: `src/app/(public)/{privacy,terms}/page.tsx`, `src/app/sitemap.ts` (if present), settings "policies" section (approval record entry: version, date, approver — a text record, not legal advice), `tests/legal-gate.test.ts` (noindex when unapproved; indexed when approved version matches).

### WU-D12 — C's supplier/part/history screens; B-register frontend items; docs; PR
Screens C needs: supplier archive, part movements, PO partial receive. B-register frontend items B03, B06, B08, B09, B13, B19, B21, B23, B24, B28, B30, B34–B36: map each to a WU above in the PR disposition. Docs: `OWNER-GUIDE.md` (website editor, settings, money decisions, privacy requests), `BUSINESS-RULES.md` (legal gate, privacy retention), `DATABASE.md`, `OWNER-INPUTS.md` (IN-20 PDF renderer decision — optional; IN-07 approval entries), `STATUS.md`.

## 4. Stop-and-ask
1. Any Section 0 assumption false (especially A2 — D cannot start without B's functions).
2. Whether a public (not signed-in) privacy request may trigger a verification email in production before messaging is enabled (D8 assumes no; it falls back to a manual verify step).
3. Any request to render legal text, opening dates, free-delivery claims or testimonials — those are owner inputs.
4. PDF generation for invoices/statements (IN-20).

## 5. Acceptance mapping
PLAN D lines ↔ WU-D4 (settings without code), WU-D2/3 (published-only, preview/publish/rollback), WU-D9 (evidence never rewritten; private, reproducible, downloadable, backed up), WU-D8 (A/B isolation), WU-D10 (retention), WU-D4 (secrets never visible), WU-D6 (fixtures reconcile; unknown cost never profit), existing settings tests (unrelated-field preservation, unauthorized save).
