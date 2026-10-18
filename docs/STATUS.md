## October 18 — PR #500 review repairs and CI verification checkpoint

Following the initial red run, 5 blocking P1 automated review issues were repaired as one verified financial correction: void reverses already-accrued use tax with an immutable journal; existing appliance contributions block double capitalization; prior appliance costs survive void unless that specific expense set them; asset checks lock the row; and recurring drafts recover missed Colorado months. On correction head `cf50e5f` **all 3 unit/real-Postgres shards and all 4 browser/accessibility shards passed**; typecheck also passed. The last exact-head gate failed only the repository money-style checker because two template input fields directly formatted integer cents. Both now reuse `moneyInputValue` from `src/lib/money-ui.ts`, preserving the existing display/storage contract. Capacity baselines also reported failure but are explicitly non-gating per Quickstart; any actual substantive baseline defect must be investigated without treating a non-gating check as green. A final exact-head CI and review verification are required before merge. Production deployment, external Blob acceptance and owner accounting setup remain separate.

## October 18 — K-4 PR #500 independent P1 financial review corrections

All five automated P1 findings from the first review are being handled in the same expense bundle, not treated as a future feature: a void now generates a new immutable `USE_TAX_VOIDED` reverse journal when tax was already accrued (still refuses filed tax); appliance cost checks lock the asset and refuse capitalizing over an existing contribution journal; a pre-existing equal acquisition cost is preserved upon void using evidence that this expense actually set the cost; and the recurring generator catches up through up to 12 missed Colorado months per template under a single checkpoint transaction rather than skipping months across outages. New DB regressions cover use-tax accrued-then-void reversal, equal-cost preservation, conflicting contribution, and October-to-December draft replay. Further exact-head CI and review proof are mandatory before merging. This is source work, not real-provider acceptance.

## October 18 — K-4 PR #500 first CI corrections (exact-head rerun required)

Initial CI on `2a2453b`: secret scan, release policy and all four browser/axe shards PASS, unit shard 1 PASS. Type/lint/repo job failed one lint `prefer-const` in the new finance test; test shard 3 found the older W-8 More expected route/name lists stale; shard 2 found `/desk/expenses` missing from accessibility route inventory and an important real financial bug: an expense could be marked POSTED before owner books initialization while K-2 source poster properly declined to create a journal. All are fixed in one correction: owner opening-book date is required **before** expense post, VOID refuses if the original posting journal is missing, a disposable-Postgres regression proves no status/journal changes with uninitialized books, the tax fixture initializes and restores the test book date, the new route and More labels are counted, and lint is corrected. This is **not** a green-head claim. Independent review and exact-head rerun remain required. No LIVE money, customer message, provider call or production write.

## October 18 — K-4A/K-4B frozen-plan engineering in progress

K-3 PR #499 completed **all exact-head CI and review** and merged as `7ee4d2de5d40e2c78d8a7bf84ebf0096fa714dd7`. Historical entries below recorded earlier pending checkpoints, not its current state. Live production still held older revision `b171510` at last checked release; real Stripe/accounting acceptance remains pending.

The next two approved whole subsections, K-4A and K-4B, are one expense/receipt/phone/recurrence bundle. Their complete original criteria were frozen at plan-only commit `0b2ce3aa8209aeb6f519065cd83ea30a78885e99` before runtime code. Current branch `ai/gpt6/k4-expense-workflow` adds permissioned expense create/post/void, existing use-tax/journal integration, verified private expense receipt storage, mobile/staff expense screen and independently authenticated recurring-draft cron. No live provider activation, customer messages, money-out, production data or paid capacity. Tests authored, but exact-head typecheck/Postgres/browser/independent review still **PENDING**; do not count engineering complete until green gates. Next K-5 only after K-4A/B merge.

## October 18 — K-3 PR #499 first CI and independent review corrections

First exact-head `86cdb2a` CI: typecheck/lint/repository checks, security scan, release-policy checks, unit shards 1/2 and **all four browser shards passed**. Unit shard 3 passed 1,097 of 1,098 tests and failed one new K-3 assertion because a preceding test fixture left an imported but unposted fee dated before the Colorado cutoff; the system correctly answered UNKNOWN rather than falsely claiming MATCH. This patch moves that unrelated immutable-replay fixture **after** the cutoff without weakening the assertion. Codex independently found two P2 financial-lifecycle issues: a posting issue was not resolved after later successful provider-evidence replay, and the nightly job could mark UNKNOWN coverage as success. Both are fixed with a concrete recovered-source regression and fail-closed nightly outcome. New exact-head CI and review must pass before claiming success or merging; no live provider operation, financial activation or production write took place.

## October 18 — completion-push source reconciliation and K-3 engineering (branch ai/gpt6/k3-stripe-accounting)

Checked authoritative main `d96098cca7a8776bf11ee81aea9242c1cc451cfa` (PR #498 merged), live `b17151021f03a58be62fa58870b107d80c40cf1d` and READY Vercel production deployment `dpl_DSExv1wq4nyepnFTMBvwjDErtnBS` built from that live revision. No open PR existed at start. K-1A/B and K-2A/B are merged engineering, but K-2A/B are **not yet deployed** and real owner accounting activation is **not accepted**. Earlier K-2 status headings below are historical at the moment they were written, not today's branch state. The release acceptance queue below still contains PENDING items; an uncredentialed read cannot replace authenticated owner/customer/provider proof.

The next approved whole subsection is K-3 (Stripe provider boundary), frozen in `docs/pr-cards/K-3.md` by planning commit `335cc521` before code. This branch has a source-only bounded balance-transaction importer, per-transaction currency/cents safety, three-day overlap with cursor advanced only after complete provider paging, existing unique journals, a same-cutoff Colorado clearing check, typed owner-only discrepancies, guarded `books-nightly` cron at 09:40 UTC after backup and disposable PostgreSQL test fixtures. The new `BOOKS_STRIPE_SYNC_ENABLED` deployment switch is **OFF unless independently activated by the owner**. There has been **no live provider sync, customer charge, delivery, message, production data write or provider acceptance**.

Verification state: source/tests/docs committed on the feature branch; typecheck, focused PostgreSQL suite, full exact-head CI, accessibility, independent review, acceptance and merge **remain pending until checked evidence exists**. K-4A/B expenses follow K-3 in the approved roadmap; do not count K-3 as completed based on unexecuted tests. Owner still controls Stripe LIVE enablement and real books start. No unauthorized spending or production writes.

## October 18 — PR #498 Books landmark fix

Corrected the Books page nested-main accessibility violation reported by the final browser shard: the existing desk layout already owns the main landmark, so the page root is now a normal div while retaining all headings and controls. The earlier color contrast issue is green in CI. All unit shards and the other three browser shards passed on the prior head; the full final-head rerun and merge still require verification.

## October 18 — PR #498 financial review fixes, next exact-head CI required

Five automated code-review findings (four P1, one P2) were corrected in a single batch: use canonical successful payment statuses, correctly classify RECEIPT_OVERPAYMENT credits, avoid double-subtracting applied credits from write-offs, include invoices with post-start issue/void/write-off dates, and select bounded candidates per source before chronological ranking. Added synthetic real-Postgres regressions; 10/10 local books tests pass. First PR CI found missing literal Books path in owner guide and insufficient accessible button contrast; both fixed; owner-guide test now passes. Previous browser-a schedule-save failure was on an unchanged workflow and will be checked against the next CI run; it has not been dismissed or quarantined. Exact-head CI and merge still pending. No production or real-money operations.

## October 18 — PR #498 CI correction

First exact-head CI found owner guide route omission and inadequate contrast on the newly added Books buttons; both were corrected without weakening tests. An existing scenario-10 schedule-save browser assertion also failed, alongside stream closure errors, despite no schedule code changes in the K bundle. Its next exact-head rerun is required; do not claim browser CI green or the PR merged until proven.

## October 18 — K-2A + K-2B journal and owner Books (review branch, CI pending)

Baseline merged main b171510; no open PR at session start. Planning-only commit 6e7b761, frozen full K-2A/K-2B criteria. Implemented bounded chronological financial backfill using source/event uniqueness, balanced journals, Colorado month placement, month advisory locks, a one-time owner-attested opening balance and owner-only month closing/reopening with an audit trail. Added OWNER/ADMIN Books screen with journal browser, balances, account mapping, review CSV and manual posting; STAFF/CUSTOMER are denied. Incomplete source evidence gives a sanitized deduplicated system-issue card without a partial journal. Added K-2 migration extending the SystemIssue known-kind check; old rows untouched.

Verified: Typecheck passes; 7 disposable PostgreSQL tests pass including 8 simultaneous attempts, invalid evidence, source idempotency, month-end/late entry, owner/role protection, Stripe fee and audit. Browser/CI/review not yet verified. Original invoice/payment source rows remain unchanged. No live payment, production data change, schedule, customer messaging or spending. Provider reconciliation and formal exports remain in K-3 and K-5; asset retirement K-6; owner production setup/CPA decision separately open.

## October 17 — K-1A + K-1B accounting foundation (branch ai/gpt6/k1-accounting-foundation; CI pending)

Current main reconciled at ef16a14; no open PR at session start. Frozen plan committed at 3d784053 before code. New additive Batch K ledger/expense/period/export schema and migration, immutable seeded system-role chart, 16 initial expense categories and filing-account liabilities, invoice-kind mapping including later admin and Colorado RDF fee kinds, and pure balanced plans for receipts, payments, refunds, tax, Stripe, expenses, assets, depreciation, opening balances and reversals. Every new table has explicit recovery policy. K-6 retirement and disposition mapping deliberately refuses; no asset loss is guessed. K-2A/B will add transaction poster and owner interface; new schema is inactive until that work and proper activation.

Verification: focused pure posting 9 tests passed; disposable PostgreSQL books/schema/backup 16 tests passed after repairing ambiguous category SQL; separate disposable backup/restore and schema health 13 tests passed. Memory-limited first typecheck aborted with Node OOM; subsequent 3 GB heap tsc passed. Publication gate and exact-head CI/review/merge remain pending. No production data, real payment, SMS, customer email or other repo changed.

## October 17 — Agent quickstart and paperwork checker (owner request), CI pending

Owner asked that lesser agents be able to follow the paperwork as fast as the main agent. Added `docs/AGENT-QUICKSTART.md` (the whole loop on one page, with every known CI failure and its fix), `npm run bundle:preflight` (runs every paperwork gate locally and explains each failure in plain words), and `npm run bundle:new` (writes card and packet skeletons whose TODO text the checker rejects). AGENTS.md now opens with a pointer and a precedence rule: the later-dated owner amendment wins. The launch-ledger freshness test is now a shape check so another agent's unrelated PR cannot be blocked by it; a stale ledger shows as a warning. No product behavior changed. Next: K-1A (needs its planning commit first).

## October 17 owner-requested MCP architecture and user feedback — documentation only

New [MCP design and implementation entry](mcp/README.md) defines a directly connectable
service in this repository, the required health/backup/application upgrades, actual
authorized recovery, private in-app reports/improvement suggestions and agent repair
tracking. Eleven original subsections have finite acceptance and ordered dependencies;
all remain NOT_STARTED in [the planning ledger](mcp/acceptance.json). The first
[execution card](pr-cards/MCP-1.md) has checked existing anchors and test fixtures for
Sol 5.6 low/medium effort. Future packets are written JIT, not pre-certified.
F2 PR #494 merged during planning; this branch was reconciled with main
`02b84cff` without changing its application code or active execution packet. This
planning work changes no runtime, credential, provider, schedule or release.
Next MCP engineering: reconcile current F2/main; register original MCP batch/index
coverage together; MCP-1/MCP-2 improve health and backup evidence first. Actual
production backup root cause and photo-store configuration remain unverified/open.
Planning validation and exact-head PR CI/review are required before merge; no MCP
runtime, client compatibility or recovery acceptance is claimed by this design.

## October 17 — F2-C and F2-D delivered (owner guide with real screenshots, every old review finding dispositioned, launch ledger, rollback plan), CI pending

The privacy-deletion audit entry is merged (#493). This PR delivers two whole approved subsections from `docs/pr-cards/F2-C.md` and finishes the Batch F engineering.
**F2-C** the owner guide is rewritten from scratch, screen by screen (`docs/OWNER-GUIDE.md`): for each screen what it is for, what you can change without code, and what a failed save or automatic job looks like and what to do. The old stack of dated change notes is archived (`docs/archive/OWNER-GUIDE-before-2026-10-17.md`). Eleven real screenshots from a practice copy (made-up data only) are embedded; `e2e/owner-guide-screenshots.spec.ts` retakes them and skips unless `OWNER_GUIDE_SHOTS=1`. `tests/owner-guide-coverage.test.ts` fails if a desk screen is not named, a picture is missing, or a section lacks its parts.
**F2-D** all 91 old review findings now have a recorded status with evidence (`docs/reviews/dispositions/reconciliation-2026-10-01.json`, checked by `tests/review-dispositions.test.ts`): 37 fixed, 33 already fixed, 13 replaced by later work, **8 still open** (stored photo files are not cleaned up when a photo is removed or replaced, three findings; HEIC photos are not converted; the earnings report compares all paid invoices with rent only, two findings; a calendar-month billing estimate check; a narrow-width desk layout check). Two were fixed here: a contradictory roadmap entry, and the photo upload button now shows a visible keyboard focus ring (the only production-code change, with its own test `tests/photo-upload-field.test.tsx`). The open ones are listed on the ledger and are not claimed fixed.
`docs/LAUNCH-LEDGER.md` is generated by `npm run ledger` from the plan, go-live checklist, the 17 scenarios, the dispositions and the owner gates: an item with no named evidence renders OPEN, owner gates render as decisions for you, and it ends with a blank "Owner authorization: ____" line only you fill in. `tests/launch-ledger.test.ts` proves the rules; `npm run bundle:preflight` warns when the committed ledger is out of date (run `npm run ledger` and commit it after changing the plan, checklist or dispositions; it is not a blocking test, so other work is never stopped by it).
`docs/runbooks/ROLLBACK.md`: screens and code roll back, the database never does. Its revert step was rehearsed on a scratch branch (reverting the merge of #493 applied cleanly); the Vercel Instant Rollback step is not drilled and is a new open line in the go-live checklist.
**ENH-F** inspected: the activation email sender catches its own errors, so a provider failure after an estimate approval cannot fail the saved approval. New `tests/scenarios/07b-estimate-approval-notification.test.ts` proves a thrown sender, a switched-off sender and a successful send each leave exactly one account and no agreement, a repeat approval creates nothing, and the email can be re-sent. No defect found; no new outbox.
Honest limits: the ledger shows what is proven in tests, not real-provider, legal or accessibility acceptance; the guide describes screens as they are on main today; Instant Rollback and real-provider acceptance remain with you.
Proof: all scenarios, the link check, the new tests and the shared-state guard pass together (58 tests, 23 files); typecheck and lint pass; the screenshot spec ran in a real local browser (11 passed); exact-head CI is pending.
Next: the K batches (accounting) per `docs/MASTER-ROADMAP.md`, starting with K-1A. Nothing is live; no Stripe, email, SMS, spending or production data touched.

## October 17 — Privacy deletions now leave an audit-trail entry (owner said yes), CI pending

Fulfilling a customer privacy deletion now also writes one audit-log entry (`privacy.deletion_fulfilled`, who did it, the request and customer ids and the number of photos removed; no personal data). A repeat adds no second entry. Scenario 08 asserts it. Nothing else changes; nothing is live.
Next: F2-C (owner guide and reproducible screenshots), then F2-D.

## October 17 — F2-A and F2-B delivered (every connected business flow proved by a real test), CI pending

V-3 and V-4 are merged (#491). This PR delivers two whole approved subsections as launch evidence: **F2-A** (scenarios 1–5) and **F2-B** (scenarios 6–9, 11–17, the owner-workflow browser test and the link check).
Each scenario runs the real business code on a throwaway local database with Stripe, email and the photo store faked at their edge. They cover: lead to recurring billing (1); a Stripe failure, one-subscription retry and a never-repeated unknown outcome (2); repair to inspection (3);
a check, overpayment credit, refund and the statement agreeing to the cent (4); term end, renewal, termination and opt-out (5); staff leaving with work in flight (6); email send failures and reconciliation (7); a privacy export and deletion with required records kept (8);
a real backup restore into a new database and photo recovery (9); month-to-month continuation and ending online (11); the company-caused late-pickup waiver (12); purchase to use-tax filing to audit pack (13); a washer-and-dryer set (14);
every way a rental ends reaching the same pickup, inspection and cleaning-or-repair chain (15); failed charge to Today item to pay-now to cleared (16); and the customer portal staying inside the customer's own records (17).
`tests/connection-check.test.ts` checks that every To do button and Related link in the code points at a page or download that exists. `e2e/scenario-10-owner-workflow.spec.ts` drives the owner's own screens: change a price, publish site words, schedule a delivery, record a check and decide a deposit.
**One real defect found and fixed:** cancelling a delivered rental that was still active left its machines "awaiting pickup" with no pickup visit and nothing on Today. Cancelling now drafts the same one pickup visit as ending does (`pickup-draft.ts`, `agreements/index.ts`); scenario 15 is the regression test.
**Finding, not changed:** fulfilling a privacy deletion writes no audit-log row; the request itself records who completed it and when. Owner to say whether a separate audit row is wanted.
Honest limits: nothing here is real-provider acceptance (Stripe, email, SMS, photo storage and a production-sized restore stay open); the link check reads the code rather than opening every record page; the browser test confirms each saved result on screen but does not separately assert a Today tile for every step (scenario 16 does for failed payments).
The scenarios run one at a time in the existing shared-settings test group (`vitest.config.mts`) and clear the billing and provider queue rows they create, so they cannot disturb older tests that read whole-database queues.
The browser spec sits at `e2e/scenario-10-owner-workflow.spec.ts` (the shard checker only registers top-level specs) and is in shard browser-a.
Proof: all 17 scenario files and the link check pass together twice in a row on one database (35 tests); 108 existing agreement and pickup tests re-run green after the fix; the owner-workflow spec passed in a real local browser; typecheck, lint, owner-decision, route-inventory, shard and bundle-accounting checks pass; exact-head CI is pending.
Next: F2-C (owner guide and reproducible screenshots), then F2-D (review discharge, launch ledger, rollback). Nothing is live; no Stripe, email, SMS, spending or production data touched.

## October 17 — V-3 and V-4 delivered (the bolder look for every public page, Today and the portal home), CI pending, owner look decision OPEN

V-1 and V-2 are merged (#490); the owner accepted the home page ("better, not as big a change as hoped") and asked for a bolder step, which this PR takes.
**V-3** a shared page hero (a full-width evergreen cut band, dark surface in dark mode, one h1 at the display size) now opens pricing, how it works, service area, contact, launch and the city pages.
Pricing features the first set on the evergreen cut card with the other appliances as plain cards and the fees and good-to-know lists as thin-rule ledgers; how it works is a large numbered sequence
(CSS counters); service area lists cities as large linked rows and ZIP codes as a quiet list; contact (with the address prefill), launch (with its form) and the city pages keep their behaviour under the new hero.
No wording changed or was added (the saved page text is identical and every item is still editable); the legal pages keep their fixed text.
**V-4** Today gets the cut-corner headline card and a day timeline (wide screens): visits placed by scheduled time on an 8 am to 7 pm axis (each as long as its recorded length or the Settings default, overlaps side by side, a Now marker, words Done / In progress / Next / time),
visits with no time or outside the axis listed beneath, phones keep the visit list; attention items carry a stripe and the word Urgent (high) or Soon (medium); money tiles are tagged Actual or Estimate from the metric's kind;
the desk search box reads "Search or jump to…" with a Cmd K / Ctrl K hint and key (it focuses the same search; no new search); the portal "How do I get help?" card is the evergreen card with the fresh Report a problem button.
Beyond the one visit-length column and default-length setting, no new data is read; no permissions, routes, prices or statuses changed, no migration, no new dependency.
Honest notes: the design called for three severity words (Urgent / Today / Soon) but the data has two levels, so only Urgent and Soon exist; Today has no money tiles of its own, so the Actual/Estimate tag is on the METRICS-driven money tiles that exist (Actual is new, Estimate already existed);
Visit lengths: the owner approved (2026-10-17) using each visit's recorded length, else the default in Settings; Today now reads that one extra column and the default setting, and a test covers both cases.
Proof: unit tests for the hero, the timeline placement (overlap, untimed, out-of-range, last-half-hour, Colorado clock across both daylight-saving changes), severity words, tags and the search key; the public page render test (unchanged text) and copy-scan;
browser specs `e2e/signature-public.spec.ts` and `e2e/signature-focus.spec.ts` plus the existing generated accessibility scans of every public route, Today and the portal in light and dark; exact-head CI is pending.
**ACCEPTED 2026-10-17:** the owner reviewed the before/after screenshots (Today, Pricing, How it works) and answered yes to accepting the bolder look and yes to real visit lengths. The PR merges only when exact-head ci is green.
Next: F2-A (integrated scenarios) is the next roadmap item after the owner accepts. Nothing is live; no Stripe, email, SMS, spending or production data touched.

## October 17 — V-1 and V-2 delivered (the new "Evergreen Signature" look for the home page, and a private address check), CI pending, owner look decision (S-V3) OPEN

V-C4 and V-C5 are merged (#489). This PR delivers two whole approved subsections.
**V-1** shared design tokens in `globals.css` for light and dark: a type scale (display, heading 2, heading 3, lede, eyebrow, price), thin-rule and tint colours,
one raised shadow, cut-corner shapes (button, card, photo, band) that drop their clip while something inside has keyboard focus so the focus ring is never cut,
a highlighted-words style, and a gentle entrance that switches off for reduced motion. The brand colours are unchanged. New home wording is owner-editable:
ten website items (highlighted phrase, address-check labels and four answers, price-ticket label) with today's-style starting wording, in the editor, the template
contract and fixtures (fingerprint updated, template version `signature-1`). `tests/theme-contrast.test.ts` now also proves the text pairs on the new tint and band
meet 4.5:1 in light and dark and that every cut shape keeps its focus exception; `tests/public-copy-from-settings.test.ts` fails if old hard-coded marketing
sentences return to public pages.
**V-2** the home page is recomposed in both variants (opened, and preparing to launch): eyebrow with the first service-area city, big heading with an optional
highlighted phrase, lede, the address check as the main action (shown only when Settings lists service-area ZIPs and a quote link exists; otherwise the usual button), the photo
in a cut frame over an offset panel with a price ticket from the first published set price, a thin-rule benefits ledger, pricing with the set card featured,
numbered steps, a household and property-manager band, a two-column FAQ and the closing call to action. **Address check:** a small public form that answers
"we deliver / not yet / check the address" from the owner's ZIP codes (cities only if no ZIPs are listed), makes no outside call, is limited to 20 tries per 10 minutes per visitor,
and stores and logs nothing; "yes" opens the quote form with the address and ZIP already filled in from the link (nothing is saved until the visitor sends the form), "not yet" links to the launch list.
No migration, no new dependency, no change to routes, permissions or prices. Other public pages are unchanged (V-3).
Proof: unit tests for the pure rule, the action (limit, honeypot, nothing stored), highlight, answers and links in the page render test, and the home page snapshot;
full unit run 3398 passed (the one local failure, a Denver-time date check in `custody-integration`, is the known local-machine difference and passes in CI);
typecheck, lint and the plain-words check pass. Browser/accessibility proof (`e2e/signature-home.spec.ts` at 360/768/1440 in light and dark, sideways scrolling, focus ring on cut shapes, reduced motion)
is in exact-head CI.
Not proven by an automated test: the address-check answers inside a real browser (the browser test site starts in prelaunch mode without service-area ZIPs, so the check does not show there); the
tab-through of every header/price control; the "no layout shift from the price ticket" claim is a design property, not measured.
**OPEN, owner decision S-V3:** Chris must accept or reject the new look from before/after screenshots (360/768/1440, light and dark, both opening modes). Nothing here claims acceptance, and
this PR is not merged until he answers. If he rejects the direction, work stops rather than being iterated blindly.
Next: V-3 (the remaining public pages) and V-4 (desk and portal polish), after the look is accepted. Nothing is live; no Stripe, email, SMS, spending or production data touched.

## October 17 — V-C4 and V-C5 delivered (the owner Website editor, and the redesign safety contract), CI and merge pending

V-C3 is merged (#488). This PR delivers two whole approved subsections.
**V-C4** a new **Website** screen for owners and admins (in the desk menu's More list; staff and customers are refused at the page and at every action).
It opens on an overview (live version and when, how many draft changes, four tasks: Edit a page, Photos, Contact & prices, Review & publish). Edit a page:
choose a page, then a section, then an item (a phone shows one step at a time with an Edit/Preview switch; a wide screen shows list, editor and live preview
together); search finds an item by words. Each item shows where it appears, what is live and what you propose, other places that share it, when it takes effect,
a character counter, the business facts it may use (`{phone}` shows your real number), a Hide/Switch off button for optional items and **Restore recommended**.
Links keep their words and destination separate (page, another website, your phone, your email); pictures come from the picture library or a new upload with a
description (or "decoration only"), focus point and wide/square/tall crop previews; promotions have on/off, title, text, optional button and picture, and
Colorado start/end boxes with a plain "visible now / not yet / ended" sentence. The preview is the real public page inside the screen through a signed-in
door (`/website-preview`); clicking words, a button or the home photo inside it opens that item (a keyboard list does the same). The action bar saves drafts
honestly (a failed save keeps what you typed, a double click saves once, a draft changed elsewhere is refused with a reload button, leaving with unsaved changes
asks first). **Review & publish** shows each change before/after, link destinations, pictures, the business facts used, pages affected and anything that blocks
publishing; publishing requires the draft version and the live version you reviewed, refuses if either moved, and a double click publishes once. **History**
restores an older version into the draft (never straight to live, and blocked when the version needs a removed picture) and can discard the draft.
**V-C5** `template-contract.ts` lists the 204 places the layout shows owner content (kind, length, optional), plus the facts owned elsewhere and the
non-content structure; a test proves it equals the editor both ways, every placeholder has one owner, and a committed fingerprint fails until a slot change is
made on purpose. A pure `planCompatibility()` reports renamed/retired/new/unconvertible content and keeps retired content aside; saved examples of both content
formats must still read; customized content survives a change and a rollback in tests. Anonymous-draft tests prove visitors, staff and customers never get draft
words or the preview door. Rollback runbook: `docs/runbooks/WEBSITE-TEMPLATE-ROLLBACK.md`.
No migration, no new dependency. Header change: only a public page opened with `?select=1` may be framed, and only by this website; the desk, portal and APIs keep
the deny-all rule (browser header test added). Old text-only editor and its actions are removed.
Proof: 16 unit tests (permissions, review diff, markers, Colorado time, preview door), 10 contract tests, 7 real-Postgres tests (stale live version, repeat and
simultaneous publish, restore-to-draft, discard, removed picture, staff and deactivated owner refused), a browser test for the whole edit-preview-select-publish
path and accessibility scans at 360/768/1440 in light and dark, and an updated old end-to-end editor test. Exact-head CI (browser and accessibility) is pending.
Open items: the Website menu entry sits in More (the W-8 menu keeps its 14 main entries; owner may prefer a main entry); the preview shows the site's current
opening mode, so the "before opening" home variant is visible only while the site is in prelaunch mode (and pricing/city previews show the launch page then, as visitors see);
the menu, footer, notice bar and banner words cannot be previewed before publishing, because the shared page frame cannot read the preview version without making every public page
slower to serve (the editor says so beside that page; the wording shows live after publish). The Website screen skips the browser's "upgrade to https" rule only when the app
is served over plain http on this computer or the CI test site (a real address is always https and keeps the full policy); website picture bytes are still not in the daily recovery
copy; picture cleanup is not scheduled; pictures need the private picture store configured in production. Not done: the visual redesign (V-1…V-4), which needs
the owner's before/after screenshot acceptance. No live Stripe, email, SMS, spending or production data touched.

## October 17 — V-C3 delivered (every public page bound to editable website content), CI and merge pending

V-C1 and V-C2 are merged (#487). This PR delivers the whole approved subsection **V-C3**: no marketing word, button, link or photo on a public page is
hard-coded any more. About 175 items (menu, notice bar, footer, home page opened and preparing-to-launch, pricing, contact page and form, how it works,
service area, launch page and form, city pages, search titles and descriptions) are now website items with their starting text equal to today's words,
read through one request reader (`getSiteForRequest`) that also serves the owner's draft or old-version preview (active owner/admin only; everyone else
always gets the live version and the real time). Facts stay with their owner: a sentence holds `{businessName}`, `{phone}`, `{email}`, `{city}`,
`{graceDays}`, `{contents}`, `{amount}`, `{year}` or `{serviceCities}`, filled when the page is shown, so wording can never disagree with Settings or the
price list. Sentences may hold checked links written `[words]` followed immediately by `(/page)` or `[words](https://…)`; an unknown page, a non-https address, a malformed link or an
unknown `{fact}` is refused when saving and again when publishing. Buttons are link items (words + a destination chosen from known pages, an https address,
or your own phone/email). Menu and footer destinations stay fixed in code; only their words are editable. The home photo uses the website picture when one
is set (description, decorative choice, focus point) and the built-in photo otherwise; a draft picture is never served to a visitor. A site-wide banner and a
home page featured box each hold a promotion (title, text, optional picture and button, on/off, optional Colorado start and end); both are off until set up,
are judged on every page view (no scheduled job), and an ended or not-yet-started one simply disappears. A promotion linked to a priced offer is refused
until a priced-offer source exists. Legal page bodies (privacy, terms, accessibility) stay tied to their legal-approval versions; only their menu and footer
frame is editable. No migration, no new dependency.
Small honest changes: the launch page now says the configured business name (it used to say "Robinson Appliance Rentals" in code); the page titles shown in
search now come from the website items (same starting words); the root page title/description use the new `seo.site.*` items.
Proof: 13 saved before/after page texts (`tests/fixtures/public-pages/*.txt`) match exactly except the launch page business-name line; a render test replaces
every editable item with a unique marker on every route and variant (empty price list, no cities, photos, legal approved, before-opening) and fails if any
visible word is neither a marker, a declared owner fact nor a named exception, and if any item never shows; real form tests cover the words that appear only
after an action (company name, sending, thank-you); unit tests cover links, facts, spring-forward/fall-back promotion times and preview access; four
real-Postgres tests cover publishing, preview limits, draft pictures and refusal at save and publish.
Named exceptions (not website words): contract-term choices (Month-to-month, 6 months, 12 months), launch-list interest choices, the launch-list email
consent sentence (versioned legal wording), and accessibility landmark names.
Not done here: the owner editor screens (V-C4), template contract and CI coverage wiring (V-C5), the visual redesign (V-1…V-4). Exact-head CI (browser and
accessibility), review and merge are pending. No live Stripe, email, SMS, spending or production data touched.

## October 17 — V-C1 and V-C2 delivered as one bundle, CI and merge pending

W-17 and W-20 are merged (#486). This PR delivers two whole approved subsections of the website-content control work:
**V-C1** the website can now hold more than plain text: pictures, links, short lists and scheduled promotions, each with its own checked rules
(a picture needs a description or must be marked decorative; a link goes to a known page, an `https://` address, or your own phone/email from your business
profile, never typed in; a promotion ends after it starts). Every saved website version records which format it is in. Old versions read exactly as before
(empty still means "use the recommended text"); a value that cannot be read is an error, never odd text on a page; keys the site no longer knows are kept in
history but never shown. Every website field now has a plain "where it appears" description, and the facts that come from elsewhere (phone, email, address,
hours, service area, monthly rent, catalog photos, terms) are declared with the screen that owns them.
**V-C2** owner/admin picture upload: real JPEG/PNG/WebP only (not by name), at most 10 MB and 24 megapixels, location/camera data removed, stored as WebP;
SVG, HTML and animated files are refused. A picture is private until a published website version that uses it (or a saved catalog photo) makes it public
in the same database step; publishing or restoring a version whose picture is missing or removed is blocked with a plain message and changes nothing.
Retire is refused while a picture is in use; a bounded cleanup removes only old unused drafts. A crop preview component shows wide / square / tall crops with
the chosen focus point. The catalog photo setting now checks who is saving, accepts only `https://`, our own pictures or an uploaded picture, and writes its
audit record in the same step. Two additive migrations: `20261017190000_vc1_revision_content_version`, `20261017200000_vc2_website_assets`; `sharp` is now a
declared dependency (it was already installed through Next).
Nothing on the public website changes yet: the home page is not bound to the new picture field until V-C3, and the owner editor for pictures is V-C4.
Plan and frozen acceptance: `docs/pr-cards/V-C1.md`; proof per criterion: `current-pr-scorecard.json`; cleanup runbook: `docs/runbooks/WEBSITE-ASSET-CLEANUP.md`.
Open items: the daily media copy does not yet include website pictures (rows are in the database backup, bytes are not copied to the recovery area);
cleanup is not scheduled. Exact-head CI, including browser/accessibility, review and merge are pending. No live Stripe, email, SMS, spending or production data touched.

## October 17 — W-17 and W-20 delivered as one bundle, CI and merge pending

W-10 and W-19 are merged (#485). This PR delivers two whole approved subsections:
**W-17** the seven main record pages (appliance, customer, rental agreement, purchase, seller, visit, invoice) show **Related**
(plain links to connected pages) and **History** (who did what, when, newest first, no raw codes) for owner and admin only;
search finds purchases (seller name or receipt number) and sellers (owner/admin only) as well as serial and model numbers;
a machine that passes inspection becomes **Being cleaned**, shows on Today as "Clean (machine)", and only **Cleaning done**
makes it Available; a failed inspection drafts exactly one undated repair visit shown on Today as "Schedule the repair".
**W-20** the customer account shows "Your next bill" (rent, date, tax and credits are on the bill), a Requested / Scheduled /
Done list for each open visit, a what-happens-next note after a pickup request, problem report or ending a rental (English and
Spanish), package lines as sets ("Washer + Dryer Set (washer #A12, dryer #B07)"), and **Pay now** on a past-due bill that
opens that bill's Stripe payment page (own bills only; paid, closed and local bills show nothing). One additive migration
(`CLEANING` status). Plan and frozen acceptance: `docs/pr-cards/W-17.md`; proof per criterion: `current-pr-scorecard.json`.

A real bug was found and fixed on the way: without a rule, a machine still recorded as with a customer could have been passed
into the cleaning status; custody now treats cleaning as "in the shop".
Verified locally: typecheck, lint and wording check, unit tests (`w17-connections`, `w20-portal`), five real-Postgres tests
(`w17-connections-integration`), and the full test run. Not yet done: exact-head CI (including the browser/accessibility run),
review, merge. Pay now was tested with Stripe stubbed; it needs your real Stripe keys to open a real payment page.
Open items: none new. Nothing is released; no live Stripe, email, SMS, spending or production data touched.

## October 17 — W-10 and W-19 delivered as one bundle, CI and merge pending

W-8 and W-9 are merged (#484). This PR delivers two whole approved subsections:
**W-10** the use-tax return page has a **File now** panel: a button that opens Colorado's Revenue Online in a new tab,
and every number to type in the order of the state's DR 0252 form, each with a Copy button, ending with a link to "I filed and
paid it" (the app never submits or pays). **Print the filled-in official form** fills the real DR 0252 PDF you supplied
(State column, whole dollars; your signature, tax ID numbers and address stay blank for you; the invoice list is on page 2 to
attach from the audit pack). The form is chosen by the year the return's period ends in; old years stay so a late return
still has its own year's form. From December, System health warns "the next year's DR 0252 form isn't loaded" until the
new year's PDF is added to `src/domains/tax/forms/` (see its README), and until then the page shows the numbers
only. If Colorado ever redesigns the form the app refuses to fill it rather than put numbers in the wrong boxes. The
filing runbook is `docs/runbooks/colorado-filing-channels.md`. Revenue Online needs a sign-in, so its exact screen
order could not be read; the panel follows the form, and the first real filing should confirm it (open item below).
**W-19** a converted lead shows "Create quote" and "Start agreement" (and keeps them after a refresh); converting a quote
opens the new draft agreement; an agreement waiting for signature longer than a new owner setting (Settings →
Notifications → Unsigned agreement reminder, starting 3 days, with explanation and restore) puts "Follow up: <name>
hasn't signed" on Today; a customer's repair request is on Today at once as "Review <name>'s repair request"; a
customer's pickup request in the portal now becomes a draft pickup visit (not a repair) and the customer is told "we'll
call you within one business day"; a rental that ends with appliances still out gets a draft pickup visit and "Schedule
<name>'s pickup" on Today, with a "Schedule the pickup" button on the agreement page as a safety net; every unfinished step
of the agreement progress card has a button. One additive migration (`unsignedFollowUpDays`). Nothing is sent to a customer.
Plan and frozen acceptance: `docs/pr-cards/W-10.md`; proof per criterion: `current-pr-scorecard.json`.

Verified locally: typecheck, lint and wording check, 9 unit tests for the File now steps and the form (the real 2026 PDF is
filled and read back; a redesigned form is refused), 4 flow-rule tests, 6 real-Postgres flow tests, and the existing
Today, system-health, ending and filing suites; I also looked at the filled-in form as an image. Not yet done:
exact-head CI (including the browser/accessibility run), review, merge. The browser spec
`commercial-reserve-preapproval` (page-width check) failed once on #484's CI and passed on identical code; it looks
timing-sensitive and is recorded here rather than hidden.
CI fixes before merge: the portal pickup list, three tests written for the old behavior (a stand-in database, a cleanup, the pickup form), and a pickup that cannot be pinned to one rental now files a normal review request. The date check in tests/custody-integration.test.ts fails the same way on main before this PR, so it is not part of this bundle.
Open items: confirm Revenue Online's screen order on the first real filing; the CD, RTD and ECD columns of the form are
left blank (they apply only to those districts; local city and county use tax is filed with the city, not on this form).
Nothing is released; no live Stripe, email, SMS, spending or production data touched. W-17 and W-20 are next.

## October 17 — W-8 and W-9 delivered as one bundle, CI and merge pending

W-7 is merged (#483). This PR delivers two whole approved subsections:
**W-8** the desk menu is 14 plain entries (Today, Tasks, Leads, Customers, Quotes, Communications, Rentals,
Schedule, Repairs, Equipment, Money, Taxes, Settings, More). Dispatch, Jobs and Driver view are one Schedule entry
with three views; Parts, Purchases and Purchase orders are tabs under Equipment; Revenue, Fleet, Reports and
Business overview are tabs under Money; Suppliers, Growth, Launch list, System health, Privacy requests and
Activity are on a new More page (each role sees only what it may open). No screen address moved, so every old link
works. A plain-words check now runs with lint and refuses hard words (jurisdiction, remit, election, "cents", raw
status codes) on owner screens; the 18 it found are fixed;
**W-9** each closed tax filing period shows on Today as "File and pay $X on SUTS by <date>" (or "File a $0
return…"), "(overdue)" after the legal date; reminder emails now repeat every business day once overdue; the return
page's form is "I filed and paid it" and needs only the date paid and the confirmation number (a different
amount still needs a reason); and a nightly check raises a high System health issue if a closed period has no
return on the list. The app still never files or pays; you press Submit and pay on the official site.
Plan and frozen acceptance: `docs/pr-cards/W-8.md`; proof per criterion: `current-pr-scorecard.json` and
`execution/W-8-delivery.json`.

Verified locally: typecheck, lint and the wording check, menu and tab tests, wording-script tests, 5 new
real-Postgres filing tests, and the existing tax filing, reminder, finalization, return-action and system-health
suites. Not yet done: exact-head CI (which includes the browser/accessibility run of the new menu), review, merge.
Nothing is released; no live Stripe, email, SMS, spending or production data touched. W-10 (File now panel and
the filled DR 0252 form) is next after verified merge.

## October 17 — W-7 first-time setup checklist delivered, CI and merge pending

W-5 and W-6 are merged (#482). This PR delivers **W-7**: the owner sees a "Get set up" card at the top of Today
with six steps in order (business details, service area, prices, tax setup, payments, email). Each shows
"Done ✓" or the one thing missing and opens the exact screen that fixes it; the card disappears once all six
are done. Admins and staff never get it (refused where the data is read, not just hidden). Everything is worked
out from saved data, so it can't drift; tax setup uses the same definition as Taxes → Setup (shared code, tested
to agree). Payments and email say only whether they are connected and test or live, never a key, and the card
changes nothing. No database change.

Verified locally: typecheck, 19 unit tests, 7 Today-page tests, 9 real-Postgres tests, and two deliberate
rule-breaking checks that the tests caught. Not yet done: exact-head CI (including the browser accessibility run),
review, merge. Payments and email stay "not done" until the owner adds the Stripe and email keys in hosting
settings (GO-LIVE-CHECKLIST). Skip-a-step is recorded in ROADMAP. Nothing is released; no live Stripe, email, SMS,
spending or production data touched. W-8 (simpler menu and Schedule screen) is next after verified merge.
Plan and frozen acceptance: `docs/pr-cards/W-7.md`.

## October 17 — W-5 and W-6 delivered as one bundle, CI and merge pending

W-3 and W-4 are merged (#481). This PR delivers two whole approved subsections:
**W-5** held payments and deposit decisions each put a To do on the list, the failed-payment To do now reads
"<name>'s payment failed — $X", every open invoice with a Stripe payment page has "Send payment link" (previewed,
sent only when customer email is on) and "Copy link", wording is owner-editable per reason at Settings → Payment
link wording, and "Take payment by phone" opens Stripe's own invoice page for that one bill (simple version, owner
decision 2026-10-16: no spreading over bills; the payment is recorded only by Stripe's confirmation; the card-save
permission is recorded with who, when and the script);
**W-6** a new lead puts "Contact <name>" on the list due per the owner's response-time setting (starts at the same
day), marking a lead contacted asks "Next follow-up date?" (two days out) and that date becomes a To do, and a
customer-approved quote puts "Turn <name>'s approved quote into a rental" on the list due today.
Plan and frozen acceptance: `docs/pr-cards/W-5.md`; proof per criterion: `current-pr-scorecard.json` and
`execution/W-5-delivery.json`.

Verified locally on a throwaway Postgres: typecheck, new unit tests and 11 new real-Postgres tests. Exact-head CI,
review and merge are pending. No live Stripe, customer email, SMS, spending or production data was touched. Still
open for real use: Stripe confirming that staff-typed card payments are allowed on the live account
(GO-LIVE-CHECKLIST). W-7 (first-time setup checklist) is next after verified merge.

## October 17 — W-3 and W-4 delivered as one bundle, CI and merge pending

W-14, W-2 and W-15 are merged (#480). This PR delivers two whole approved subsections:
**W-3** one "Taxes" menu entry with four tabs, use tax and audit pack moved inside with the old
addresses forwarding, and a "File and pay $X on SUTS by <date>" headline on the return pages;
**W-4** the rental turning points: the signed-delivery To do now names the customer and is due the
next day, a new owner setting (30 days) puts a Renew / Month-to-month / Pickup decision on the To do
list, deciding an ending creates exactly one draft pickup visit and a To do, and visits with no
technician or time within 2 days get "Assign / set a time". Plan and frozen acceptance:
`docs/pr-cards/W-3.md`; proof per criterion: `current-pr-scorecard.json` and `execution/W-3-delivery.json`.

Verified locally on a throwaway Postgres: typecheck, lint, route inventory, new unit tests and 7 new
real-database tests, plus the existing month-to-month and early-ending suites (extended to assert the
single draft pickup). Not yet done: exact-head GitHub CI, independent review, merge. The Renew /
Month-to-month / Pickup buttons are on the decision page the To do opens, not on the To do row itself.
Nothing is released; no live Stripe, SMS or email, no spending, no production data touched.
W-5 (Stripe payment links and phone payment) is next after verified merge.

## October 17 — W-14, W-2 and W-15 delivered as one bundle, CI and merge pending

W-26 is merged (#478). This single PR delivers three whole approved subsections:
**W-14** one purchase = one receipt, one seller, many serialized appliances with the
seller tax split by price to the cent; **W-2** one shared `nextPurchaseTaxStep` that the
record result, purchase page, appliance page, purchase-order receiving and To do all
show; **W-15** a per-appliance Tax proof panel, a printable and spreadsheet audit pack
(owner and admin only, parts included) and the owner-editable record-keeping period.
Frozen acceptance and the plan are in `docs/pr-cards/W-14.md`; proof per criterion is in
`current-pr-scorecard.json` and `execution/W-14-delivery.json`.

Verified locally on a throwaway Postgres: typecheck, lint, `check:quick`, the new unit
tests (26), the new real-database test (12: atomic and replay-safe recording, exact tax
split, owner-only answers, filed-return amendment, parts receiving, audit pack, receipt
protection, retention), the backup/restore drill with the three new tables, and the
related existing tests. Not yet done: exact-head GitHub CI, independent review, merge.
Nothing is released; production still serves the previous READY revision. No live Stripe,
SMS or email, no spending and no production data was touched. Open owner/CPA answers that
restrict only their named real use: IN-65 (credit for another state's tax and delivery
charges) and IN-71 (record-keeping period). W-3 is next after verified merge.

## October 17 — complete W-26 engineering, final CI/merge pending

W-25 is merged. W-26 in PR #478 now completes the original customer-language
engineering outcome across quote, agreement/signing, payment, portal, customer
messages and owner-editable translations. All seven coverage declarations represent
implemented consumers. Actual Spanish remains OFF until complete current drafts,
owner-selected fluent review, separate counsel evidence and owner publication.
English governs signed agreements; historical invoices/signatures are unchanged.

Diagnostic Actions run 38984045880 passed all three unit/real-Postgres shards,
schema upgrade/restore, all four production builds and browser shards, including
the full gated bilingual journey. Independent engineering review has no remaining
blockers. Final PR-head CI and merge remain pending; do not infer deployed or
provider acceptance from source tests. See W-26 card, consumer matrix, scorecard
and permanent PR handoff for final verified revisions and checks.

Main was 1b41264d; READY production serves 4740313d. The 22 existing live/provider/
owner acceptance rows remain PENDING after individual prerequisite reconciliation.
No production release, LIVE send/charge or real Spanish approval occurred. W-14
is the next approved engineering capability after verified W-26 merge.

## October 16, 2026 — Complete deployment acceptance backlog

Retained all twelve W-22/communications tasks; ten source-pinned W-23/W-24/W-25
cases added, all PENDING until READY ancestry and genuine original fixture/
provider/legal gates. Independent public site and Workspace read-only health
succeeded, but no customer signing, Stripe TEST, tenant privacy purge, support
reply or phone provider operation was performed. No manual release authorized.

W-25 premerge safety verification: first PR head 3fba86b passed all three unit and all four parallel browser shards, but secret-scan owner-decision-routing step rejected a stale W-24 marker. Reconciled approved decision map to W-25; no reclassification or release gating change. Added phone free-text card PAN/CVV refusal with isolated unit tests in this same substantive PR. Exact-head CI must rerun after combined correction, and no source test equals live/provider acceptance.

W-25 sequencing reconciliation (2026-10-16): owner decision map activeExecutionMustRemain advanced explicitly from approved/merged W-24 to approved W-25 in lockstep with the work index. All 56 original decision classifications, target IDs and activation gates are unchanged; this repairs exact-head CI owner-decision routing without loosening the check.

## October 16, 2026 — W-25 owner phone-order full engineering outcome (under verification)

Baseline actual main 408a38d (#473). Original W-25 acceptance frozen in
docs/pr-cards/W-25.md before source edits. One OWNER/ADMIN ordinary draft
for an existing customer or new lead, attributed call entry, offered-slot
and crew details, copy link and authorized send to finish reuse W-24.
Customer still reviews prefilled, editable details, explicitly approves,
signs immutable money, pays only through existing authorized Stripe/owner
method, and creates their own authenticated password. No new phone card,
verbal acceptance, outbound SMS, voicemail, Twilio spend, call recording,
recurring provider spending or LIVE Stripe activation. External real
support@robinsonappliancerentals.com inbound/reply and provider mail remain
unverified; currently rely on the existing fail-closed COM email gate.
Postmerge W-24 main CI run #38847255667 found null-orphan tax jurisdiction
crashing an unrelated out-of-service exception view; this PR guards both
observations and rate versions and leaves them as review-required evidence
rather than hiding the record. W-24 remediation is not recounted as W-25.
New source tests, exact-head CI/browser/independent review/merge and acceptance
ledger still required; no claim of source CI as real deployed acceptance.

W-24 roadmap sequencing transition: checked owner decision routing now follows the reviewed active marker in docs/owner-decisions/2026-10-13-implementation-map.json rather than permanently hard-coding W-23. W-23 predecessor and PR #472 risk remediation are merged; wrong/backward/unapproved work IDs still fail. Owner original 56 decision classifications and external gates remain unchanged.

2026-10-15 W-24 original full criteria were frozen before implementation. W-23 postmerge risk repair #472 is separate and does not count toward new engineering. W-24 owner/customer quote -> signing -> paid TEST receipt -> requested delivery, manual road-miles and versioned windows, independent agreement offers, account email setup, no-show and default-OFF owner-reviewed fees are implemented as a coherent dependency unit pending exact-head checks, review and merge. Real signed LIVE/TEST acceptance, CPA/legal, fee-tax authorization and production activation remain queued; no manual release was requested.

## 2026-10-15 — Postmerge W-23 review risk remediation (not a new bundle)

Original PR #470 was merged at main `78efa927` with passing CI, but subsequent Codex review raised four concrete P1/P2 findings (retention legal holds and approval, future occupant privacy, cross-customer import collision, and lost-response import retry). This risk-remediation PR responds to that actual later review evidence; no second W-23 bundle is claimed. Default real tenant PII erasure is OFF; independent privacy/legal clearance, per-contact and repair-case holds, owner preview, audit, and separately enabled operator setting are required before any erasure. Scope remains no LIVE sends, payments, public pricing or production fixtures. Disposable PostgreSQL and typed checks must be re-proven at the final head, with backup manifest and migration. Existing tax official-source-watch CI shard independently exposed a nullable orphan appliance-type reference in the custody exception overview; provide a safe unknown-type label rather than crash the entire read-only exception dashboard. Docs/DATABASE.md records this schema delta. W-24 original full roadmap acceptance has been frozen before W-24 product edits in `docs/pr-cards/W-24.md`, but a planning card is not delivered functionality. `live` observed at `4740313d` remains behind main and blocked source-dependent external checks stay queued. Execute eligible independent work and checked review/merge; no manual promotion is authorized by a bundle request.

## 2026-10-15 — W-23 location contact bundle PR #470 (DRAFT, exact-head verification required)

Baseline was actual main 9b2717aa6df8bf9f0636f2c1e8f6f7224cf129ee (#469). Branch ai/gpt6/w23-location-contacts-20261015. The full original approved W-23 is frozen before production edits in docs/pr-cards/W-23.md at 0cb1c6a. This is one substantial business/tenant privacy outcome; never re-count underlying helpers, work fragments or W-22 engineering.

Proposed code: additive per-address unit/access/contact/permission data; current and former on-site persons and client-controlled permissions; owner and client edit portals; explicitly assigned live job access readback; seven-day one-use tenant maintenance link, active appliance validation and pending client notice without SMS/charge; turnover To do with no rental/billing rewrite; daily policy-controlled PII erasure; owner-approved row-validated CSV preview/serializable import. Tests: tests/location-contacts.test.ts and tests/location-contacts-integration.test.ts. See docs/pr-cards/execution/W-23.json for finite checks.

**Verification not yet complete:** PR #470 is DRAFT; code and local TypeScript/browser/DB were not executed inside the stopped Vercel sandbox. GitHub required CI, security review and exact-head remediation must pass before a merge, and external tenant/owner/customer/service/provider acceptance cannot be inferred from these code paths. Pending CustomerNotice is not accepted email delivery; tenant COM-L opt-in and SMS activation are separate. W-22 external acceptance remains OPEN. No production activation, price publication, SMS, customer charges or owner money-out was performed or approved.

Next: resolve exact CI failures, inspect migration/restore and browser coverage, complete review gates and PR merge; rerun final-main verification and report original W-23 acceptance criteria separately from gated live/provider acceptance. Do not begin dependent W-24 while W-23 is unmerged.

### Release-needed owner escalation — October 15

Owner permits manual-release requests only after every independently eligible
authorized task is finished and release would enable a concrete next completion task.
Record source gaps while continuing implementation, deployed acceptance, reviews,
merges, cleanup and records; prepare the exact checked target before asking.
The read-only planner distinguishes source absent from live, source already in live
but not serving, and unknown provenance/history. No manual release is preauthorized;
continue independent work and reassess acceptance after actual READY deployment.

## Owner-requested product completion workflow correction — October 15

The Google agent's repeated 0/1 exits exposed a shared code-only bundle assumption.
This repository now retains normal ENGINEERING workload guides and adds explicit
COMPLETION accounting for substantial NEW original acceptance/configuration proof,
possibly with zero production lines. The existing card freezes complete criteria
and exact queue IDs; committed ledger deltas must preserve source, scope and gates.
Old code, old passes, audits, isolated probes and pending/partial outcomes count zero.
No new phase/features or scope approval may be invented to meet a workload number.

N supplements the WHOLE workflow: perform every currently ready authorized obligation
in existing priority/dependency order even after N is reached. A planned substantial
acceptance outcome can count once, never excuse other ready acceptance or closeout.
Reconcile original requirements once; do not repeatedly audit already-proven code.
A future real-operation date or external sign-off does not prevent eligible source
work/synthetic proof. Only actual optional dependencies may be bypassed as optional.

This is scoped workflow maintenance, not a product audit or declaration that this
project is near completion. Existing roadmap, unfinished work, provider acceptance,
owner inputs, fixture ownership, release policy and authorization limits remain.
No queue row is marked PASSED, no provider call/release/activation/spending performed,
and zero product bundles claimed. Full exact-head/local checks, review/merge and
final-main verification remain required. See docs/pr-cards/SESSION-WORKFLOW.md.

## 2026-10-15 — PR #466 complete W-22FIN engineering bundle, final gates

## Owner-requested execution efficiency / parallel CI maintenance — October 15

Preserve substantial outcome scope and complete acceptance. Consolidated local
capability/publication diagnosis and early real-boundary fixture preparation reduce
avoidable retries. Independent verification families run in parallel with original
required aggregate names; new topology/timeout regressions and measured 180-second
root phase budgets preserve fast feedback as coverage grows. No tests/assertions,
provider gates, immutable pins, releases or production behavior are waived.
Existing session/CI checks and final-main verification remain mandatory. This is
maintenance, zero product bundles or genuine deployed/provider acceptance. See
SESSION-START and the existing SESSION-WORKFLOW card for evidence and procedure.


One connected implementation covers the five original POLICY, QUOTE, APPROVAL,
RECOVERY and DELIVERY subsections. Count it only after required exact-head green
CI/browser, review disposition and merge of PR #466. The scorecard maps each
original acceptance criterion; no helper, internal repair or earlier merged
subsection is recounted. After verified merge, W-23 is the next engineering
outcome; prepare its already planned card/packet at next startup. W-22 remains
PARTIAL for genuine external acceptance. Older checkpoints below are history.

Current source reconciles main #468 `ad0d628f` into the existing draft; the original
source baseline was #467 `d6cc8b5b`. V2 preserves
V1 semantics while connecting exact-order received-advice clearance, current
unsigned policy/tax checks, quote/adoption/signature/SQL obligation, same-receipt
reserve, cancellation/independent whole return, dispatch, actual physical
completion, rent-only first invoice, customer/owner/documents and backup restore.
Unsigned reopening audits full old evidence and requires preparation, freeze
and clearance again; signed snapshots cannot be reopened or repriced.

Verification: typecheck/lint passed; related disposable PostgreSQL run 1250 tests
passed (three existing allow-listed performance skips); selected DB run 52 passed
with no skips. The synthetic $456.06 two-address flow proves stale approval
denial, original agreement adoption/replay, concurrent single receipt/reserve,
paid A dispatch/physical completion, independently recorded B cancellation return,
and only A's $60 rent advance applied once on its first invoice. Actual supported
backup restore preserves the full financial history, including reopened unsigned
clearance. Provider calls are simulations, not genuine Stripe TEST evidence.

Local browser preflight is blocked before tests: standard build and supported
webpack/stand-in-font build were killed at this 4GB sandbox's memory limit (137);
1536MB heap diagnosis aborted with V8 heap exhaustion (134). No local browser
pass is claimed. Required normal Actions production build/browser suites must
pass at the published exact head, including the new actual owner/customer form
flow, three widths, keyboard and light/dark scoped axe checks. Reviews and full
required CI remain merge gates; their exact-head links belong in PR #466.

Production independently remains READY at `4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0`.
Public / GET 200 and private /desk and /account/rentals 307 to login; browser
/desk also displays login. All eleven existing queue sources are included in
this deployed revision. Complete per-row acceptance accounting was checked:
none has a current authorized authenticated fixture/session or requisite external
provider/professional evidence here. Each exact prerequisite and next procedure
is preserved in the existing release queue below. Do not create production
fixtures or claim passes from ancestry/anonymous access. Main-ahead is not a
reason to defer those existing checks. V2 requires its own future checked release.

## 2026-10-15 W-22FIN active handoff — interrupted long integration and acceptance reconciliation

**Branch/worktree:** `ai/gpt6/w22fin-v2-complete-20261015` in
`/vercel/appliance-desk-w22fin-v2`, based on main `fbbd1508` (#465).
At startup there were zero open PRs; do not count this ongoing implementation
as complete or create a *separate* anti-stall documentation PR. Preserve the
existing branch and all working files. `npm run work -- checkpoint` prints
current Git divergence, changed files, unresolved conflicts and recovery
steps. Use the anti-stall loop in `docs/SESSION-START.md`. **Unmerged and
unreviewed changes do not count as a bundle**, irrespective of passing unit tests.

**Why this session stalled:** broad W-22FIN V1→V2 evidence integration acquired
20 uncommitted changes across financial consumer boundaries. Initial unbounded
Node typecheck exhausted its heap; some large shell-edit operations were
rejected and had to be split. The agent diagnosed repeatedly instead of
continuing a bounded action. Added `scripts/work-checkpoint.mjs`,
`npm run work -- checkpoint`, unit tests and a permanent same-PR recovery rule.
Tests `tests/work-checkpoint.test.ts` pass (three focused assertions).
Run `NODE_OPTIONS=--max-old-space-size=3072 npm run typecheck` in this 4 GB
sandbox, not an unbounded TypeScript retry.

**Engineering in progress (W-22FIN; not yet a completed subsection):**
explicit sorted V2 mandatory fees/reserve/RDF/service tax alongside immutable
V1, versioned draft/freeze/reverification, reviewed quote/readback,
checkout items, receipt-backed deposit liability, first invoice limited to
rent advance, and document breakdown. Synthetic two-property $456.06 V2
freeze/checkout proof passes. The exact end-to-end workflow remains
unfinished: complete and independently verify signed professional-use gates,
multi-location preapproval/acceptance, signed cancellation and partial-delivery
refund/reserve handling, isolated PostgreSQL migration replay and browser
acceptance, all original packet criteria, and exact-head CI/reviews/merge.
Do not soften owner refund, Stripe LIVE, communication, legal/CPA or release
approvals. A prior test environment without DATABASE_URL caused two suites
to fail before assertions; both later passed with synthetic localhost
DATABASE_URL/DIRECT_URL. No production DB or money changed.

**Live release reconciliation (not user acceptance):** verified
Vercel READY production `dpl_52TWf2hvNct3psyRVv3YhVqvWKbK`,
branch `live` source `4740313d`, assigned to
`robinsonappliancerentals.com`. Production GET / was 200; anonymous
GET /account/rentals and /desk redirected 307 to /login.
The **11** queued acceptance cases in the JSON below each have an
ancestry-required commit included in this deployed revision. Main ahead of
live is **not** a deferral. The anonymous probes are not authenticated or
provider passes. The outstanding checks and their specific unmet prerequisites:

| Queue IDs | Unmet prerequisite and next permitted action |
|---|---|
| DESK-W22, W22FIN-DISPATCH-RECEIPT | Authorized existing signed customer/owner TEST records and verified Stripe TEST settlement; read existing scoped records first, no live delivery start or synthetic charge |
| DESK-COMMS | Owner consent/IN-09 A2P, IN-51–53 voice/privacy/budget choices and approved controlled carrier evidence; leave sends/activation OFF |
| APPLIANCE-W22-PORTAL-RECEIPT, W22FIN-SIGNING-OWNER-CUSTOMER | Authorized authenticated existing customer and owner sessions, own/foreign/invalid receipt readback; do not create production records |
| W22FIN-SIGNED-DELIVERY-VISIT | Existing approved signed delivery order with unscheduled/scheduled evidence; read-only compare customer calendar, no mutation |
| W22FIN-MULTI-ORDER-VIEW | Authorized existing two-address frozen estimate and scoped owner/customer signing readback; confirm amounts and missing/foreign denial |
| W22FIN-PAYMENT-RECOVERY | Authorized existing owner TEST payment attempt/receipt proving pending vs failed vs settled; no independent new charges |
| W22FIN-FINAL-ESTIMATE-READBACK | Existing converted multi-location owner/customer estimate with independently frozen reviewed amount |
| W22FIN-MANDATORY-OWNER-POLICY | Scoped owner authenticated policy readback and separately permitted isolated staff-denial test; counsel/CPA gate remains independent |
| W22FIN-PREAPPROVAL-READBACK | Approved existing prepared estimate/customer link and owner identity; stale quote denial and exact V2 frozen fingerprint |

**Next action:** inspect changed files and full original W-22FIN contract,
finish all version-sensitive consumers and isolated financial rejection/replay
tests, review current checks, commit to the **same implementation branch**,
and open/merge the implementation PR only with all required gates green.
Re-evaluate the 11 queued acceptance cases against the READY revision before
ending; do not mark them passed for ancestry alone.


### October 15 — owner-requested bundle guidance consistency review

## Owner-requested bundle scope accounting correction — October 15

Operational maintenance, zero product bundles/subsections: preserve an inspected
pre-code plan in the existing execution card, compare all original criteria with
actual new engineering, retain undersized completions as contributions, and require
explicit review of substantial-work exceptions. `session:bundle` checks frozen Git
plans and delivery accounting; `check:session` includes behavioral regressions.
Existing CI/review/merge gates remain required. No provider/deployed acceptance,
release, activation or spending is claimed. Existing work and acceptance queues
remain authoritative; their obligations are unchanged. See SESSION-START and
SESSION-WORKFLOW maintenance card for procedure, proof and publication boundary.


## Acceptance-first session tooling — October 15, 2026

Owner-authorized cross-repository workflow repair: session status now presents
per-deployment acceptance actions before roadmap work, separately lists waiting
checks, and validates complete/stale-free temporary acceptance accounting.
SESSION-START is authoritative for sequencing and final closeout; push checkpoints
continue into required obligations. This maintenance completes no product bundle,
closes no provider/deployed acceptance, changes no release/approval gate, and
preserves concurrent roadmap work and existing evidence. Focused native script
regressions and required exact-head CI/review must pass before merge.


Reviewed current main 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0. Aligned existing governing instructions, session
procedure and applicable playbook/card/recipe references: cards define approved
scope; related whole subsections form coherent bundles; PR splits need concrete
migration/dependency/safety/reviewability reasons. Removed stale numeric ceilings
and blanket one-risk/one-migration fragmentation rules where present. Session target
comes from the current owner, not PR count; incidental fixes/checkpoints do not end
an unfinished bundle. Remaining engineering must not be hidden as external proof.
Removed a stale generic session sentence that called future work maintenance.
All original subsection IDs, roadmap order, source/provider acceptance, independent
approval/guard/cleanup rules, CI/review and hosting/cost gates remain unchanged.
Dated PR-count instructions/credits below are historical to their original
sessions, never standing quotas or credits toward the current target.
This is explicitly requested guidance maintenance, zero product bundles; no provider
operation or release. Required exact-head checks and review disposition govern merge.
Current approved outcome: W-22FIN remains incomplete. #463 and #464 are merged;
verified source baseline is 905a0fb8 (owner reserve/service-policy review).
The active card and W-22FIN integration contract below contain the current finite
completion path. Historical checkpoints are evidence of their original sessions,
not current next actions. Preserve concurrent implementation branches.

## W-22FIN stall diagnosis and current finish contract — October 15

Verified #464 merged at `905a0fb8`; #459/#462/#463 are also inherited source.
The active W-22FIN card now starts with the five existing remaining engineering
rows, and its integration contract §2A maps the V1-only frozen-money bottleneck
through storage, quote, signatures, payments, cancellation and first invoice.
Older card session reports are preserved in the existing history archive.
Next implementation is that complete nonzero-money integration, not another
policy/readiness-only PR or repeat investigation of merged work. The 45606-cent
fixture and complete DB/browser flow define finite proof; once all existing
criteria pass, close engineering and resume W-23 with external acceptance queued.
This requested diagnosis/design is maintenance, not completed product engineering.
The dated checkpoints below retain their original evidence, not current next work.

### PR #464 live checkpoint — original W-22FIN owner policy, exact-head CI repair

Branch `ai/gpt6/w22fin-policy-commercial-reserve-20261014` was recovered
from unattached blobs and moved to real commits `c08e42b` and `79825f8`.
PR #464 was opened against verified main `4740313d`; the first exact-head
CI ran and found scoped TypeScript errors, a browser-build client import of
the server pricing index, fixture assumptions and a too-broad trigger.
The secret scanner itself passed but the docs-update check requested a
`docs/DATABASE.md` migration description. Fixes are being applied together
on the PR; they are not yet a green-gate or merge claim.

The refined SQL protection applies to **new explicitly versioned commercial
reserve histories** only. Unversioned prior agreements retain their
documented legacy finance-update behavior. The amount still cannot be
accepted, signed, charged or refunded through this provisional policy UI;
new service/RDF/deposit money categories remain incompatible with V1
frozen payment envelope until W-22FIN-QUOTE, APPROVAL, RECOVERY and DELIVERY
are completely implemented and tested. No whole subsection or bundle is
counted by this unverified PR; no CPA, counsel, owner provider TEST or
checked production acceptance is claimed.

### Active W-22FIN owner policy continuation — October 15 REST checkpoint

After PR #463 merged at `4740313d`, checked live `main` remained that
commit, with zero open PRs. The subsequent commercial-reserve policy branch
existed at the same commit, but its attempted draft source lived only in
unreferenced GitHub blob objects. This is a *checkpoint failure*, not a CI
failure. The anti-stall runbook and AGENTS instructions now specify lease-checked
tree/commit/ref checkpoints with actual PR/CI/merge receipts.

The active W-22FIN-POLICY/QUOTE implementation now addresses real per-property
commercial reserve allocation: no double-copy of estimate reserve into multiple
draft agreements; OWNER-only versioned/reasoned location allocations, no
household reserve, immutable signed history, readback and synthetic PG/browser
tests. Mandatory service, tax and RDF review and complete signed quote/checkout
remain unfinished unless their **connected** integration and required exact-head
gates subsequently prove otherwise. Do not count blobs, checkpoints, PRs,
professional review or synthetic tests as one of the requested five completed
bundles. Keep IN-79, IN-07, actual Stripe TEST and deployment acceptance separate.

### W-22FIN active source checkpoint — signed cancellation classification (not a bundle)

Reconciled main `20466bc5` and zero open PRs. The existing pre-delivery
cancellation classified large orders solely by a positive first-month advance,
which misclassifies prepaid five-machine and business accounts. Work on branch
`ai/gpt6/w22fin-signed-cancellation-evidence-20261014` freezes a validated
multi-location machine count, customer classification and full-refund window
inside the atomic sign transaction, then reuses **that signed policy** for owner
refund quote, reviewed approval and immutable audit. Legacy obligations without
signed policy allow full refund but not automatically calculated retention;
damaged evidence blocks review. SQL protects signed policy writes and mismatched
cancellation records. Unit and real-Postgres tests were added; exact-head CI,
database migration, reviewer disposition, merge and deployed acceptance must
be verified separately before credit. This fixes one identified money rule
inside `W-22FIN-RECOVERY` but completes **zero** whole predefined subsections
and is not a finished W-22FIN bundle. The higher-priority full `W-22FIN-QUOTE`
and related customer/payments/delivery integration remain required.

### October 15 existing-work audit — cancellation payment integrity

The owner requested review of implementation as well as planning.
[Audit and findings](reviews/2026-10-15-existing-work-review.md) records two
cancellation defects repaired with a shared obligation-locked payment guard:
generic close bypassed pending collection, and reviewed cancellation missed
SUCCEEDED without a reconciled receipt. Three new cases failed on original main;
24 focused tests passed with the fix on disposable PostgreSQL, including an
observed lock-wait race. Exact-head full CI/review/merge remain required.
PR #459 then merged as 5703c6ea. Reconciled that main and repaired its missing
customer-view fingerprint submission across page/form/action/locked domain.
Four old-view cases failed on the merged baseline; the combined repairs passed
41 focused tests, including a concurrent old/new-tab race. Its former branch
was untouched. The professional-review implementation contract now maps the
current IN register to researched configurable policies and concrete proof.
W-22FIN remains active/incomplete; internal remediation tasks count zero whole
predefined batch subsections. No release/provider/professional proof claimed.

## Completion checkpoint — W-22FIN-APPROVAL, while W-22FIN-QUOTE remains gated

Owner-prepared customer-owned agreement drafts can now be adopted by an
approved estimate without creating duplicate agreements or deposit obligations.
The conversion transaction serializes on the Estimate and every prepared
agreement, verifies the original frozen order, customer ownership, date-effective
tax/policy identities, and refuses to convert if any signature, payment
obligation, invoice, dispatch or deposit already exists. Successful conversion
records an audit, never a paid/signature/first-invoice-credit claim, and
concurrent replays return only the same original agreement identities.

Supported verified zero-deposit offers can follow this flow, and preliminary
prospect estimates remain nonbinding. The parent W-22FIN-QUOTE is **still open**:
required nonzero service, RDF, damage waiver and refundable deposit categories
must be fully allocated and reviewed before such offers may bind. This
completion checkpoint proves source rules and synthetic database/browser
regressions only; it does not prove live Stripe TEST, counsel or CPA acceptance.
All previous pending release-dependent rows remain pending.

## W-22FIN preapproval preparation, exact quote identity and stale approval denial

Owner/ADMIN can prepare customer-owned draft agreements while an estimate is
editable, without approving, converting, sending, booking or charging. Exact
owned packages, per-site frozen signing amounts, current owner applicability
and verified monthly rental-tax version evidence must reconcile before the
public estimate shows reviewed totals. A fingerprint changing after send
invalidates customer approval. Unreviewed leads receive a clearly nonbinding
preliminary email and cannot approve or pay; they may request changes.
This completes W-22FIN-APPROVAL source-side safeguards for supported verified, zero-deposit quotes with exact frozen order adoption and safe concurrency. W-22FIN-QUOTE remains incomplete for nonzero mandatory categories and refundable deposits.
Nonzero visit fees, waiver/RDF and refundable deposits remain approved
W-22FIN engineering; legacy prepared conversion now uses the original drafts. Preserve CPA/counsel/owner/Stripe gates.

### October 15 decision research and implementation-detail maintenance

Owner-requested design/research only: the
[W-22FIN integration contract](implementation-contracts/W-22FIN-INTEGRATION.md)
adds current code seams, exact multi-location money, transaction/replay boundaries
and a finite full-flow acceptance matrix. The
[official-source research](research/2026-10-15-owner-decision-follow-through.md)
maps acquisition-dependent rental tax, conditional dated RDF, local jurisdiction,
ACH, communications, retention, postal privacy and portable accounting to existing
work. PR #459 was open at inspection and remains separate concurrent work.
No production behavior, completed subsection, professional approval, provider
acceptance or release is claimed. W-22FIN remains active; K-CASH/BP remain proposed.

### Owner workflow clarification — October 14, 2026

PR workload is counted in whole predefined batch subsections from the approved
roadmap/design, never technical slices or packet checklist tasks. Partial
subsections count zero complete; retain all remaining engineering and separate
external acceptance. Session PR count and scope come only from the current
owner prompt, with no standing quota or PR-number alignment. Historical PR
counts below record earlier work and do not instruct future sessions.
This owner-requested maintenance changes guidance/report wording only; required
CI/review, security, provider, spending and release gates remain unchanged.
Focused reporting tests passed locally; exact-head full Actions gates are required
before merge. No product subsection, deployment or provider acceptance claimed.

## W-22FIN owner mandatory-charge policy and preapproval readiness — implementation checkpoint

A stale local main was also discovered to mislead the rolling progress report; default comparison now uses the verified origin/main ref.

An owner-only dated, append-only and audited policy now records applicability
decisions for delivery, installation, removal, damage waiver and retail delivery.
It deliberately does not certify tax, legal terms, pricing publication or the
applicability of a given charge at a particular jurisdiction/address. The owner
estimate page now assembles verified line/address/package counts with setup and
first-month advance amounts, keeps deposits separate, and explicitly lists all
missing mandatory charges. It labels the subtotal **NOT all-in or payable** and
never authorizes customer approval, Stripe, signature or collection. Historical
signed prices and receipts remain unchanged. See W-22FIN active card and the
PR scorecard; new disposable DB/browser tests and exact-head CI are pre-merge gates.

**Outstanding engineering in W-22FIN (do not start W-23):** independently
verified preapproval all-in quote, immutable owner review, customer binding
acceptance and deposit checkout tied to exact reviewed obligation, full
multi-site cancellation/retry/first-invoice/delivery reconciliation. Recheck
only eligible real released acceptance at verified live revision; professional
IN-79/IN-07 and owner publication/money-out approvals remain separate.

## October 14 W-22FIN engineering continuation and acceptance handoff

Completed in session: PR #450 owner/customer exact settled signing amount
readback; #451 signed pending delivery vs real appointment; #452 verified
receipt gate on physical dispatch; #453 complete frozen per-location signing
order on customer/owner views; #454 fail-closed provider-uncertain retry and
owner issue guidance. PR #455 adds a converted estimate's same verified
all-location frozen offer with review-required for incomplete revisions.

**Unfinished engineering, same W-22FIN unit:** owner-prepared all-in offer
available to customer *before* estimate approval; itemize/include all
mandatory charge categories (including any refundable deposit, damage waiver
or retail delivery fee where legally applicable) in an owner-approved
effective-dated policy; link provisional estimate approval/early checkout
to that binding frozen amount rather than treating old monthly/one-time lines
as a payable complete offer; prove full multi-site reversal/recovery and
first-delivery invoice once all accepted facts reconcile. The converted
estimate readback is an integration improvement, not an excuse to move W-23.
Do not activate real tax-dependent pricing or Stripe LIVE without the
retained owner/CPA/counsel/professional gates. Do not make a production fixture
or send live customer messages for acceptance. The maintained
`release-acceptance` queue below governs future checked releases.

## W-22FIN converted preliminary estimate → verified frozen final readback

The original estimate link now explicitly separates provisional rental-line
figures from final location-level money. For a CONVERTED order, a complete
customer-owned frozen signing digest is required before displaying per-site
and combined setup, tax and down payment totals; missing/foreign sibling
agreements result in REVIEW_REQUIRED instead of a fictitious all-in offer.
Owner estimate view links to the same customer result. Existing draft
approval/deposit and standalone mandatory-other-charge policy remain
unfinished work within W-22FIN; no W-23 authorization or real business
activation is implied. CI, release and owner/provider acceptance remain
independent.

## W-22FIN signing payment recovery and verified retry guard

Owner/admin agreement and exception workspaces explicitly separate PENDING
provider results, uncertain remote outcomes, final FAILED attempts and
verified settled receipts. An attempt with a persisted SUCCEEDED state but no
reconciled signed receipt cannot silently create a second charge; DB status
constraints intentionally reject UNKNOWN, so unresolved remote outcomes
remain PENDING and require provider-authoritative reconciliation. The
server-side reservation rechecks the attempt state under the existing
obligation lock. A synthetic failed prior attempt may be retried with a
fresh idempotent key; owner confirmation of real offline funds remains
mandatory before recording a receipt. Exact-head CI and provider/customer
acceptance remain independently pending. W-22FIN remains active; no W-23.

## October 14 W-22FIN multi-address frozen offer visibility

Customer signing and owner agreement now read one independently verified
frozen customer-order digest, with separate current-address signing amount,
per-address fees/tax/down payment and order-wide reconciliation.
An incomplete/foreign source hides the public signing link instead of
showing partial totals. Existing prelaunch publication, provider charge,
professional approval and first-invoice gates remain unchanged. Exact-head
database/browser acceptance and genuine release/user acceptance are distinct.
W-22FIN remains unfinished until estimate approval and complete recovery
flow are integrated; W-23 remains blocked.

## W-22FIN delivery/payment reconciliation — dispatch guard

A signed physical delivery start now re-verifies the agreement's frozen
W-22 offer and exact owned signing receipt/zero-due evidence under an
agreement lock; an appointment booking remains separate. This prevents
pending, unknown and wrong-customer payments from authorizing dispatch.
Synthetic unit assertions and exact-head CI are required before merge;
genuine provider/customer acceptance and owner-controlled business use
remain separately pending. No status/Stripe LIVE/communications activation.

## W-22FIN next integration — genuine pending delivery visibility

The signed-delivery job already persisted by W-22D18 has `status=SCHEDULED`
with a null appointment time. Customer Rentals previously queried scheduled
times only, omitting that real unscheduled handoff. The following implementation
now includes the signed, same-customer delivery draft and distinguishes
"being arranged" from a confirmed visit. The established owner-only scheduling
To do and money readiness remain authoritative. Browser/DB, CI and external
acceptance remain distinct; this is no auto-booking or customer message.
W-22FIN remains IN_PROGRESS pending complete all-in quote/approval and
payment-to-delivery acceptance.

## October 14 checked production catch-up and W-22FIN continuation

Manual owner-approved release is independently verified: `main` and `live`
both `2f68599ac35d65e6c72e919475381483a7dca289` (#449), Vercel production deployment
`dpl_3QHctQyDoLX1a8gRFMg8isvbjEXR` READY at that source and assigned
`robinsonappliancerentals.com` plus `www` without alias error.
Exact-head GitHub CI, three unit shards, four browser shards and release-policy
were SUCCESS. This clears source/release ancestry for the existing queue, NOT
authenticated customer, live-provider or legal/CPA sign-off.

W-22FIN substantive source continuation now shares the existing customer-isolated,
receipt-validated signing-obligation readback between account Rentals and the owner
agreement view. Review-required status hides corrupt/unverified amounts, awaiting
and received stay distinct, and first-invoice credit is never assumed. The
existing source verification for the underlying DTO remains inherited; new UI
behavioral tests and exact-head Actions/merge are separately required. Multi-
location all-in estimate/approval gating and full payment-to-delivery integration
remain unfinished; do not advance W-23 or activate any real-business gate.

## October 14 completion recovery and checked release preparation

Owner requested complete Git reconciliation before a one-off manual release.
Consolidated duplicate completion rules while preserving owner-decision/regulatory
and activation gates; recovered unfinished customer signing-evidence DTO code with
invalid/foreign/ambiguous receipt denials and isolated integration coverage.
Repaired the capacity workflow Postgres image after verified ECR data-limit failure;
all performance thresholds and tests remain unchanged. Local six pure tests, lint,
index/housekeeping tests and full typecheck passed; no local PostgreSQL is installed,
so real DB/browser/build/performance proof is required in exact-head Actions.
W-22FIN remains the current parent outcome; never claim this is full completion.
No provider acceptance or business activation is implied by the authorized release.

## Owner direction — sequential batch completion, not recurring slice carryover

Current active work is W-22FIN. Finish its whole remaining **engineering**
and tests before beginning W-23. The agent must investigate and solve
technical blockers, directly ask the owner for missing owner decisions
and resume immediately after the reply. Do not silently defer source work
or use PR alignment as a reason to switch batches. Only exact
deployment/provider/professional **acceptance** may remain queued
with provenance and a specific re-entry trigger. Full rule in AGENTS.md.

## Permanent owner-question and regulatory-default workflow — 2026-10-14

Owner clarification: unresolved operational/business choices are interactive,
scoped questions. Ask in the active session after checking existing recorded
answers, then record the answer and resume; never strand an entire batch.
For laws, statutes, accounting and CPA/legal matters, agents research official
primary sources, guidance and future effective changes to build provisional,
owner-configurable, versioned defaults now. Explicit professional sign-off is
tracked separately and restricts only affected real business use. The affected
feature must explain its gate and give the owner an audited confirmation path.
AGENTS.md and SESSION-START.md hold the full permanent requirements.
This is a development procedure, not legal/tax approval or live authorization.

## W-22FIN checkpoint — recorded owner fee adjustment (2026-10-14)

Owner-only audited per-location signing fee adjustments, optional full waiver
and immutable signed-order guard are under active substantive implementation.
This is not the whole W-22FIN batch: all-in customer/owner estimate-through-
agreement presentation and payment failure follow-up still require engineering,
test evidence and merge. Actual CPA review, legally approved terms, Stripe TEST
and production release/acceptance remain separate scope-specific gates.

## W-22FIN progress — CPA-backed owner activation path under implementation (2026-10-14)\n\nThe next substantial W-22 implementation adds recorded adviser confirmation, effective date, owner attestation, and audited tax-policy revisions. It will deny unreviewed/legacy tax choices during both draft preparation and downstream tax review, preserving remaining per-jurisdiction rules and verified address obligations. This is SOURCE WORK ONLY until exact-head CI/review/merge, followed by checked release and independent real-provider acceptance. It does not approve CPA/legal treatment, customer charges, Stripe LIVE or public pricing. Remaining all-in customer quote and integrated delivery acceptance still belong to W-22FIN; the owner expects the whole engineering milestone, not small repeated handoffs.\n\n### Workflow maintenance handoff — owner publication approved

New offline session utility: eight behavioral tests passed, including actual Git ancestry, partial releases, unknown/failed deployments, rollback, dependency gating, invalid queues, PR alignment and bounded output. All repository queues validate. Existing source/status evidence is preserved; no provider acceptance or release was performed. Owner explicitly approved publication on October 14; publish the reviewed maintenance branch, require exact-head CI/reviews, and merge only when those gates pass. No extra production release is authorized by this approval. Full broad application suites on the shared runner were interrupted after resource/time-limit failures; do not claim them passed. Existing exact-head remote CI/review gates must pass before any main merge.

## Release acceptance queue — workflow optimization 2026-10-14

Owner-authorized guidance/tooling maintenance: consolidated session procedure, focused
checks between meaningful edits, substantial capability grouping, and read-only queued
acceptance/PR-boundary report. This records source/tooling work, not a live/provider pass.
The queue below seeds existing outstanding obligations; reconcile exact scenarios and
already-proven evidence from the unchanged cards/ledger before running. Keep all prior
open obligations, original fixture ownership, approvals and deployment provenance.

<!-- release-acceptance:start -->
```json
[
  {
    "id": "DESK-W22",
    "priority": 1,
    "requiredRevision": "d5b994dd11af641d8f4e437ee566cea345ab2129",
    "task": "Catch up deployed cancellation/signing/delivery checks and remaining genuine Stripe TEST acceptance",
    "procedure": "docs/STATUS.md",
    "gates": "W-22 remains partial; preserve W-23 sequencing, refunds/signatures, customer isolation and provider approval gates",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Existing authorized signed TEST records and provider-authoritative Stripe TEST settlement. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "DESK-COMMS",
    "priority": 2,
    "requiredRevision": "d5b994dd11af641d8f4e437ee566cea345ab2129",
    "task": "Reconcile deployed communications acceptance and execute only cleared checks",
    "procedure": "docs/runbooks/COMMUNICATIONS-ACCEPTANCE-LEDGER.md",
    "gates": "Existing SMS/customer email consent and activation gates; no sending or live activation implied",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Owner consent, IN-09 A2P and IN-51\u201353 activation/privacy decisions plus controlled carrier evidence. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "APPLIANCE-W22-PORTAL-RECEIPT",
    "priority": 3,
    "requiredRevision": "c0de6e7da0bacfbabc114547745b286c2f4d0188",
    "task": "Verify signed customer signing obligation/receipt DTO with own-account scope, corrupt/foreign receipt denials and no provisional or raw receipt evidence",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Existing authorized owner/customer test accounts only; no production fixture creation, customer charge, communication or policy activation",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized authenticated own/foreign customer fixture and receipt identities. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-SIGNING-OWNER-CUSTOMER",
    "priority": 1,
    "requiredRevision": "d8aa536965d47d1694d455e67239b14cb5acc094",
    "task": "Authenticated existing customer and OWNER confirmation of same frozen signing amount in Rentals and Desk, correct pending/received states, invalid/foreign receipts denied, first-invoice credit not assumed",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "No new live fixtures, payment, messaging, professional approval or provider activation",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized authenticated owner/customer identities and existing scoped signed receipt. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-SIGNED-DELIVERY-VISIT",
    "priority": 1,
    "requiredRevision": "9afff558ccf113fbb0441939f7016a1eb4caa9e5",
    "task": "Customer with signed unscheduled DELIVERY job sees being arranged, not booked; after owner schedules, actual date/time appears; no phantom appointment",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Read existing owner/customer records only; no production fixture, job mutation or customer notification without separate authorization",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized authenticated customer and existing signed scheduled/unscheduled delivery records. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-DISPATCH-RECEIPT",
    "priority": 1,
    "requiredRevision": "2350c63c599bcfddd79899d6c949a0960c2cddf6",
    "task": "After checked release, validate W-22 delivery start requires signed frozen proof and exact customer receipt or zero-due; pending/unknown/foreign funds do not authorize dispatch",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Never start a real production delivery for testing; no money-out or Stripe LIVE; existing approved TEST/customer acceptance only",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Existing approved signed TEST order with verified receipt or zero due. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-MULTI-ORDER-VIEW",
    "priority": 1,
    "requiredRevision": "08735efa56b6302d3ec818eea316e41394007199",
    "task": "After checked release, review an approved existing two-location customer signing link and owner desk, confirm one complete immutable frozen order, per-address and combined amounts, no second checkout/receipt and denial of missing/foreign scope.",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Read only, no live fixtures, payment, customer message or public pricing; professional and Stripe approvals remain independent",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized existing two-address frozen estimate and customer signing link. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-PAYMENT-RECOVERY",
    "priority": 1,
    "requiredRevision": "e776e4a3468a3cebda1e1be505606d69125f4567",
    "task": "After checked release, authenticated owner view shows clear response for PENDING/provider-uncertain/FAILED signing payment; no duplicate attempt under actual unconfirmed provider outcome; safely recover only after confirmed failure and legitimate receipt.",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "No synthetic production charge/receipt/attempt mutation; read-only existing owner TEST evidence first; no autonomous money-out/Stripe LIVE/customer messages",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized owner session and existing TEST pending/failed/settled attempts. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-FINAL-ESTIMATE-READBACK",
    "priority": 1,
    "requiredRevision": "42a8d744b80e939e5f69dee3cdcce5ddbfd30785",
    "task": "After checked release, open an approved existing converted multi-location estimate with owner and authorized customer link: show exact frozen charges for all locations or review-required when one location incomplete, without implied payment or sending",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Use existing safe read-only records, no live synthetic estimate/job/payment mutation, professional/Stripe/communication gates unchanged",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized existing converted multi-location estimate and customer link. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented."
  },
  {
    "id": "W22FIN-MANDATORY-OWNER-POLICY",
    "priority": 4,
    "requiredRevision": "5bf9efe7a063061ae646149d85a7c721fedfcef4",
    "task": "After checked READY production ancestry, verify owner-only mandatory-charge policy and estimate review readback; maintain unresolved financial gates.",
    "procedure": "Authenticate scoped owner; read policy revision and nonpayable per-location estimate review only. Check denied admin/staff mutation in authorized isolated acceptance; never write a production policy fixture.",
    "gates": "Requires permitted owner identity and verified READY ancestry. No real tax-dependent send, customer collection, public price, or live/provider mutation.",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authenticated OWNER read session and separately permitted isolated staff denial fixture. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented.",
    "dependsOn": [],
    "status": "PENDING"
  },
  {
    "id": "W22FIN-PREAPPROVAL-READBACK",
    "priority": 5,
    "requiredRevision": "4b8570e38981b76ef35538bfdfb9ccb7f52ff545",
    "task": "Verify authenticated owner prepared multi-property estimate quote readback and public stale-quote denial after checked READY release.",
    "procedure": "Use separately permitted owner and isolated customer read identities; inspect fully signed frozen order, matching quote hashes, denial of legacy provisional approval, and no provider mutation or live fixture creation.",
    "gates": "Checked READY revision ancestry, owner/customer permission and isolated safe fixture. Counsel/CPA/Stripe TEST and publication restrictions remain separate.",
    "lastEvidence": "2026-10-15: Independently verified Vercel READY custom-domain source 4740313d34c6e8b5d7df27ff9a2b6b5dc26302d0 includes required revision. Public GET 200; /desk and /account/rentals 307 to login; browser /desk also displayed login. Missing prerequisite: Authorized existing prepared estimate and scoped owner/customer identities. No production fixtures, authentication credentials, provider writes, activation or acceptance passes invented.",
    "dependsOn": [],
    "status": "PENDING"
  },
  {
    "id": "W22FIN-V2-COMPLETE-ORDER",
    "priority": 1,
    "requiredRevision": "c5e7b7badf121fe84079bead388b4d4140a4299a",
    "task": "After checked release, verify complete V2 all-in owner/customer quote, signing, receipt/reserve, cancellation return and rent-only first-invoice readback.",
    "procedure": "docs/pr-cards/W-22FIN.md; use approved existing scoped owner/customer TEST records and read-only provider-authoritative evidence; no production fixtures or automatic refunds.",
    "gates": "Checked READY deployed ancestry; separately permitted authenticated owner/customer records; genuine CPA/counsel clearance and Stripe TEST evidence; LIVE, communications and money-out remain independently gated.",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "Connected synthetic PostgreSQL source acceptance: 1250 related and 52 selected tests passed. Local browser build blocked by sandbox memory; exact-head normal Actions browser/build/review required before merge. V2 source is newer than READY live 4740313d; not deployed or genuinely provider accepted."
  },
  {
    "id": "W23-TENANT-PRIVACY",
    "priority": 6,
    "requiredRevision": "6c95cdef58753aeff4ec042028205fed2ee27407",
    "task": "Owner readback retention default OFF, hold/claim exclusions and audited release",
    "procedure": "docs/pr-cards/W-23.md",
    "gates": "Privacy/legal approval before erasure; owner test account only",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Privacy/legal approval before erasure; owner test account only"
  },
  {
    "id": "W23-CONTACT-ISOLATION",
    "priority": 6,
    "requiredRevision": "6c95cdef58753aeff4ec042028205fed2ee27407",
    "task": "Customer/staff/tenant foreign/future contact denial and one-use repair link",
    "procedure": "docs/pr-cards/W-23.md",
    "gates": "Consented role/tenant fixture; no real SMS or PII writes",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Consented role/tenant fixture; no real SMS or PII writes"
  },
  {
    "id": "W23-PORTFOLIO-REPLAY",
    "priority": 7,
    "requiredRevision": "6c95cdef58753aeff4ec042028205fed2ee27407",
    "task": "Dry-run, cross-account collision, importer replay proof",
    "procedure": "docs/pr-cards/W-23.md",
    "gates": "Owner-approved disposable properties; no real landlord writes",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Owner-approved disposable properties; no real landlord writes"
  },
  {
    "id": "W24-ONE-LINK",
    "priority": 5,
    "requiredRevision": "408a38d40802ee18b80040c6cda5ab707bb19f46",
    "task": "Signed customer quote, Stripe TEST settlement, account and portal",
    "procedure": "docs/pr-cards/W-24.md",
    "gates": "Real approved owner/customer TEST records; no LIVE payment",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Real approved owner/customer TEST records; no LIVE payment"
  },
  {
    "id": "W24-ROAD-PRICING",
    "priority": 6,
    "requiredRevision": "408a38d40802ee18b80040c6cda5ab707bb19f46",
    "task": "Verified route origin, 15/30/50 driving miles and frozen price",
    "procedure": "docs/pr-cards/W-24.md",
    "gates": "Owner-approved driving proof; no paid API",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Owner-approved driving proof; no paid API"
  },
  {
    "id": "W24-DELIVERY-CONFIRM",
    "priority": 5,
    "requiredRevision": "408a38d40802ee18b80040c6cda5ab707bb19f46",
    "task": "Receipt-backed Requested visit/To Do, lock/no-show fee OFF",
    "procedure": "docs/pr-cards/W-24.md",
    "gates": "TEST paid receipt and nonproduction job; no real dispatch",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. TEST paid receipt and nonproduction job; no real dispatch"
  },
  {
    "id": "W25-PHONE-OWNER",
    "priority": 6,
    "requiredRevision": "7df3205e7c0d2406a94c9df72290fd58ef553aeb",
    "task": "Owner/admin new/existing customer phone draft, prefill, link copy and denial",
    "procedure": "docs/pr-cards/W-25.md",
    "gates": "Approved role and customer fixture; no verbal signing/card capture",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Approved role and customer fixture; no verbal signing/card capture"
  },
  {
    "id": "W25-PHONE-EMAIL",
    "priority": 5,
    "requiredRevision": "7df3205e7c0d2406a94c9df72290fd58ef553aeb",
    "task": "Existing email gate, genuine inbox, customer approval, signed TEST payment",
    "procedure": "docs/pr-cards/W-25.md",
    "gates": "Consented recipient and verified TEST receipt; no unsolicited message",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Consented recipient and verified TEST receipt; no unsolicited message"
  },
  {
    "id": "W25-SUPPORT-INBOUND",
    "priority": 7,
    "requiredRevision": "7df3205e7c0d2406a94c9df72290fd58ef553aeb",
    "task": "Actual support@ inbox receipt and authorized reply proof",
    "procedure": "docs/pr-cards/W-25.md",
    "gates": "Read-only MX/SPF/DKIM/send-as PASS 2026-10-16, but no real inbound/reply done",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Read-only MX/SPF/DKIM/send-as PASS 2026-10-16, but no real inbound/reply done"
  },
  {
    "id": "W25-PHONE-PROVIDER",
    "priority": 8,
    "requiredRevision": "7df3205e7c0d2406a94c9df72290fd58ef553aeb",
    "task": "COM Denver seven-day routing, voicemail holds and $20 notice thresholds",
    "procedure": "docs/pr-cards/W-25.md",
    "gates": "Twilio purchase, forwarding and recording OFF pending explicit owner approval",
    "status": "PENDING",
    "dependsOn": [],
    "lastEvidence": "2026-10-16: source merged; READY live still 4740313d. No live/provider proof. Twilio purchase, forwarding and recording OFF pending explicit owner approval"
  }
]
```
<!-- release-acceptance:end -->

## October 14 recovery rerun owner authentication — follow-up

## W-22D18 — signed rental gets a real draft delivery job and owner To do

PR #441 (D17) merged with all exact-head checks; normal daily release
remains on `live` for production. D18 is scoped to Amendment B S6:
a non-renewal customer signature atomically persists one unassigned,
unscheduled DELIVERY job unless one already exists. The active agreement's
To do links the actual job until owner schedules delivery. This is
owner/admin finance-context work; staff and customers do not receive
the owner reminder. Signing remains different from receiving money:
verify the signing payment before dispatch, and do not auto-book or
notify the customer.

Disposable PostgreSQL signing/renewal and role/To do unit tests pass;
authenticated browser and exact-head Actions still need independent
evidence. Actual Stripe TEST and W-22 complete signing-through-delivery,
all-in quote/website acceptance, CPA IN-79, legal and LIVE remain open.
PR #438's concurrent source repair and verified October 14 READY deployment are preserved. Recovery additionally checks GITHUB_TRIGGERING_ACTOR and github.triggering_actor, so non-owner reruns of the owner's prior recovery cannot promote a newer day. Original and triggering actors must both be christcr2012, on main with explicit recovery input. Negative tests cover another/missing triggering actor. Exact-head CI and existing application/provider gates remain mandatory.

## Owner standing rule — complete configurable work despite professional review (2026-10-14)

The owner directed every subsequent session to **keep building approved
capabilities that depend on attorney/CPA/bookkeeper review** wherever safely
possible. The restriction applies to **conducting affected real business**
until review is approved, not developing/testing/merging the project; unrelated
business remains usable. Build changeable, validated, authorized, audited and where necessary
effective-dated settings plus end-to-end tests; preserve immutable signed and
billed evidence and fail closed at the exact unapproved customer charge,
binding term, filing or LIVE action. Never presume the answer or silently
activate on passing CI. See AGENTS.md, SESSION-START and OWNER-INPUTS.
W-22 IN-79 remains an explicit setup-tax **charge/send approval gate**, not
a reason to defer the surrounding all-in disclosures, owner policy configuration
or other implementation. Genuine legal/CPA/customer/Stripe TEST acceptance
remains separately OPEN. Next engineering priority remains cohesive W-22
completion, not further single-helper slices. No release authorized.

# STATUS — current work, blockers and next action

## October 14 release recovery — live verified, trigger repair pending PR #438

The scheduled 00:01 Denver event was absent on October 14. Owner-authorized
same-day recovery subsequently fast-forwarded main and live to the checked
`f4cd4ea1bc984b0bf01cecd0599cf13f4f6d5e20`. The dated
`live-promotion/2026-10-14` Git tag independently resolves to that SHA.
Vercel deployment `dpl_BBHMiZJUn9jEtTPwssR3g1yP9KbT` is READY
at the exact live commit, with the production aliases
`robinsonappliancerentals.com` and `www.robinsonappliancerentals.com`
assigned and no alias error. This is release/deployment evidence,
not authenticated Stripe/customer workflow acceptance.

PR #438 fixes the missed trigger with bounded Denver and UTC fallbacks,
owner-only manual recovery, and a checked no-op daily receipt to prevent
extra intraday promotions if the 00:01 run succeeded with no changes.
Existing exact-main ci and release-policy, atomic dated marker, ancestry
checks, production/spending gates and no-force rules remain mandatory.
W-22D17 manual/Stripe TEST refund evidence reconciliation remains
independent and has not moved any customer funds.

## W-22D17 external refund reconciliation (current implementation branch)

Based on the checked D16 cancellation and October 14 `f4cd4ea`
production release, the isolated branch `ai/gpt6/w22d17-refund-reconciliation`
adds owner-only recording of an **externally completed** refund. It rechecks
the original receipt and pending cancellation under database locks and
stores the unique return reference, method, actual event date and audit.
Manual check/bank/cash is labelled owner-attested; Stripe TEST requires a
read-only provider refund success matched to the original charge, USD
currency and approved cents, and is disabled for production/LIVE mode.
The pending Today item only disappears on a committed return record.
No money-out, messages, tax choice or production fixture was executed.

**Evidence:** five disposable PostgreSQL cases and three provider/policy unit
cases passed; browser/auth/accessibility, exact-head CI and real Stripe TEST
provider acceptance are separately pending. Work packet W-22D17 is active;
W-22 stays PARTIAL. The October 14 live release is proven at `f4cd4ea`.
The separate release reliability repair PR #438 merged to main; normal
daily checked live promotion applies to it, not immediate deployment.


## October 13 verified release and W-22D16 implementation (current)

**Observed current GitHub:** main and live are both `7e0d99fa8701d318421d95eb4cfed79c52d3cff5` (#436); no open PRs or issues and no unfinished remote implementation branches. The two `archive/` branches are intentional and must not be merged. The exact-head CI, release-policy and housekeeping workflow passed. **Observed Vercel production:** deployment `dpl_oGFdAyB13CjvKBdnTPMjQGh27wwH` is READY for exactly the same `live` SHA and assigned public aliases, without alias error. This confirms the October 13 one-time release outcome; normal reviewed daily releases resume. It does not prove authenticated app/Stripe acceptance.

**Current branch in this handoff:** `ai/gpt6/w22-pre-delivery-cancellation-20261013` from current main. Work packet W-22D16 implements **approved IN-76 pre-delivery owner cancellation and accountable refund-due workflow**, not a money-out transaction. Owner/admin reviews receipt, delivery, signed terms and pending charges, confirms full or eligible large-order retention, and the atomic agreement cancellation stores explicit refundable/retained cents with a permanent audit and high-priority refund To do. Settings define the 72-hour large-order full refund window. Undelivered unpaid agreements have zero refund. Existing signed obligations, invoice payments and deposits are not silently ignored. Generic cancellation may not release collected signing funds without the review. No Stripe refund, live payment, automatic communication, tax decision or production write is activated.

**Evidence so far (pre-PR; rerun at final head):** schema validates, 5 policy unit cases pass, 4 real disposable PostgreSQL integration tests pass, work packet selector/anchor check passes. Typegen succeeded; a 2GB-default-heap typecheck ran out of memory in local sandbox and a bounded heap retry is underway. Saved-session browser spec and full Actions validation still required. No merge or deployment of this feature claimed here.

**Next owner-gated acceptance:** independently verified external refunds, provider state after cancellation, legal review of signed cancellation terms, CPA IN-79 administrative-fee tax, and Stripe TEST real-provider acceptance remain separate. W-22 remains PARTIAL; W-23 sequencing gate remains. Next approved independent W-22 work is visible without requesting routine approvals already supplied.

---


## Invoice-list performance investigation — index correction (PR pending, 2026-10-13)

Post-#432 main `917b22c` is the verified baseline. Investigated the
independent #429 5,000-invoice performance failure (5.42ms against 5.304ms
guard) using disposable PostgreSQL and the actual count+page operation.
EXPLAIN found sequential scan and top-N sort over 5,002 rows because the
billing page orders by createdAt DESC and id DESC without a compound index.
One isolated same-fixture before/after probe measured 3.82 -> 1.63 ms/op
medians and EXPLAIN execution 1.551 -> 0.045ms with a disposable matching
index. Root cause is demonstrably missing sort support; variability across
runners still exists and is not explained away. The additive schema migration
and index-regression test are undergoing full local/Actions validation.
No threshold/fixture change, performance waiver, spending or deployment.

W-22D15 (#432) merged with exact-head PR CI/review after safe failure
deadlines and owner/manual evidence; provider Stripe TEST remains unverified.
Owner IN-75/76 now answered, but case-specific refund authorization, counsel
and implementation remain pending. Rental-only IN-84 answered and no
rent-to-own scope. CPA IN-79 OPEN, W-22 PARTIAL, W-23 blocked.
Next product unit: JIT W-22 cancellation and signing-through-delivery
completion after this independent measured performance repair.


## Historical W-22D15 — PR #432 merged (superseded recovery handoff)

Current upstream main `2ba7776b462436ecb2b35dcab35a26e4b5477257`
includes owner decisions #433/#434. The updated W-22D15 branch includes that
exact main through a normal merge, without rebase. The former ambiguous
Playwright alert selector and Codex finding (missing same-day failed-payment
deadline and failure timestamp) are fixed. Codex review thread is resolved
with exact-head test evidence. Workflow-dispatched CI run `38460370577` passed
all three unit shards, four browser shards, secret/static and aggregate gates
at `4b8b899`. However a GitHub Actions-bot branch synchronization caused
pull-request workflows to report `action_required`, so ruleset 24419414
still considered required PR-context `ci` missing and refused merge.
Historical resolution: a GitHub-App-authored PR sync established the
required exact-head pull_request CI run `38461068954`, which passed,
and PR #432 merged as main `917b22c` after all review threads were resolved.
No bypass, waiver or manual Vercel release was used.

W-22D15 owner To do shows one failed attempt with same-day deadline
based on persisted attempt update time, distinct from pending/ordinary
unsigned/uncaptured money. The owner agreement page shows failed
evidence and existing separately confirmed MANUAL money-in path.
Still no automatic provider retry, fabricated receipt, scheduled visit,
Stripe LIVE or refund. Actual provider TEST acceptance remains unverified.

Historical #429 independent benchmark red: 5,000-invoice 5.42ms against
the unchanged 5.304ms guard. A different isolated PostgreSQL run
measured 5.11ms (samples 5.11/4.76/5.86/4.82/5.79). At the time
these results suggested unexplained variation. **Superseded by
PERF-INV5000 / PR #435 above:** direct EXPLAIN and same-fixture
before/after measurement subsequently established the missing
createdAt/id sort index as a genuine query bottleneck, while
runner-to-runner latency variation still merits monitoring.
Do not waive, remove or rebaseline the regression guard.

Owner IN-75 relocation and IN-76 cancellation **answered** in #433:
$75 per relocation job requires case approval and no second $45 setup;
ordinary before-delivery refund is full regardless of scheduling;
commercial default full refund within 72 hours, then setup-fee
retention with returned down payment, subject to explicit owner review,
contract/counsel and independent money-out approval. These are NOT
implemented or authorized to pay out by this PR. Owner IN-84 in #434
confirms rental-only (no rent-to-own) and the disclosed editable
5-calendar-day grace / one $5 fee on day 6 per overdue installment;
actual activation remains gated on correct terms/legal review.

CPA IN-79 remains OPEN, W-22 PARTIAL, W-23 blocked.
Never auto-activate LIVE, messages, spending, refunds,
production data changes or Vercel release.

**2026-10-13 owner-policy reconciliation (documentation only):** Newly approved business choices are recorded in [OWNER-INPUTS](OWNER-INPUTS.md) and [the text/voice decision appendix](owner-decisions/2026-10-13-text-voice-reconciliation.md). The old IN-75/76 'recommendations only' language in historical handoffs is superseded by those *owner answers*, **not** by verified code. W-22 remains PARTIAL; CPA IN-79 OPEN; W-23 blocked; no provider/LIVE/money-out/publication gates waived.

## W-22D14 — new hookup proof per delivered appliance (PR #429 under verification)

New per-machine true/false/unknown hookup evidence, missing-item high-priority
follow-up, PARTIAL visit and unchanged delivered custody/billing are implemented.
A saved-session staff browser test exposed an actual server-page projection omission:
although `getDeskJobById` selected the persisted field, `page.tsx` dropped it
before `JobDetailPanel`. The page now forwards it to STAFF and owner; existing
browser regression asserts visible evidence before and after reload. Old records
remain NULL (unknown). Selected local database/related tests and quick checks
passed; the local Next.js browser build was killed (137) by this 4GB sandbox.
Exact-head GitHub CI/browser, performance and review are still required. The
branch merged current #431 fixture isolation and #430 official Postgres image,
keeping both other-agent changes and all existing tests. No automated review
was available due to Codex quota; manual disposition must be recorded.
W-22 PARTIAL, CPA IN-79 OPEN, IN-75/76 recommendations only, W-23 blocked.
No LIVE, money-out, customer communications, spending or manual release.

## Owner-requested release maintenance — shared fixture isolation (2026-10-13)

The six MCP production aliases reached READY at their checked release snapshots.
Appliance Desk release automation fixes #428 and registry recovery #430 are merged.
The owner explicitly requested a one-off manual release after checks; routine
agent development still merges main, and nightly checked main→live runs at
00:01 America/Denver. Provider LIVE, communications and spending gates remain.

Main run 38404970079 proved an intermittent W-22 signing failure: indirect callers
of seedTaxReadyContext were not in SHARED_SETTINGS_TESTS and could overwrite or
restore BusinessSettings.singleton while another fixture signed an agreement.
Ten existing helper callers now join the serial lane; the guard recognizes helper
calls even without an inline database-name marker. No application money/tax
semantics, assertions or suites are removed. Local source/config inventory and
secret checks pass; full exact-head Actions unit/browser and main checks remain
required before release. Active W-22D14 PR #429 is left to its existing agent.


## W-22D13 PR #427 — shared-settings CI recovery (2026-10-13)

Live GitHub PR #427 head `cbc96f7` passed all four saved-session browser
shards, static gates and policy checks; full CI failed in shard 1 on
`tax-migration-integration` because its assertion read the writable
`BusinessSettings.singleton` after unrelated serialized integration
fixtures exercised Colorado tax choices. The test now verifies the **actual
database column defaults** using a short-lived separately named settings row,
with `finally` cleanup and without changing business tax decisions or
resetting other tests' state. Its isolated disposable-PostgreSQL run passed.
Performance baselines independently failed before tests on a public ECR
PostgreSQL 17 image pull (`toomanyrequests`); use documented, authorized
retry/recovery, not test removal. Re-run full exact-head checks after the
single corrective commit; inspect/waive unavailable automated review only
with recorded manual-review disposition, then merge if all gates pass.

D13 implementation remains owner/admin-confirmed money-in evidence on one
signed agreement, not a Stripe charge or invoice-wide credit. W-22 PARTIAL,
CPA IN-79 OPEN, IN-75/76 recommended only, W-23 blocked. No money-out,
customer communications, LIVE Stripe or manual production release.

## W-22D13 — owner-recorded signing payment (2026-10-12/13; CI pending)

Verified predecessor #426 merged to main 9087bc2fb3ec40a176f821809551a9b9c17470c1.
Active JIT packet is W-22D13. The OWNER/ADMIN-only manual signing form
and server action record exactly the immutable reviewed signed amount after
explicit real-money confirmation. They reuse the MANUAL attempt and
actor/agreement locks, write one auditable MANUAL Receipt, and create a
down-payment entitlement only for the signed agreement. They do not
allocate to another property's invoice, mark invoice PAID or refund.
The initial genuinely frozen/signed five-machine $35 disposable PostgreSQL
test passes all four cases including concurrent replay/denied roles.
Selected typecheck, lint, static and source/disposable-Postgres checks
passed (21 selected tests). The local Next.js browser build OOM-killed at
exit 137 in the known 4-GB sandbox; browser did NOT run locally. Required
unmodified GitHub exact-head CI/browser and review remain pending; this
is not provider acceptance.

Next after D13: independently approved per-machine new-hookup and
downstream W-22 workflows; cancellation/refund policy IN-76 must be
reconciled before affected money-out; CPA IN-79 still OPEN.
W-22 PARTIAL, W-23 blocked, LIVE/communications/spend unchanged.

## W-22D12 first-invoice shared display (2026-10-12; external gates independent)

D12 extends the read-only invoice DTO with existing line kinds and clarifies
on the shared owner/customer/print document that verified first-month money
is **already deducted** as one invoice CREDIT. "Paid on this invoice" is
separate; existing tax, due, paid, balance, status and authorization remain
unchanged. Synthetic $60 rent + $4.80 tax - $60 signing credit gives $4.80
due and OPEN until actual independent invoice payment. Saved-session
owner/customer browser tests and unit/disposable-Postgres tests verify
print/mobile/dark/keyboard/axe, pending, replay, property isolation and
draft denial. Do not equate mock/provider-shape tests with real Stripe TEST
acceptance. Local selected typecheck/lint/static/DB/unit checks passed (38 selected tests),
but local Next.js production build was OOM-killed (137) in the 4-GB sandbox,
so local browser did NOT run. This is the repository's known anti-stall
resource limit, not a waived test. PR #426 exact head a247580
passed ALL GitHub CI and browser shards, capacity, security and release policy;
manual review disposition recorded because Codex review quota was exhausted.
#426 merged as main 9087bc2fb3ec40a176f821809551a9b9c17470c1.
No extra hosting spend was approved.

Next after D12: owner-recorded signing payment, then approved cancellation/
refund and per-machine hookup in prerequisite order. IN-75/76 remain
recommendations unless owner answers exist. W-22 PARTIAL, CPA IN-79 OPEN,
W-23 blocked. No LIVE Stripe, money-out, external communications or spend.

## Verified Next.js security patch follow-up (2026-10-12)

Runtime Next.js and matching eslint-config-next are pinned to 16.3.8, a patch
update from 16.3.6. Npm's actual advisory ranges all ended below 16.3.8; registry
metadata confirmed this exact release exists. No blanket npm audit fix or framework
major/minor migration. Existing signed/payment/owner/hosting contracts are unchanged.
This security follow-up inherits merged #424's execution toolkit and checked D12
packet; no new product scope or five-PR padding.

Local proof: real clean safe install, 58 tooling Node regressions, focused session/preview
tests, complete preflight/typecheck/lint, index/links and audit readback passed.
Next is absent from the actual post-patch npm audit. Exact-head CI/review/merge,
deployment and provider acceptance still require their own evidence. Next: finish exact-head regression/CI
and review, then resume W-22D12 with `npm run work -- start`. No LIVE activation.

A separate **development-tool** advisory affects braces <=3.0.3 through fast-glob /
micromatch / eslint-config-next. Registry version enumeration ends at 3.0.3; braces 3.0.4 lookup returns E404; npm's proposed eslint-config-next 14 downgrade
is not a compatible repair for Next 16. No untrusted user glob input was found in
this project's lint workflow. Keep this precise upstream follow-up visible; recheck
when a compatible patched braces release or reviewed parent dependency is available.
This does not block the verified Next patch or D12. No clean-audit claim.

## Current execution tooling and next capability (owner request 2026-10-12)

**Inspected prerequisite:** #423 merged; main `600f93ed`. Its exact-head CI,
performance and daily-release-policy runs passed. Recheck current GitHub/main,
concurrent work and reviews at session start. No real Stripe TEST acceptance claimed.

**MERGED #424** at main `059fa296c37f160163e6428c3ff6770f7ef3e790`; exact PR-head CI/release-policy passed; manual review disposition is on #424. #424 post-merge main CI run 38324577116 and release-policy run 38324577229 passed; recheck at future heads.

**Implemented:**
- `npm run work -- start` validates and prints the bounded active packet;
  `read <number>` prints bounded code/design context; `route <unit>` gives later
  scope anchors, never inferred dependency eligibility.
- `check`/CI reject stale existing references, unsafe paths/selectors and wrong
  parents. `plan` reports proposed test files; `verify` refuses missing tests and
  runs normal preflight; `probe` is only disposable-DB diagnosis.
- `doctor` diagnoses hook/lock/dependency setup without exposing credentials;
  `install` safely supplies synthetic localhost config to per-worktree npm ci/Prisma
  generation, avoiding the reproduced missing-DIRECT_URL startup failure;
  `drift` shows changed integration paths; `metrics` reports bounded local
  passed/failed/cached timings; `prompt` produces an unverified restart draft.
- Actual-content check fingerprints survive staging/commit of identical files;
  real changes, modes and merge conflicts invalidate evidence. Secret scans cover
  tracked/non-ignored new files before staging too, preserving the gate. All existing
  test/authorization/exact-head gates remain. No product financial code changed.
- Active W-22 card is short; historical implementation log preserved. Old
  ~800-line stop and manual preview/batch-release contradictions reconciled.
  Larger cohesive capabilities are permitted with explicit risk/validation.

**Local validation:** 58 Node regression tests pass; index validation preserves all
144 card groups/148 acceptance units and changed active links. Disposable-Git
cache comparison: three old keys versus one new key for stage/commit of identical
files. Secret scan and complete sandbox preflight (typecheck/lint/static checks) pass;
safe offline installer/generation and doctor were exercised in the real worktree.
The following quick gate reused all seven passing checks. #424 exact-head CI/release-policy and the documented manual review disposition passed before merge; these local figures do not claim a total project speedup.

**Next:** W-22D12 ([card](pr-cards/W-22D12.md)); run `npm run work -- start`.
Prove/repair exact signing credit, tax, actual paid amount and balance through
webhook mirror → scoped invoice DTO → shared owner/customer document/print.
Its new regression/browser files are **proposed**, not implemented. Then select
eligible manual settlement/cancellation/delivery remainder from W-22; retain
CPA IN-79, LIVE/money-out gates, real TEST evidence distinction and W-23 dependency.
This owner-authorized maintenance request is one cohesive PR, not a five-feature batch.

## W-22D11 exact first-invoice Stripe credit — MERGED #423; actual provider acceptance remains open

Approved goal: correctly deduct signing first-month rent from its **own**
subscription's first invoice, once, without billing a second agreement.
Merged #423 implements an immutable receipt/credit invoice application
journal, a negative agreement-tagged subscription first-invoice item,
readback against actual provider object IDs, UNKNOWN outcome recovery and
local webhook CREDIT mirroring. Disposable PostgreSQL/mocked-provider checks
are implementation evidence; authenticated real Stripe TEST acceptance has
**not** been observed. Neither success at subscription creation nor a credit
journal declares invoice **PAID**. The customer/owner invoice display must
still be audited end-to-end before this milestone closes.

**Blocker investigation and re-entry** (AGENTS scoped-blocker rule):
- CPA **IN-79**: external determination of Colorado taxable administrative
  setup fee; the prior decision is already recorded as OPEN in OWNER-INPUTS.
  Prerequisite: CPA-backed classification; re-open tax configuration/acceptance
  when the actual decision is recorded; next: ask CPA, never invent the rate.
- Real Stripe TEST application: no authenticated, verified TEST invoice
  integration evidence is available in this session. This blocks **provider
  acceptance**, not local implementation/testing or unrelated approved work.
  Re-check configured authorized TEST credentials/environment before acceptance,
  never use LIVE; next: run an isolated real TEST flow and reconcile provider
  invoice/negative line/receipt with PostgreSQL evidence when accessible.
- W-23 requires actual W-22 completion (including cancellation/refund and
  delivery); not eligible merely because this code/CI is green. Recheck
  once W-22 acceptance is complete. Continue the next approved independent
  W-22 cancellation/delivery work rather than stopping for CPA/TEST gates.

## Permanent milestone handoff and acceptance matrix (2026-10-12)

**Outcome:** Every eligible signed agreement can move through exact payment,
receipt, first invoice, and delivery without double charging or crediting a
sibling property's bill. This W-22 batch is an outcome boundary, not a quota.

| Capability / criterion | Code | Automated proof | Deployed / real integration acceptance | Next |
| --- | --- | --- | --- | --- |
| Frozen signed amount and TEST Stripe settlement | Implemented through #420 | Exact-head CI and disposable PostgreSQL; authenticated provider evidence path tested | LIVE disabled; no live end-to-end acceptance | Keep existing isolation and reconciliation |
| Receipt-bound per-agreement down-payment entitlement | Implemented in W-22D9 (#421) | Disposable PostgreSQL and exact-head #421 CI passed | Real acceptance not observed | Reuse in D12; do not rebuild entitlement |
| First delivery invoice credit exactly once (local and Stripe) | #423 merged exact provider application/mirror; #422 barrier retained | #423 exact-head CI, performance and daily-release-policy passed; disposable DB/mocked-provider tests | No authenticated TEST provider acceptance; LIVE off | D12 owner/customer invoice amounts and integrated proof; real TEST readback when available |
| Cancellation, refunds, and per-machine hookup/delivery acceptance | NOT complete | NOT proven end-to-end | NOT accepted | Follow the approved W-22 dependency chain after credit accounting |

**Deferred-blocker register:** IN-79 requires CPA-backed Colorado setup-fee
classification (dependent on approved W-22 tax category); reopened only after
the CPA determination is recorded in `docs/OWNER-INPUTS.md`, tax configuration
and behavior verified. Next: ask CPA the existing IN-79 question, not owner to
repeat an answer. W-23 depends on W-22 actual completion and acceptance;
reopen only after W-22 criteria are genuinely met. Stripe LIVE and money-out
remain subject to their separate existing explicit owner approvals; next:
TEST-only accounting, no activation/spend. W-24 customer delivery-date choices
have their own separate work index dependency; do not silently pull them into
W-22. Recheck this register at session start and after owner input, PR merge
or hosted integration change. Existing hosting-cost policies remain in force.

## W-22D10 first-invoice double-charge barrier (MERGED #422)

Recurring Stripe subscription setup now checks the W-22 signed payment and
receipt-backed credit before any provider claim or product/subscription call.
A positive down payment (unpaid, inconsistent, or already collected) blocks
a new first rent invoice until its exact agreement-specific Stripe invoice
application is implemented and reconciled. The existing billing-blocked To do
shows an actionable agreement link and the reason. Historical/waived/no-credit
agreements keep their existing path. Even an already-recorded subscription is
flagged for owner reconciliation instead of being called safe. No new payment,
credit application, delivery permission, owner approval or LIVE activation.
Next: W-22D11 negative first-invoice item on the *matching* subscription,
durable local allocation, real Stripe readback/retry, and portal amounts.
IN-79 OPEN, W-22 PARTIAL, W-23 blocked.

## W-22D9 settled down-payment entitlement (PR #421)

The Stripe TEST receipt now creates one immutable per-agreement down-payment entitlement with exact frozen amount, fingerprint and receipt; PostgreSQL rejects altered and foreign allocations. This is NOT an applied invoice credit. Next: invoice-specific application and provider readback, then cancellation, refund and delivery. CPA IN-79 OPEN; W-22 PARTIAL; W-23 blocked.

## W-22D8 verified Stripe TEST signing receipt settlement (PR #420)

Authenticated Stripe TEST signing checkout events now reconcile the immutable
accepted agreement/attempt with the payment intent's succeeded status, exact
USD cents, metadata and unique charge. Under the established short locked
webhook transaction the provider charge creates one durable customer receipt,
marks the attempt SUCCEEDED and the obligation SETTLED; event replays never
double-record cash. Unpaid Checkout completion is not settlement, failed
asynchronous attempts can be retried, and duplicate/altered/live evidence is
rejected. Production activation remains blocked. **The collected first-month
down payment is recorded but is NOT yet credited against an invoice.**
Next W-22: per-agreement, replay-safe first-invoice credit/application,
cancellation/refund decisions and per-machine delivery acceptance. CPA IN-79
OPEN; W-22 PARTIAL, W-23 blocked. Hosting controls remain in
docs/HOSTING-COST-POLICY.md and the merged .github policies.


## October 12 hosting-cost handoff integrated into W-22D7 (#418)

Latest main includes the owner-directed daily checked main-to-live workflow
(#417) and verified Neon 0.25 CU/300-second idle policy (#419).
The consolidated `docs/HOSTING-COST-POLICY.md` links the authoritative
merged policies and forbids automatic previews, manual promotions, unapproved
resource increases and Stripe LIVE activation. The requested separate hosting
handoff branch was not present in the appliance-desk remote at verification;
this integration uses the merged policies and explicit owner instructions.


## W-22D7 TEST signing Checkout (PR #418)

The signed, frozen per-agreement amount can now be used to create an idempotent
Stripe TEST hosted Checkout session. The provider ID is stored against the
durable attempt after its cents, currency, fingerprint and agreement ID are
verified; repeat calls retrieve it instead of opening another session. An
unknown old attempt and non-test/production configuration fail closed. Checkout
completion is **not** payment settlement; no invoice credit or paid status
is set. The existing webhook now explicitly rejects W-22-tagged Checkout events
rather than misclassifying them as legacy deposit payments. The service is not
exposed through a public route while CPA IN-79 and
owner LIVE approval remain open. Next: authenticated webhook verification and
durable receipt settlement, then first-invoice credit. W-23 stays blocked.

## W-22D6 durable collection attempt reservation (PR #416)

A transaction now rechecks signed immutable W-22 evidence against its stored unpaid obligation
before reserving a uniquely keyed checkout/manual collection attempt. Concurrent/replayed requests return
the same still-active attempt, unauthorized manual methods are blocked, and DB constraints reject
invalid methods, totals or statuses. This is **not** Stripe collection or proof of payment.
Existing receipts, invoices and paid-state remain unchanged. Next: provider checkout integration
with hard CPA IN-79 activation gate, then verified settlement and replay-safe first-bill credit.
W-22 remains PARTIAL; IN-79 OPEN; W-23 blocked.

## W-22D5 outstanding signing payment To do (PR #415)

Finance-authorized OWNER/ADMIN users now see positive, still-unpaid frozen
signing obligations in the `/desk/today` To do list, with exact amount,
customer, signed time and an agreement-specific review action. The bounded
oldest-first query reports truncation; STAFF sees no financial information.
Waived zero-fee agreements and any future settled records are not presented
as unpaid. These are manual follow-ups, **not recorded receipts**: no Stripe
checkout, payment settlement or first-bill credit is enabled. W-22 remains
PARTIAL, CPA IN-79 OPEN, W-23 blocked.


## W-22D4 atomic signed payment obligation (PR #414)

The same locked database transaction that signs a reviewed, frozen W-22
agreement now records exactly one immutable, per-agreement payment
**obligation** with complete fee, setup tax, down-payment and total cents.
Duplicate/replayed signature and failed obligation insert roll back; a DB
constraint refuses false paid statuses or unreconciled money. This is
not a charge, receipt, down-payment credit or permission to schedule delivery.
W-22 remains PARTIAL, CPA IN-79 OPEN and W-23 blocked. Next: owner To do
for payment owed, followed by separately reviewed Stripe/manual settlement,
replay-safe first bill credit, refunds and per-machine hookup proof.


## W-22D3 pending signing payment message (PR #413)

After signing the frozen reviewed offer, the customer now gets an exact
**still to pay** amount or a human-review warning; signing alone is not a
receipt. The old Checkout is not called for any W-22 evidence, while legacy
no-W-22 signing and renewals preserve their existing paths. The owner must
still arrange a payment; no W-22 Stripe/manual provider collection or first
invoice credit is implemented by this slice. Anti-stall runbook records the
October 12 PR #412 waiting-for-merge/sandbox expiration incident and a
required two-lane handoff checkpoint. W-22 remains PARTIAL; IN-79 OPEN,
W-23 blocked. Next: version-scoped signing payment and replay-safe settlement.


## W-22D2 verified signed payment readiness (PR #412)

After W-22D1 #411 merged, a read-only, repeatable-read payment gate now
requires an actually signed ACTIVE agreement, the full independently verified
frozen sibling order, and the exact accepted agreement-specific signature
proof. Legacy deposit/waiver or prepaid state blocks collection preparation,
as do mismatched order cents/hash; no invoice, provider or receipt is written.
This is a prerequisite, **not checkout or payment settlement**. Next: durable
provider request and replay-safe W-22 payment records, then first bill credits,
refund/cancellation and delivery evidence. CPA IN-79 OPEN, W-22 PARTIAL, W-23 blocked.


## W-22D1 frozen-payment safety (PR #411)

Signed W-22 fee/tax/down-payment evidence now has a provider-independent,
per-agreement payment-line planner. Legacy deposit/waiver Checkout refuses
new or incomplete W-22 evidence before Stripe, rather than charging an
amount different from the accepted offer. Historical no-W-22 Checkout remains.
This is **not payment integration or settlement**: next W-22D2 must build
the recoverable Stripe/manual path, proof-bound webhook and first-bill credit.
IN-79 OPEN; no live money or CPA treatment enabled. W-22 PARTIAL, W-23 blocked.

## W-22C6C signed document proof (PR #410)

The signed artifact now retains reviewed all-in setup/tax/down-payment cents
and frozen SHA-256 provenance in the immutable contract payload and HTML.
It rejects conflicting stored signature evidence and never implies payment
settlement. W-22 remains PARTIAL; IN-79 CPA decision OPEN, W-23 blocked.
Next: approved W-22 payment settlement, first-invoice credit, exceptions,
cancellation/refunds and delivery proof in card order.


## W-22C6B guarded frozen send/sign (candidate PR #409)

A server-side link now binds the customer-visible tax-inclusive signing
amount to the independently frozen per-agreement order fingerprint. A
missing or mismatched snapshot denies send/sign. The public signing page
shows exactly that address's setup, tax and down-payment evidence and does
not claim payment. This remains unmerged pending full CI/review. W-22 PARTIAL;
CPA gate IN-79 OPEN, W-23 blocked.


## W-22C6A — frozen evidence integrity readback (#408)

The server-only readback verifies all per-agreement cents, customer ownership/address and the canonical tax/jurisdiction fingerprint. JSONB key order is normalized. It cannot send, sign or collect. W-22 PARTIAL, CPA IN-79 OPEN, W-23 blocked; next W-22C6B guarded send/sign and customer totals.


## W-22C5 reviewed frozen charge evidence (merged #407)

The private owner-only freeze now stores each prepared agreement's immutable, versioned, tax-inclusive signing evidence and independent jurisdiction proof. It does not send, sign or collect; the subsequent units are W-22C6A integrity readback and W-22C6B guarded send/sign/customer presentation. IN-79 CPA gate remains OPEN and W-23 blocked. See W-22 card and independent test evidence.


## October 11 development-infrastructure upgrade (DEV-EFF-406; merged #406)

The separate diagnostic disposable-Postgres probe selects literal DB test specs without expensive import-graph expansion. Existing mandatory preflight, exact-head CI and provider/owner gates remain unchanged. Sandbox stale tracking-ref diagnosis added to recovery guidance. W-22C5 subsequently merged in #407, with saved readback verification in #408; see docs/pr-cards/DEV-EFF-406.md. IN-79 remains OPEN and W-23 blocked.


Updated 2026-10-11 as if PR #402 (W-22C1) merged, following main `1d18648` (#401). COM-L15 #393, W-1 #394,
W-18 #395 and W-22A #396 are merged. W-22 remains partial; no live payments,
customer messages, fee charging or tax filing are activated.

## Metricool marketing integration (owner-requested, 2026-10-09)
MKT-1 public visit tracking is merged in #371; exact-head CI and performance checks passed. Both automated review findings were fixed and regression-tested. Released from live 193b3f7 on 2026-10-09; Vercel production is READY. Actual-domain homepage and launch page serve the configured tracker; login CSP excludes it. Metricool receipt verification remains an open operational check.
Production METRICOOL_TRACKING_HASH controls activation; private routes and data excluded.
The changed privacy disclosure has a new version and retains the owner's existing
review/approval workflow. No approval is recorded automatically.
This independent marketing request does not reorder the COM/W engineering queue.

## Public pricing visibility (owner-requested, 2026-10-09)
MKT-2 merged in #374 and was deployed after exact-head green CI on main dfd0718 to Vercel production READY (dpl_fjKRCAM258aiNSbnByTHGfHnCSZk). Verified live robinsonappliancerentals.com/pricing and /rent/greeley both 307 redirect to /launch; /launch is 200, sitemap/homepage hide pricing. Internal pricing remains intact. The pinned engineering queue is unchanged.

## Business email guide (owner-requested, 2026-10-09)
`docs/EMAIL-AND-ALIASES.md` records every business email address, what it is for, where the app uses it and the
Gmail send-as/label setup. Google Workspace was inspected: all six plan addresses plus `dmarc@` already existed. On
the owner's approval two aliases were added, `privacy@` and `accounts@`, each with a Gmail label and filter (read back
and verified; reversal is in the guide). Open: putting `privacy@` on the website privacy page (needs its own card), IN-02 (public and reply-to email), the DMARC tightening dates
(2026-10-24 quarantine, 2026-11-23 reject) and the GW-08 mail test. No email, SMS or payment switch was touched.
Docs-only change; the engineering queue is unchanged.

## Implementation guidance — documentation update, 2026-10-11

[Implementation recipes](implementation-contracts/IMPLEMENTATION-RECIPES.md) add a
bounded card packet, trusted input/storage mappings, lock/provider/receipt patterns,
fixtures and targeted checks. The linked W-22 persistence example separates existing
code from candidate interfaces; it does not approve a schema, collect money or mark
W-22 complete. Startup and card-writing instructions route agents to only the needed
section. Queue, owner gates, public pricing hide and CI policy remain unchanged.
No application code or tests changed. Verified index, quick gate, diff/path/link
checks; exact-head CI and PR review remain publication gates.

## W-22B0 — private signing-charge draft preview (#398)

The owner/admin agreement detail now previews an order-wide, source-derived
setup-fee and large-order down payment before tax. Conversion siblings share
one fee per location; washer/dryer packages count each machine, and prepaid
rent/active locations avoid repeat charges. The preview is informational,
not an invoice, hosted checkout amount, signed snapshot or customer promise.
Tests: `tests/signing-charge-preview-w22.test.ts`; exact-head CI must be
green before this entry can be considered merged. The #397 recipes were
already incorporated. **Next: W-22B charge/credit persistence**, followed
by W-22C checkout/signing, webhook replay and operational/browser evidence;
IN-79 remains an explicit CPA taxability gate. Do not begin W-23 yet.

## W-22B — versioned signing charge snapshots (#399)

The private billing domain now stores a separate, versioned, idempotent,
per-agreement signing-fee/down-payment allocation from the real saved order
and settings. Same-quote addresses reconcile to one setup fee each, while
each agreement keeps its own initial bill credit amount. The per-agreement
records are **only draft preparation evidence**, not customer-payable lines,
settlement, a frozen signed document or a refund. `frozenAt` protects against
repricing once a successor actually freezes charges. Integration tests use
disposable Postgres and confirm replay, concurrent writers, access, revision,
immutable freeze and multiple delivery addresses; the new model is registered
in backups. Exact-head green CI is still required to merge #399.

**Next: W-22C freeze/tax/signing integration**, then hosted/manual payments,
webhook replay, first-bill credit, cancellation and delivery evidence. CPA
IN-79 remains pending; never activate live money or customer messages.
W-22 and its queue index remain PARTIAL; W-23 cannot begin.

## W-22B1 — owner draft signing-charge preparation and review (#400)

Draft agreement owners/admins can now prepare or refresh private per-agreement
signing-charge allocations on the agreement page, then see each address's
machine count, setup fee, first-month down payment, pre-tax subtotal and
revision in dollars. Every server action reauthorizes before the database
write; the read additionally checks role, customer, quote and draft state.
Missing sibling records are not misleadingly displayed as a complete order.
All prepared amounts are expressly **not signed, payable or settled**.
Eight unit/role/isolation tests pass locally; browser, CI and review remain
exact-head merge gates. No Stripe, customer email/SMS, live payment or CPA
tax treatment was activated.

W-22 remains PARTIAL. **Next: W-22C freeze tax-inclusive agreement/signing
facts**, then guarded hosted/manual payment, replay-safe first bill credits,
refund/cancellation and delivery evidence. W-23 stays blocked until W-22
fully meets its approved acceptance. Stop this chat after merged PR #400.

## W-22C0 — prepared-charge reconciliation (PR #401)

The owner draft-review page checks that one prepared order has all its
agreement allocations, one fee per new location, consistent revisions,
reconciled cents and correct down-payment attribution. A visible warning
separates this private draft from a frozen, tax-inclusive customer contract.
A configured tax treatment does not clear CPA gate IN-79. The agreement send
path is not yet integrated with these checks; do not infer it is protected.
No live collection, customer communication, signatures, invoice credits,
refunds or deliveries were changed. W-22 stays PARTIAL, and W-23 stays blocked.
Next: W-22C signed immutable tax-inclusive facts + guarded send.

## W-22C1 — independent administrative setup tax category (#402)

W-22's administrative setup fee now has its own database tax charge category
and invoice-line kind. Existing rental, installation and other tax decisions
never answer this new category. The new default jurisdiction rule is
UNDECIDED. CPA IN-79 remains OPEN; this is only taxonomy/policy scaffolding,
not a signed all-in total or permission to collect a fee. No provider or
customer billing changes. Next: W-22C reviewed immutable all-in signing
facts and send enforcement; W-23 remains blocked.

## Next

### W-1 owner To do workflow — merged #394

W-1 adds one clear action per exception, genuine Denver-time deadlines, exact outstanding balances, and a private durable owner/admin snooze with reason and audit history. Staff cannot snooze. Snoozed issues remain visible in a separate section and return automatically after the date. An additive Postgres table is included in the backup registry. Focused pure and disposable Postgres regressions are under tests/todo-w1*. No live payment, tax filing, customer messaging or other activation. The next planned card is W-18. Merged #394; W-18 followed in #395.

### W-18 money and explanation kit — merged #395

W-18 gives owner screens precise two-decimal dollar amounts, an exact dollar-entry parser, and an accessible glossary InfoTip. Sales-tax and use-tax setup now ask for dollars, never raw pennies; existing cent-based storage, audit and tax rules are unchanged. Repair, set pricing, fee and purchase-cost displays use shared helpers. Unit and UI tests and a repo preflight guard protect the wording and conversions. No provider activation, migration, or spending. Next: W-22 signing charges.

### W-22A signing-charge foundation — merged #396

The first W-22 slice records $45-per-new-delivery-location setup and five-machine/business down-payment settings; an owner-only settings screen with exact dollar entry, independently verified actor, audited updates and stale-edit protection; and a tested per-location integer-cent charge planner. Tax treatment remains UNDECIDED until CPA confirmation. No Stripe charge, payment credit, signing snapshot or live collection has been enabled. **W-22 is not complete.** Next W-22B/C must persist charge/credit lines, implement hosted/manual signing payments, webhook replay, cancellation, delivery evidence, all-in quote/contract/customer totals and browser acceptance before W-23. See docs/pr-cards/W-22.md for boundaries.

### Current queue (read this first)

- **Latest in chain:** W-22C1 (#402) merged after W-22C0 (#401) and W-22B1 (#400) merged after W-22B (#399) and W-22B0 (#398) after COM-L15 #393, W-1 #394 and W-18 #395. No open PRs before #398; recheck before implementation. The earlier COM-L15 pause checkpoint was passed by the subsequent merged work.
- **Current queue:** W-22 (B/C completion) → W-23 → W-24 → W-25 → W-26 → W-14 → W-2 → W-15 → W-3 → W-4 → W-5 → W-6 → W-7 → W-8 → W-9
  → W-10 → W-19 → W-17 → W-20 → V → F-part-2. W-11/W-12/W-13 when their outside gates clear (IN-61, IN-62/IN-44, IN-64).
  Authority: `designs/BATCH-W-AMENDMENT-B.md` section 8 and `pr-cards/work-index.json`.
- **Already done out of order (do not redo):** W-16A/B (sets are rental packages of separate machines; "Rent as"; old
  one-record sets split) and W-21A/B (out-of-service credits; a set machine the customer is done with → single price).
  Later cards build on them — see their entries in `designs/CHANGES-SINCE-DESIGN.md` (W-18 converts their screens to
  the ⓘ/dollars kit; W-14 records a set bought together as two machines; W-19/W-20 show their credits).
- **Testing:** real-database tests that write the business-settings row or create filing accounts must be listed in
  `SHARED_SETTINGS_TESTS` (`vitest.config.mts`) — `tests/shared-state-tests-listed.test.ts` enforces it (#367). CI pulls
  Postgres from `public.ecr.aws/docker/library/postgres:17` (Docker Hub's anonymous limit broke CI on 2026-10-09).
- **Owner decisions open:** IN-72 (new: prepay discount after a set becomes single machines — a safe default is built;
  confirm or change), IN-71 (record retention, CPA), IN-61, IN-62, IN-63, IN-64, IN-65, IN-44.

### Recent merges (newest first)

**2026-10-10 — COM-L15 communications launch evidence (recorded as if merged; still needs exact-head CI):** Added read-only, non-sending isolated PostgreSQL master-gate/delivery-evidence and assigned-job privacy regression, plus OWNER/STAFF mobile browser acceptance for setup/inbox/reports; corrected the prior Twilio runbook and published a plain-English owner launch guide and truthful acceptance ledger. IN-03/09/51/52/53, carrier A2P/voice checks, legal disclosures, media approval, K posting and F-part-2 go-live remain explicitly PENDING. No number purchase, live provider send, voicemail enablement, automatic cost alerts or new production credentials. Owner-requested pause is now before W-1.



**2026-10-10 — COM-L14B context evidence (recorded as if merged; exact-head CI required):** Job, maintenance and invoice pages show bounded, status-labelled evidence only for explicitly linked communications, never contact-number inference. Owners/admins can link a verified customer-thread message to a work record of the *same* customer from the private inbox; link + audit record are transactional and idempotent. STAFF only sees no-content delivery-status facts on jobs assigned to them; no private inbox, cross-customer data, finance, or company messages. Mobile and PostgreSQL isolation tests included. No provider send, dispatch change or migration. Next COM-L15.



**2026-10-10 — COM-L14A customer/lead communication timelines (as if merged, subject to full CI):** Existing OWNER/ADMIN customer notes/activity timeline now adds confirmed FK-linked SMS and call outcomes with one 25-row stable time/source/id cursor, separate source limits and communications filter. Lead contact history presents internal notes and verified linked communications together with cursor pagination, private inbox drill links, accepted-versus-delivered distinction and no phone-number-only identity linking or decrypted message content. No provider send/activation, schema migration or new billed action. COM-L14B follows.



**2026-10-10 — COM-L13B evidence-labelled Reports + To do/S (recorded as if merged, subject to CI):** Private Reports shows separate GMT provider total, previous-period observations, resource/attributed vs unallocated costs, verified statement evidence, reconciliation residual, source freshness and inactive budget preview. All five telecom metric definitions have explicit date/source/basis/drill. Existing S sweep produces PII-free typed HIGH issues for stale previously-working provider sync, comparable mismatched verified statements, unresolved inbox threads and missed calls lacking a thread; existing To do surfaces them with private resolving links and clears on documented recovery. No customer message or provider mutation, notification dispatch, paid Expense or budget activation. IN-53 remains pending. Next COM-L14A.



**2026-10-10 — COM-L13A owner telecom setup (as if merged; exact-head CI gate):** Private Settings > Phone, texts and provider costs workspace now distinguishes recorded provider/number readiness, off-by-default owner budget proposals, existing versioned SMS templates and private statement drafts from verified evidence. Owner PDF upload accepts a bounded private 4 MB PDF, captures hash, records an audit, and requires a separate owner confirmation plus verified stored bytes before marking the statement VERIFIED; only OWNER/ADMIN may download it. Owner-only policy update uses versioned strict communications policy, bootstraps defaults only from a recorded primary number, and cannot activate SMS/voice/provider calls, automated alerts, payments or K expense posting. Isolated DB evidence covers permissions, tampering, revisions and unchanged paid state. Local browser preflight build was blocked by an external node_modules symlink; security review fixes include 2FA enforcement, signed credits, read-only capabilities, and DB-first private-file reservation invalid for Turbopack; GitHub exact-head browser CI is mandatory.



**2026-10-09 — COM-L12 spend and budget evaluation (as if merged; exact-head CI gate):** Pure provider GMT-period totals, separate resource costs/estimates/verified statements, signed credit handling, non-overlapping daily fallback, explicit unknown/incomplete components, and owner ANY/ALL discrepancy tolerances are added. Account-scoped read service enforces OWNER/ADMIN, rejects ambiguous invoice evidence, returns stale cursor details and never treats provider telemetry as paid Expense. Optional policy budget rules are validated, suggested $50/$75/$100 starts OFF; preview evaluator cannot dispatch alerts or disable communications even if configured. No migration, SMS/voice activation, provider payment, side-effecting cron or live budget alert. COM-L13A is next; IN-53 remains outside activation.



**2026-10-09 — COM-L11 read-only telecom sync (recorded as if merged, pending PR gate):**
An account-pinned, GET-only Twilio adapter reads bounded GMT Usage pages, Message and Call charges, US messaging rates and owned-number capabilities using existing production-only account credentials. The matching durable cursor is claimed before a page, but the network request runs outside its DB transaction; validated snapshots, matched/unallocated costs and the next cursor commit together. A failed page preserves prior checkpoints, and source revisions keep old evidence. Account-level total usage is not added to resource costs or called an invoiced/paid expense. Missing prices stay unknown; readiness never approves A2P or turns on customer communications. No new schema, routes, paid lookups, SMS/voice, provider writes or financial posting. Next COM-L12: compare evidence, detect anomalies and show uncertainties under IN-53's separate activation gate.



**2026-10-09 — COM-L10 cost evidence schema (as-if merged; exact-head gate):** Added five account-scoped Postgres records for Twilio sync cursors, usage snapshots, signed component costs, provider rates and private verified statements. Provider raw prices/usage preserve Decimal(24,10) with one cents-rounding boundary, distinct estimate/provider/statement basis and no unknown-as-zero. Cross-account FKs, revision links, claim/window/statement invariants and acyclic backup restore checks are enforced. No provider API calls, telecom send, bill, payments, journal, public pricing or owner activation. COM-L11 is next for read-only retrieval and paging; IN-51/52/53 remain separate.



**2026-10-09 — COM-L9 merged (#375, conditional on exact-head CI):** The private Communications desk now lists missed calls/unknown outcomes, call legs and guarded voicemail playback. Two separately approved switches plus a version-matched owner policy gate the intentional-only recording; ordinary call recording/transcription remain OFF. Signed callbacks import bounded provider audio from pinned Twilio credentials to the existing private Blob store, prove availability only after storage, preserve replay and retry failures. Owner/admin can review, staff only assigned threads; no public media. Voice activation, IN-52 voicemail/privacy/retention approval, external provider fallback and deletion proof remain outside engineering. Disposable Postgres, unit, accessibility and full PR CI are merge gates. Next: COM-L10.


**2026-10-09 — COM-L8 merged (#370, pending exact-head GitHub CI before merge):** Twilio voice endpoints are signed against the approved HTTPS origin, account and owned number. Calls use owner-approved Denver business hours and an approved phone destination only after voice policy activation (still OFF); a private press-1 step and durable parent/child callback ledger prevent carrier voicemail or duplicate events from being recorded as staff answering. Call decline, conflicts and missing staff answer are kept as missed/unknown evidence. No ordinary call recording, voicemail, live sending, spending or provider settings change. Tested using disposable PostgreSQL and the COM-L8 regression suite. Next COM-L9: gated voicemail/private media and missed-call inbox.


**2026-10-09 — test isolation (#367):** tests that write records existing once for the whole database run one at a time;
the health sweep counts only issues it actually recorded; CI uses the ECR Public copy of the Postgres image. No test was
skipped or weakened.

**2026-10-09 — COM-L6B authorized communications inbox (#364):**
The private Owner Desk → Communications workflow now provides bounded
SMS thread lists and drillthrough, unread per staff user, assignment,
workflow status, and version-conflict protection. Every handler checks
an active team account; staff can access only assigned threads. Ambiguous
numbers never expose a guessed customer's account or lead linkage; message
text is decrypted only for authorized thread detail. Audit history records
assignments/status without message content. All customer texts remain off,
including the held-for-review day-of reminders. Card: docs/pr-cards/COM-L6B.md.
**Next: COM-L7** private call/voicemail schema after exact-head merge.

**2026-10-09 — W-21B merged (#366), Claude's lane:** when the customer is done with one machine of a set, the owner
records it on the repair screen: the rest go to single prices (keeping the agreement's term discount, IN-72), the
already-billed part of the month is credited, and Stripe's monthly item changes from the next period.

**2026-10-09 — COM-L6A template preview and reminder safety cutover:**
Approved SMS templates now validate variables, render immutable encrypted text
and count GSM-7/UCS-2 segments correctly at preparation and final dispatch.
Owner Settings → Notifications previews template samples, conservative Unicode
lengths and explicitly unknown costs. The old day-of reminder cron can no longer
send via the legacy path bypassing COM-L5B consent. It counts held-for-review
jobs without marking them texted. Automated sending still needs the COM-L6B
authorized recipient/job workflow and separate owner activation.
**Next: COM-L6B**, authorized inbox and user read cursors. No live sending.
Card: docs/pr-cards/COM-L6A.md.

**2026-10-09 — COM-L5B complete (merged by the COM-L5B PR after exact-head CI):**
Signed STOP/START/HELP events now produce private, replay-safe scoped consent evidence even
while the inbound inbox is disabled. STOP blocks ordinary SMS to an address (including
unresolved/shared numbers); START is only provider re-enable evidence, never marketing
or broad transactional consent. Portal opt-in writes a versioned exact transactional
disclosure and sender/phone scope; an old phone is revoked when changed. Marketing and
customer messaging remain off. Tested on isolated disposable PostgreSQL, no migration.
Card: `docs/pr-cards/COM-L5B.md`. **Next: COM-L6A**, validated templates, segment preview,
and migration of existing reminders. Public lead disclosure text/form choices remain
explicit follow-up work, not implied by COM-L5B.

**2026-10-09 — W-21A merged (#365), Claude's lane:** a machine taken for repair with no replacement (a swap with no
new machine delivered, or a pickup of some machines while others stay) now starts an out-of-service period; when a
machine is back the customer is credited exactly the days without it on the next bill (any line, set or single).
To do "Return or replace…" (urgent after 3 days, owner setting), a screen with the three ways forward, and a portal
note. (W-21B followed as #366.)

**2026-10-09 — W-16A (#360) and W-16B (#362) merged, built by Claude beside Sol's chain (Chris: "you take W-16A/B and
W-21"):** a washer and dryer set is a **rental package** of separate machines. Sets are managed in Settings → Products
and pricing → Sets and packages and shown on the website and quote form. Agreements and quotes can now rent a set ("Rent
as"), with the server checking one machine per part. Old one-record sets show on To do as "Split … into separate
machines", with a guided screen that keeps history, the rental and exact cost/tax totals. (W-21 followed as #365/#366.)

**2026-10-09 — W-0C MERGED (#359), exact-head CI required before merge:**
After latest `main` c712834 (which includes #356, #357 and the completed in-flight #358),
failed automatic charges on recorded invoices now become DELINQUENT without reopening PAID
or VOID invoices, and an idempotently claimed event records its failed attempt. To do shows
DELINQUENT (with or without due date), PARTIALLY_PAID and overdue OPEN; its button goes
straight to the invoice with the unpaid dollars. No late-fee change; no live payments,
customer SMS/email, provider spending, or tax filing activated. Card: `docs/pr-cards/W-0C.md`.
**Batch W Amendment B approved (IN-69), set/repair credits D-WB8 / W-21; IN-71**
settled for launch at seven-year owner-configurable record retention, with CPA review still
outstanding. W-0C resolves the original payment failure defect and does not implement W-21.

**2026-10-09 — COM-L4B PR #354 MERGED (80ac467):** exact-head required CI passed and performance baseline passed after one retry. Account-scoped default-off Twilio dispatch, last-minute consent/STOP checks, durable single-attempt claim, and fail-safe UNKNOWN recovery remain off in production. No sending, provider spending or phone activation authorized.

**2026-10-09 — COM-L4A merged (#353), following COM-L3 #352:** strict owner-controlled default-off SMS policy, evidence-based consent, canonical STOP suppression, private encrypted and idempotently prepared message intents. **Next: COM-L4B**, claimed delivery and last-minute sender/consent/readiness verification, then L5 inbound consent/reconciliation. No live sending, phone activation, billing or provider spending.

**2026-10-09 — Batch W Amendment A (tax filing on autopilot) added:** W-9 filing autopilot, W-10 use-tax "File now" + filled DR 0252, W-11 live GIS rates (waits on IN-61, may run early once done), W-12 XML return file (waits on IN-62, IN-44). Nothing ever submits or pays on Chris's behalf (D-WA2, IN-63). **D-WA6:** W-2 now also gives every seller-tax answer one dated next step (`nextPurchaseTaxStep`); W-13 receipt reading waits on IN-64; out-of-state seller tax waits on the CPA (IN-65).

**COM-L2 merged (#346, 2026-10-09):** the additive telecom account, number, contact-point/binding and send-attempt schema passed exact-head CI and disposable PostgreSQL backup/restore validation. COM-L3 extends its account and delivery lineage. SMS and provider spending remain off.

**2026-10-09 — test interference fixed (#367):** tests that write the one business-settings row or filing accounts now
run one at a time (guarded by `tests/shared-state-tests-listed.test.ts`), and the health sweep counts only issues it
actually recorded. The chance failures in tax and health-sweep tests are gone (two full local runs clean).

**Recovered unfinished work (2026-10-09, read before starting anything):** found uncommitted in the Vercel Sandbox
`appliance-desk-s1c-oct8` and committed there (not on GitHub; the sandbox clone originally lacked push credentials; this is resolved as of 2026-10-09):
- `/vercel/appliance-desk`, branch `recovery/t7d-leftovers-2026-10-09`, commit `691a02f` — edits to the tax overview
  (`workspace-overview.ts`, `sales-tax/page.tsx`, its test, T-7D card, contract log) left after #328 merged. Compare with
  `main`; keep only what main lacks, as part of W-3 (taxes in one place) — or discard if superseded.
  The main sandbox checkout is on that recovery branch: `git checkout main && git pull` before new work.
- **Test race fixed in #337:** `tests/system-issue-sweep-integration.test.ts` no longer compares global table counts; it
  records the sweep's own writes (only `systemIssue` allowed). If a similar global-count assertion fails by chance
  elsewhere, fix it the same way.

**Order:** see "Current queue" above. Keep owner/legal/CPA and live payment gates. [MASTER-ROADMAP](MASTER-ROADMAP.md) is
the single handoff; [PLAN](PLAN.md) owns acceptance; implementing sessions start at [SESSION-START](SESSION-START.md).

## Built

A/B/C/R/B2/D/E/E2, F-part-1, G, T (engineering) and S are merged; COM-L1A … COM-L6A, W-0A/W-0B/W-0C, W-16A/W-16B and W-21A/W-21B are merged. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Engineering complete through #328; owner/CPA/provider/go-live gates remain |
| S | **Complete** (#330–#334) |
| COM-L6B…L15 → W-1…W-20 (W-16A/B, W-21 done) → V → F-part-2 | Approved remaining launch engineering and final product proof |
| K → M → O → COM-N | Approved later engineering; K/M after launch unless owner reschedules |
| BP | Proposed business documents/design; runtime acceptance still required |
| O32/O29/direct QBO/P/COM-A | Explicitly deferred or owner-selected prerequisites |

## Gates and limitations

- Stripe test; live customer email/SMS off. Owner approvals still govern activation, provider purchases and production writes.
- CPA/attorney/GIS, COM setup/consent/retention, V visual approval and final launch inputs remain in OWNER-INPUTS/GO-LIVE-CHECKLIST.
- Official-page fetchability does not prove a tax answer. Preserve source failures and the manual path.
- Historical audits remain final-review inputs under F2-D; this cleanup is not a full security certification.
- See **Environment** below for local database testing.

History and prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use its old unchecked boxes as the current queue.

## Environment (update when it changes)

- **Current release/cost policy (2026-10-12):** automatic previews disabled; scheduled daily checked main→live only
  (`daily-live.yml`), no manual batch/weekly release; sandbox sessions remain bounded; heavy
  checks run in free GitHub Actions. The sandbox push key **does** carry over to new sessions (verified: session started
  15:49 UTC after the old one expired had both injection rules).

- **Vercel build costs (2026-10-09):** builds now skip when only docs/tests/CI files changed, on PRs too, and
  transfer branches never build. IN-67 done: the ruleset no longer requires a "Preview" deployment (only `ci`), so skipped previews never block merges.

- **Sandbox GitHub push:** Installed 2026-10-09 by the owner through network header injection, never stored in the repository or sandbox environment; expires 2027-10-09 (one year). Dry-run verified; regular git push now works using HTTP/1.1. Use the fallback runbook if needed.
  **Check (2026-10-09, Claude):** the key was attached to the running session only — the sandbox's saved settings had no
  injection rule, so it disappears when that session ends. Whoever holds the key applies the same `networkPolicy` with
  `update_sandbox` (saved settings) so every future session keeps it.
- **Sandbox browser:** Chromium and its system libraries installed in `appliance-desk-s1c-oct8` on 2026-10-09 (a real
  launch verified). If a later session reports "No matching installed Chromium": `npm run sandbox:browser` once.

- **Local database testing:** Vercel Sandbox, project `appliance-desk`. Persistent sandbox in use:
  **`appliance-desk-s1c-oct8`** (most recently active, 2026-10-09; main checkout `/vercel/appliance-desk`, per-card
  worktrees beside it, PostgreSQL 18). Older persistent `appliance-desk-batch-t1` may have an expired snapshot. Resume,
  don't recreate — steps in PLAYBOOK 4b. Stop the session when done.

Older entries (October 8 cleanup, K-CASH design note, publication-check note, S-2, COM-L1A and COM-L1B evidence) moved to
[archive/STATUS-LOG.md](archive/STATUS-LOG.md) on 2026-10-09.

## W-22C2 private tax evidence and anti-stall guidance (#403)

W-22C2 adds a pure, non-collecting setup-tax candidate calculation using
jurisdiction-confirmed ADMINISTRATIVE_SETUP treatment. It never freezes a
contract, sends a payment or issues a first-invoice credit. The anti-stall
runbook now documents bounded isolated Postgres tests, exact-head CI and
manual review fallback. **Next: W-22C3 immutable agreement totals and guarded
send/sign**, followed by W-22 payment/credit/cancellation/delivery. IN-79
remains open; W-23 is still blocked.

## W-22C3 — private order-wide tax review (#404)

OWNER/ADMIN can inspect a per-agreement setup-tax candidate based solely on
stored draft records and confirmed category-specific jurisdiction evidence.
No posted or signed total, provider payment, credit or customer communication
is created. Tax uncertainty remains visible and blocked from being described
as payable. W-22 and IN-79 remain open; next W-22C4 contract draft/freeze
foundation, then server send/sign, collection and delivery. W-23 blocked.

## W-22C4 — canonical private all-in order candidate (#405)

The owner desk now assembles a single private draft across every related
agreement and delivery property. It reconciles setup fees, first-month
prepayments, separately validated setup tax and jurisdiction evidence.
A stable draft fingerprint detects changes. Neither the calculated totals
nor the owner display constitute a customer contract, a charge, signed
payment evidence or approval to collect; all such paths remain disabled.
**Next: W-22C5 reviewed immutable per-agreement tax-inclusive freeze and
server send/sign gates**, followed by W-22 checkout/manual payment, credit,
refund/cancellation and delivery acceptance. IN-79 open; W-23 blocked.
