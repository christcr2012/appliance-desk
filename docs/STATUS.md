# STATUS — where the work stands

**Keep this file short.** Update it at the end of every session (see
`docs/PLAYBOOK.md` Step 11). Entries older than the last two batches move to
`docs/archive/STATUS-LOG.md`. The long history before 2026-10-02 is in
`docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md`.

Last updated: 2026-10-07 · **F-part-1 and Batch G are merged complete. Batch T is in progress: WU-T5/T-5a are merged through #297; #298/#299 planning/workflow and T-5b1 #300 are merged. T-5b2 official-source watch is now active on `ai/chatgpt/t5b2-official-source-watch`. COM design is approved 2026-10-08; #301 records the docs/cards/runbook and remains independent of tax implementation.** Batch S remains approved after T and before COM-L/V; F-part-2 remains after V. #287 remains docs-only/proposed BP; O32 remains explicitly deferred.

## Batch table

| Batch | Status | PR / branch | Evidence | Notes |
|---|---|---|---|---|
| A — Critical integrity & platform safety | **MERGED** | #136 (2026-10-02) | Full CI green; real-Postgres concurrency and adversarial auth tests | Audit registers stay open; nothing in A claims a B–F item. |
| B — Billing, provider reconciliation & financial ledger | **MERGED — completion work finished by B2** | Core Batch B PRs through #161; B2 #205–#208 | Real-Postgres/provider reconciliation coverage across the core stack and B2; exact-head CI at merge gates | Renewal lifecycle, customer month-to-month ending, annual reminders, manual-delivery evidence, provider ambiguity handling, company-delay pickup waiver and early-return workflows are built. Live Stripe/customer email/automatic-renewal activation remains OFF pending the separate owner/legal go-live gates; IN-25 remains a CPA decision. |
| C — Rental-to-service operations, custody, inventory & purchasing | **MERGED — shared billing-end leftover finished by B2** | #169–#175 plus B2 #208 for C-09 | Real-Postgres tests across scheduling, custody, parts, swaps, maintenance, missing-item handling and pickup billing end | C-09 is no longer blocked. The older manual-only never-delivered multi-charge refund limitation is being superseded by Batch T T-4c's evidence-based source-invoice refund path. |
| R — Remediation Batch R (17 review findings R01–R17) | **MERGED; follow-up proof closed** | #185–#197; follow-up #199 | Real-Postgres tests per finding; #199 proved first-delivery billing behavior, completed the browser checks and migration drill recorded in the acceptance ledger | No remaining R implementation item. Later B2 work superseded the renewal/pickup lifecycle gaps that were still open when R first closed. |
| Follow-ups after Batch R (Chris's answers, 2026-10-04) | **DONE** | #199 plus B2 #205–#208 | Delivery-date billing proof, migration drill, follow-up claiming, Today recovery item, and B2 lifecycle tests | Remaining IN-21/IN-31/IN-25 items are owner/legal/CPA release decisions, not missing implementation. |
| B2 — Renewal lifecycle, month-to-month rentals, pickup billing end (finishes B and C) | **MERGED** | #205, #206, #207, #208 (final merge 2026-10-05) | #208 records 1804/1804 full-suite pass against real Postgres; prior slices have their own real-Postgres and exact-head CI evidence | B2 closes R1–R7, D1/D2, C-09, IN-29 and IN-30 implementation. Automatic renewals and live customer email remain OFF until the owner/legal go-live conditions are satisfied. |
| D — Owner/customer control plane, website, evidence & privacy | **MERGED** | #214, merge `a6c9c9a` (2026-10-05) | Exact-head CI green; Vercel preview READY; zero unresolved review threads | Final D implementation contracts and the mandatory E/E2/F reconciliation live in `docs/designs/POST-BATCH-D-RECONCILIATION-2026-10-05.md`. |
| E — Communications, reporting, growth, branding & accessibility | **MERGED** | #215–#218, #221, #222 | Durable messaging/automation ledgers, reconciliation, growth/reporting, Evergreen tokens, generated accessibility coverage; exact-head CI at merge gates | Live customer email/SMS/marketing remain OFF unless separately approved. Accessibility checks are engineering evidence, not certification. |
| E2 — Visual redesign (owner desk, public site, customer portal; desktop, phone, dark) | **COMPLETE with #263** | E2 implementation stack through #263 | Shared UI/tokens, phone/desktop/dark route coverage, print cleanup, exact-head CI/preview gates | Public-site technical scope is complete, but Chris rejected the visual result as the final desired quality; a stronger public-site visual redesign remains explicitly deferred. |
| F — Integrated verification, recovery, owner handoff & launch ledger | **F-PART-1 COMPLETE** | #268, #269, #273 merged | Repeatable-read DB restore drill; privacy-safe media recovery; stable capacity baselines 11.94 ms/op (50 properties/200 appliances) and 4.42 ms/op (5,000 invoices); recovery/provider/account/privacy runbooks audited | F-part-2 (scenarios, screenshots, owner guide, launch/review ledger) remains intentionally after G → T → V. |
| G — Audit fixes and owner-account security | **COMPLETE — final PR #277** | #275 G-1; #276 G-2; #277 G-3 | Production audit clean; closure earnings evidence; Better Auth TOTP + 10 encrypted single-use backup codes; required-role enforcement; recovery path; CI browser proof; own-session list/revoke-other; Owner-only Staff sign-out with audit evidence | Owner/Admin two-step login is required by default; Staff is owner-configurable; Customer can never be required. No live provider activation was added. |
| T — Colorado sales and use tax | **IN PROGRESS — T-5b2 split active** | #279, #280, #281, #283, #284, #285, #288, #290, #291, #295, #296, #297, #298, #299, #300 merged; T-5b2a/T-5b2b implementation active | T-5b2 was split after implementation proved the production-grade SSRF boundary would push the original single PR over budget: T-5b2a owns pinned safe HTTPS transport; T-5b2b owns watch/Today/email/cron/CPA behavior. | Exact seeded URLs rechecked 2026-10-07/08: Greeley Sales Tax is directly fetchable and is the only activation candidate after gates; all five `tax.colorado.gov` page URLs return HTTP 403 to automated retrieval and therefore remain inactive. No replacement URL is guessed. T-5b3 remains the guarded rate auto-apply slice; CPA answers IN-33 … IN-38 still block live billing, not engineering. |
| K — Books, expenses, P&L, accounting exports | DESIGN APPROVED 2026-10-06 — not started | — | — | `docs/designs/BATCH-K.md`; after T. |
| V — "Evergreen Signature" visual redesign | DESIGN APPROVED 2026-10-06 — not started | — | — | `docs/designs/BATCH-V.md`; answers Chris's rejection of E2's public-site look; IN-42. |
| O — Owner controls | DESIGN APPROVED 2026-10-06 — not started | — | — | `docs/designs/BATCH-O.md`; after K. |
| S — System issues / AI check-up | DESIGN APPROVED 2026-10-07 — not started | — | — | `docs/designs/BATCH-S.md`; after T, before V; implementation cards required before S-1/S-2. |
| COM — Communications operating subsystem and telecom cost | **DESIGN APPROVED 2026-10-08 — runtime not started** | #301 (docs only) | Current-code drift and official sources; L1a/L1b/L2 cards | `BATCH-COM.md`; approved COM-L after T/S before V/F-part-2, COM-N after K/O; no live setup. |
| M — Shop sales and appliance endings | DESIGN APPROVED 2026-10-07 — not started | — | — | `docs/designs/BATCH-M.md`; after K. |
| BP — Configurable business offers/templates and partnerships | **PROPOSED — not accepted for runtime implementation** | #287 docs only | Business-plan/document package and proposed 16-slice design are merged | `docs/designs/BATCH-BP.md`; after K → M → O, then design acceptance + bounded PR cards. |

Earlier roadmap work that is already shipped and must not be rebuilt
(details in `docs/PLAN.md` → "Already shipped"): foundation/styles/
navigation (O00, O03–O05), Today workspace, customer record tabs, lead
workbench (O06–O08), task assignment and follow-up UI (O09/O10, #134),
property context (O11, #134), preview isolation proof (O02, #134), rental
builder draft/resume (O12 partial), money presentation (O18 partial), portal
home (O20 partial), settings section saves (O21 partial), revenue and fleet
reports (O19 partial, #133), security response headers (#132), session
deny-by-default (#131), CI parallelized and sharded (#136, #137).

## Infrastructure facts that affect work

- CI: parallel full run with 4 browser groups (`browser-a`…`browser-d` in `e2e/shards.json`); about 2.5 min warm
  (PR #266). CI uses Node 24, the same as Vercel production. Any skipped test fails CI (only the perf baseline may
  skip; it runs in `perf.yml`). Pull-request heads always build an exact-head Vercel Preview; docs-only non-PR pushes may skip the build (`scripts/vercel-ignore-build.sh`). Details:
  `docs/ARCHITECTURE.md` → "CI layout and speed" and "Vercel builds".
- Preview deployments use an isolated Neon branch and a Preview-only private
  file store; preview photo-upload and backup APIs are deliberately disabled.
  Evidence: `docs/plans/overhaul/PREVIEW-ISOLATION-PROOF.md`.
- Stripe is in **test mode**. Customer email/SMS sending is **off**. Public
  sign-up is **disabled** (accounts are provisioned server-side).
- Production `Photo` table was confirmed empty/test-only before private media
  landed (Batch A); no media migration was needed.
- The Neon plan upgrade is historical/completed. Previews already use the verified
  isolated `vercel-preview-2` branch; one fresh branch per preview deployment
  remains optional infrastructure hardening rather than a launch-code dependency.

## Open items carried across batches

- Historical review/audit registers remain evidence inputs; their old unchecked
  boxes are not a current implementation-status list. Batch F's review-disposition
  and launch-ledger work reconciles every remaining valid finding against the
  merged code and records anything genuinely still open.
- Launch gates are in `docs/PLAN.md` and `docs/GO-LIVE-CHECKLIST.md`.
- O29 CSV import: deferred until a real import dataset exists.
- O32 Google Workspace: **explicitly deferred**. Connector-side work is largely available, but Appliance Desk's own service account/delegation, Drive OAuth connection, and required live walkthrough are not yet proven. It remains the one conditional follow-up PR; F may proceed without pretending O32 is complete.

## Owner inputs currently blocking something

See `docs/OWNER-INPUTS.md` for the full register. Chris gave direction on
2026-10-03: IN-19 use best practice and keep it editable (starting values now
installed); IN-22 use best practice for a renewal signed in advance (built: see
"Answered" in OWNER-INPUTS); IN-23 per-case choice with a recommended option.
IN-22 and IN-23 are both built.
Current external/release inputs include IN-21/IN-31 wording and counsel review,
IN-25's CPA tax-treatment answer, the CPA confirmation of the configured sales-tax
rate, real public contact/launch details, and explicit live Stripe/email/SMS/launch
authorization. None of those blocks Batch F engineering; live provider actions stay OFF.

## Session log (last two batches only)

- **2026-10-08 — T-5b2 split for security/PR budget:** the original watch card is now an acceptance parent for bounded T-5b2a (SSRF-safe DNS-validated **and connection-pinned** HTTPS transport) and T-5b2b (watch lifecycle, Today/email, annual CPA task and existing-cron integration). The exact Greeley Sales Tax URL is fetchable; the five seeded Colorado DOR page URLs return automated HTTP 403 and stay inactive. No guessed replacements and no page content is interpreted as a tax-law/rate change.

- **2026-10-07 — T-5b2 started:** #300 T-5b1 merged after exact-head CI/performance/Vercel and review gates. T-5b2 drift check confirms the existing authenticated daily tax cron, durable `runAutomation` daily slots and monthly address-recheck behavior are unchanged. The watch remains bounded to external-source monitoring/SSRF safety; no automatic law/rule/rate interpretation is permitted.

- **2026-10-07 — Communications architecture approved (docs only, #301):** Batch COM, first three bounded cards and the Twilio readiness/activation runbook are approved for the planned order after T/S. The design extends existing E ledgers, S issues, METRICS/Today and future K Expense; it maps SMS replay, callback integrity, STOP matching and activation/isolation gaps without claiming runtime fixes. #300 T-5b1 is merged; tax implementation continues independently. No provider purchase/configuration/live SMS or calling is authorized by this docs work.

- **2026-10-07 — T-5/WU-T6 complete; T-5b card gate next:** #291, #295, #296 and #297 are merged. Before #297 merged, self-review found a zero-item Stripe-subscription edge case that could report tax rates as already current; the fix now records DRIFT and sends no provider update, with real-Postgres regression proof. PR #298 carries the bounded T-5b1/T-5b2/T-5b3 implementation cards. PR #299 refines stack workflow so authoritative planning/docs plus exact-head gates control drift instead of a numeric merge-per-session cap; it is stacked behind #298 and should merge before T-5b implementation.

- **2026-10-07 — Business documents / proposed Batch BP merged (#287, docs only):** `docs/business/` and `docs/designs/BATCH-BP.md` are now on main. The design keeps offer/template terms owner-configurable and versioned, freezes accepted terms, separates partner commissions from customer referrals, and blocks unsupported options rather than faking them. Independent post-merge review found the BP architecture sound but found current-state roadmap drift: #285 was still shown in review, F/G/T order was stale, and MASTER-ROADMAP omitted approved Batch S even though BATCH-BP correctly names T → S → V. The active T branch corrects those docs. BP remains PROPOSED runtime work and must not interrupt T.


- **2026-10-07 — Batch T WU-T5 complete (#283/#284/#285/#288/#290); T-5/WU-T6 active:** #290 merged the final historical-refund slice after real-Postgres proof for changing rates, unpaid newer invoices, prior refunds and multi-appliance historical shares. Missing legacy tax evidence fails closed. WU-T6 is being split by the PR budget: T-5a1 exemption engine/domain, T-5a2 owner exemption UI, T-5a3 address re-check/reminders, T-5a4 subscription rate changes. Card-gated T-5b remains separate.
- **2026-10-07 — Batch M designed (docs only):** `docs/designs/BATCH-M.md` — items for sale on the parts ledger, shop sales with correct tax, resale stock use tax, retired-appliance endings (sold/scrapped/disposed/other) and scrap trips, card payment for local invoices; 3 PRs; IN-46/IN-47 added. Revised same day after Chris's answers: no selling before launch (IN-47 answered, M stays after K); retiring gets a "what's next" plan (sell / strip for parts / scrap / throw away / other), parts kept go into stock, scrap and dump money recorded as lump amounts, not per appliance.
- **2026-10-07 — Readiness audit and stall-proofing (docs only):** AGENTS.md "Working without stalling"; `docs/pr-cards/` (template); "Implementation gate" on BATCH-T sections 11–15, BATCH-S and BATCH-M — **next design task: write the PR cards (splitting over-budget PRs, ~53 PRs total)** before any of T-5b…T-7, S or M starts. T-3/T-4/T-5 are not gated.
- **2026-10-07 — Batch T Amendment D (docs only):** `BATCH-T.md` section 15 — appliance intake records purchase tax, per-appliance rental exemption, DR 0252 use-tax filing with filled form or worksheet; new PR T-6d.
- **2026-10-07 — Batch S designed (docs only):** `docs/designs/BATCH-S.md` — system issues inbox, System health page, private ops endpoint and the daily Claude Routine check-up; 2 PRs after T, before V; IN-45 added.
- **2026-10-07 — Batch T Amendment A (design only):** Chris asked for the most automated filing possible. `BATCH-T.md` section 11 adds the SUTS entry packet, filing calendar, Today/email prompts and calendar file; T-6 split into T-6a/T-6b; IN-43 and IN-44 added. Same day: Codex review fixes (amended returns, service-fee timing, overdue date), SUTS setup entered by the owner in the app (11.13), Amendment B (section 12) for the Colorado retail delivery fee with new PR T-6c, and Amendment C (section 13) for automatic official rate updates and an official-page watch with new PR T-5b. Research corrected that Greeley files through SUTS and that the state vendor fee ended in 2026.
- **2026-10-06 — Batch T T-1 merged / T-2 in review:** #279 merged the additive tax schema, migration/seeds, backup coverage and pure category/engine/allocation primitives after exact-head CI, performance, Vercel and review-thread gates. #280 implements WU-T3 address locating with manual production fallback, shared-jurisdiction concurrency protection, stale-response/privacy protection and real-Postgres coverage. Colorado publicly documents key generation but keeps the API method contract on the authenticated SUTS key screen, so `docs/runbooks/colorado-gis-api.md` records the contract gate instead of guessing it.

- **2026-10-06 — Batch G complete (#275/#276/#277):** G-1 closes production dependency advisories, adds `closedAt` earnings evidence, Better Auth 1.7.6 schema, credential-safe backup policy and dark semantic contrast; G-2 adds authenticator TOTP, ten encrypted single-use backup codes, required-role enforcement, owner Security policy and recovery; G-3 adds self-session controls and Owner-only Staff sign-out with audit evidence. Final exact-head CI/Preview gate is #277.

- **2026-10-06 — Batch G-2 implementation:** Better Auth 1.7.6 TOTP is wired with ten encrypted single-use backup codes; Owner/Admin are required by default, Staff is optional, Customer is never eligible; ordinary server actions fail closed before enrollment while `/desk/security/setup` and auth/recovery paths remain explicit exemptions. CI global setup enrolls the fresh Owner before saving auth state. Exact-head type generation passed; PR CI owns the final browser/static gate after the disposable sandbox expired.

- **2026-10-06 — Batch G-1 pre-PR proof:** production dependency audit is clean with `sharp 0.35.5` / `source-map-js 1.2.2`; Better Auth 1.7.6 schema drift was reconciled; closure lifecycle tests passed 3/3 on disposable PostgreSQL 18; the populated 62-migration upgrade drill passed including the `closedAt` backfill and retry; static/type/unit/contrast/backup-policy checks are green.
- **2026-10-06 — F-part-1 complete (#268/#269/#273):** database restore, privacy-safe media recovery, capacity regression guards and required recovery/provider/account/privacy runbooks are merged. Product-wide F proof remains after G → T → V by approved design.

- **2026-10-06 — Batch F1-a merged (#268):** database backup now uses one repeatable-read snapshot with migration/app metadata and provider replay evidence; restore is fail-closed to an empty local DB or API-verified Neon `restore-*` branch, with schema-derived load order. CI run 37545036997 is green and includes the real restore drill; one earlier red run caught and fixed migration-seed replacement plus a test-mock typing issue. Codex review was unavailable due usage limits; no review threads are open.
- **2026-10-06 — CI and build health (after #266):** CI moved to Node 24 to match production; `allowScripts` added so npm 12 keeps running Prisma's engine download; skipped tests now fail CI; Vercel skips docs-only builds. Warnings reviewed: ESLint 9 end-of-support and a database-driver deprecation (via Prisma) are recorded in `docs/ROADMAP.md`, neither affects the live site today.
- **2026-10-06 — Batch E2:** E2 implementation completed through final cleanup/docs PR #263. The public-site slice is technically accepted but the visual result is explicitly deferred for a stronger redesign pass.
- **2026-10-06 — Documentation reconciliation:** current-state docs were audited against merged code. Stale claims that B/C/B2 work, configurable lead scoring, preview isolation, Neon protection/domain setup, and D/E evidence tables were still unbuilt were corrected. Batch F is next; O32 is explicitly deferred pending its prerequisites.
- **2026-10-08 — Chris approved Batch COM:** implementation is authorized in the planned order (after T/S), subject to bounded cards and normal PR gates. PR #301 records the design; callback card corrected to preserve existing EMAIL bounce/complaint transitions and evidence. This approval does not activate Twilio or authorize paid/legal submissions. LLC formation preparation separately requested; exact legal/entity details remain owner inputs, never inferred or stored in this public repository.
