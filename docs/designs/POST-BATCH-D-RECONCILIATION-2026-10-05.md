# Post-Batch-D reconciliation — E, E2 and F

**Date:** 2026-10-05  
**Purpose:** mandatory implementation amendment for the remaining batches after Batch D was actually built.  
**Review baseline:** `main` at `f6cfe0b568c9e59b0345b381da63781360c4b1ff` plus the final Batch D branch `ai/sol/batch-d-d10-privacy` through `0d08ac5c60a4dc747b386b61ec2a744d0a56ee13`.

This file exists because `BATCH-E.md`, `BATCH-E2.md`, and `BATCH-F.md` were written/reworked while Batch D was still a design. The remaining implementation must follow the **implemented D contracts below**, not the older assumptions in those guides. Where this file conflicts with E/E2/F text, **this file wins** until the applicable design is folded forward.

**Do not begin Batch E code until the final Batch D PR is green, its preview is READY, its review threads are resolved, and it is merged to `main`.** The E drift check must use that final merge SHA, not the older `47bd833` design baseline.

---

## 1. What Batch D actually established

The next batches must treat these as existing product contracts, not work to recreate:

1. **Editable/versioned public copy.** `SiteContentRevision` + `SiteContentPointer` are the source for owner-editable public copy. `src/domains/site-content/fields.ts` is the field allowlist. Public requests use the published revision; OWNER/ADMIN draft preview uses `?revision=` through `src/domains/site-content/request.ts`. A redesign must not hard-code copy that D made editable or leak draft text to ordinary visitors.
2. **Settings-backed public chrome.** Business profile, hours, closures, social links, logo/service area/catalog settings remain data-driven. Later visual work changes presentation only unless its approved design explicitly changes a data contract.
3. **One report-definition registry.** D created `src/domains/reports/definitions.ts` and report/growth screens. Later metrics work updates the existing definitions/readers; it must not create a second registry or duplicate cards with competing formulas.
4. **Frozen evidence documents.** Signed agreements, final invoices and finished-month statements use immutable `DocumentArtifact` rows containing frozen payload + deterministic HTML + sha256. Private access is through `/api/documents/**`. They are database evidence, not Blob files; later recovery must back up the rows as ordinary database data.
5. **Versioned return-inspection checklist.** D exposes publishing/editing over Batch C's `InspectionChecklistVersion`; old inspections retain their frozen checklist/version.
6. **Tracked privacy requests.** Public and signed-in requests use `PrivacyRequest`; public verification currently sends through `sendCustomerEmail`. A non-sent/uncertain verification attempt falls back to OWNER phone verification rather than pretending delivery occurred. OWNER fulfillment exports a fixed customer data set or pseudonymizes the approved personal fields while retaining required financial/signature/document/notice/audit evidence.
7. **Privacy deletion removes private bytes.** Verified deletion removes maintenance-request-only private photo rows **and their actual private Vercel Blob objects**. Missing private-store configuration fails the fulfillment instead of recording a false success.
8. **Legal-page version gate.** Privacy and Terms have explicit versions in `src/domains/settings/legal-approvals.ts`. Until the OWNER approval matches the current version, the page is `noindex`, keeps its draft notice, is absent from the sitemap, and is absent from the footer's final legal links. No later redesign/SEO work may bypass this gate.
9. **Part ledger history UI.** `/desk/parts/[id]` reads stable newest-first `PartStockMovement` history with job/order trace links. STAFF must not gain unit-cost visibility through later search/redesign work.
10. **D-added route surface.** The remaining accessibility/visual route inventory must include D's owner/customer/privacy/document/settings/part-history surfaces instead of using the pre-D route list.

---

## 2. Required amendments to Batch E

### E start condition / drift baseline

Replace the old assumption "D design checked against 47bd833" with: **read the final D merge, this reconciliation, `CHANGES-SINCE-DESIGN.md`, and the actual post-D code before the first E write.** Re-run every `BATCH-E.md` §0 fact that can have changed during D.

### E sender migration — include D privacy verification

`BATCH-E.md` already notices the D privacy sender in its inventory but its migration work unit omits it. Add it to the `MessageDelivery` migration.

Required behavior:

- migrate the public privacy verification send in `src/domains/privacy/index.ts` through the E messaging ledger;
- use a stable business idempotency identity scoped to the `PrivacyRequest` (for example `privacy-verify-<requestId>`; use one exact key in code/tests);
- an accepted provider result may keep the email-verification path;
- `FAILED`, `NOT_SENT`, or unresolved `UNKNOWN` must preserve D's safe fallback: clear/disable the emailed token as appropriate and leave the request for OWNER phone verification;
- never turn an uncertain provider outcome into `VERIFIED` and never blindly resend a possibly delivered verification message;
- the D customer-email master switch and preview suppression remain in force.

Add tests covering the four messaging outcomes and request status/token behavior.

### E automation inventory — derive passes from the post-D routes

Before implementing `AutomationRun`, re-open the actual post-D cron routes. In particular, do not add a named `subscription-ends` pass merely because the old design listed one unless the final post-D code actually contains that pass. Wrap the real passes, one rule key per pass, and keep D's invoice-artifact freeze in `billing-reconcile` visible as its own run.

### E growth/report definitions — update D's registry, do not extend with duplicates

D already has `METRICS` and growth cards. E must **replace the affected definitions/readers in place**:

- `fleet.utilization`: move the source/calculation from assignment history to Batch C `ApplianceCustodyEpisode` evidence, including the current and rolling-30-day definitions E specifies;
- lead/growth "last activity" or win-back logic: move to E's `lastRealContactAt` contract after message history exists, rather than continuing to infer real contact from a generic `Lead.updatedAt`/flat note;
- preserve existing metric/card IDs where they identify the same business concept so bookmarks/drill-throughs do not split into two definitions;
- add only genuinely new metrics (for example demand forecast) as new definitions.

Tests must prove there is one authoritative definition per metric and that assignment-only changes cannot alter custody-based utilization.

### E owns residual B08 — configurable, versioned lead scoring

The post-D inspection found that the B08 audit outcome was not actually implemented: `src/domains/leads/scoring.ts` still contains the original fixed weights. Rather than add a one-off late D migration, **B08 is explicitly reassigned to E**, which already changes both `Lead` and `BusinessSettings` and owns lead/growth behavior.

Add to E's existing schema/migration work:

- `BusinessSettings.leadScoringPolicy Json` with version 1 defaults matching today's behavior exactly: month-to-month `0`, 6-month `10`, 12-month `20`, each additional unit `5`, business account `10`, multi-unit property-manager/landlord/operator `25`, high-value threshold `30`;
- `Lead.scoringPolicyVersion Int @default(1)` so a lead records which policy produced its saved score/reasons.

Add a validated OWNER/ADMIN control at `Desk → Settings → Lead scoring` (or an equivalent Settings subsection; do not hide it in code). Saving a changed policy increments its version and writes the ordinary settings/audit evidence. Existing leads are **not silently rescored** when the policy changes; their saved score/reasons/version remain historical. New leads, and any future explicit qualification/rescore command, use the current policy. Do not add an automatic bulk-rescore job in E.

Refactor `scoreLead` so the pure function receives/uses the validated policy instead of module constants. Preserve the approved multi-unit property-manager condition (`isPropertyManager && quantity > 1`). Tests must prove: v1 defaults reproduce every existing scoring test; custom weights/threshold alter a new score; a save increments policy version; existing leads do not change on save; a new public/manual lead stores the current `scoringPolicyVersion`; invalid/unknown policy shapes fail closed to validated defaults or are rejected at the writer as appropriate.

This is a deliberate post-D scope correction, not a hidden deferment: E's acceptance/disposition table must close B08 explicitly.

### E distributed rate limiting — migrate D privacy intake

D already applies best-effort in-memory limiting to **public** privacy intake and deliberately does not subject a signed-in customer request to that public-IP limiter. E's distributed limiter work must preserve that semantic boundary while replacing the implementation. Do not double-limit the signed-in portal path.

### E accessibility/search route inventory — include D routes and boundaries

The generated route inventory and role fixtures must cover, at minimum where routable in the final tree:

- customer privacy/settings request surface;
- OWNER privacy queue;
- website editor and its draft-preview state;
- inspection/legal-approval settings;
- part movement history;
- public privacy verification result/route as applicable;
- private document endpoints through authorization tests (not axe HTML-route tests where inappropriate).

Search shaping must preserve D's existing privacy/document/financial and part-cost permission boundaries. STAFF must not receive document evidence, private privacy-request data, or part unit cost merely because a cross-record search is added.

### E legal/public SEO rule

E's SEO/accessibility/brand work must keep D's legal gate intact. Do not add Privacy/Terms unconditionally to a sitemap, footer, route inventory's "indexable" expectations, or SEO snapshot. Test both unapproved and matching-version-approved states.

---

## 3. Required amendments to Batch E2 visual redesign

E2 remains a **presentation** batch. The implemented D control plane is authoritative underneath it.

1. **Public copy stays editable.** Every redesigned element that corresponds to a D `SITE_FIELDS` key must continue reading the D published/preview content source. Do not replace those reads with attractive hard-coded copy from a mockup.
2. **Draft preview survives the redesign.** OWNER/ADMIN `?revision=` preview must render the redesigned page with draft text while an ordinary public request still gets published text. Add one browser test that demonstrates this separation after the redesign.
3. **Legal gate survives the redesign.** The redesigned footer may render Privacy/Terms only when the matching D approval exists. Privacy/Terms metadata remains `noindex` while unapproved; sitemap behavior remains gated. Add light/dark + mobile/desktop checks without weakening the gate.
4. **Settings-backed chrome survives.** Hours, holiday closures, social links, logo/contact/service-area/catalog data continue to come from D/settings. Mockup literals are visual references, not new business values.
5. **D route surfaces join visual regression coverage.** Shared E2 primitives can affect newly added D owner/customer pages. Include the D privacy queue/request screens, legal/checklist settings, document-link surfaces and part history in the appropriate authenticated smoke/axe/visual coverage when those shared primitives touch them.
6. **Do not restyle stored evidence HTML through the app shell.** `DocumentArtifact.html` is immutable evidence. E2 may style links/cards/viewer navigation around it, but does not rewrite old stored HTML.

---

## 4. Required amendments to Batch F recovery / launch

### F private-media recovery must respect D privacy deletion

The old F design proposes a second private-media copy. That is only acceptable if a verified D privacy deletion removes recoverable copies too and a later restore cannot resurrect them.

Required recovery contract:

- every copied private photo must have a deterministic source→recovery mapping in the media backup manifest (no new database table is required solely for this);
- privacy fulfillment must use a shared deletion helper/path capable of deleting the primary object and any known recovery copy/copies, or recording an explicit privacy-deletion tombstone in the recovery manifest before fulfillment is marked complete;
- media inventory must distinguish an intentionally privacy-deleted/tombstoned object from an accidentally missing object;
- restore must consult the manifest/tombstone and **must not restore** an intentionally privacy-deleted photo;
- no "clean up unreferenced files" button or automatic deletion is authorized by this amendment.

Update F scenario `08-privacy-request-retention` to prove all of the following in one recovery exercise: personal DB fields are pseudonymized; retained invoice/payment/receipt/refund/credit/signature/`DocumentArtifact`/notice/audit evidence remains; the maintenance-only primary Blob is gone; its recovery copy is gone or tombstoned; a subsequent database/media restore does not recreate it.

### F database restore must include D control-plane state

The generic schema-wide restore already covers D's tables, but the acceptance scenarios must explicitly verify that a restored environment preserves:

- the published `SiteContentPointer` and revision history;
- immutable `DocumentArtifact` hashes/versions;
- `PrivacyRequest` disposition without restoring deleted private bytes;
- `BusinessSettings.legalApprovals` exactly as recorded (never auto-approve on restore);
- inspection checklist versions and part movement history.

### F go-live legal gate

`GO-LIVE-CHECKLIST` / launch ledger must show the current Privacy and Terms page versions and whether OWNER approval matches each one. A mismatch is an explicit owner/legal-input blocker for calling those pages final/indexable. The automation/model must never approve them on the owner's behalf. If they remain unapproved, D's `noindex`/sitemap/footer behavior stays in place and the launch evidence says so truthfully.

---

## 5. Implementation order after this reconciliation

1. Finish D10–D12 verification/disposition and merge the final D branch cleanly onto current `main`; full CI green, Vercel READY, reviews resolved.
2. Update the final D merge SHA in the E drift-check note.
3. Implement **E** using `BATCH-E.md` + this reconciliation, including the explicit B08 lead-scoring amendment above.
4. Implement **E2** using `BATCH-E2.md` + this reconciliation.
5. Implement **F** using `BATCH-F.md` + this reconciliation.

No Batch E production code should be written before step 1 is complete.
