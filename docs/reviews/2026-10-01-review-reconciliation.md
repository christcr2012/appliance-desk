## Owner sequencing update — 2026-10-01 (current)

Chris explicitly requested completing and merging the existing green PRs, then
continuing the original roadmap. Implementations from all audits, including
historical review repairs and B01–B36, are deferred until after the roadmap.
This supersedes earlier audit-before-feature and audit-expanded launch sequencing
in this document and linked plans. Preserve the audit registers and unresolved
findings for that later work; deferral is not resolution. Preserve existing
correctness protections, O02/O13/O14/O32 dependencies, CI/preview acceptance and
separate approvals for live activation, spending and destructive real-data changes.

# Historical review reconciliation — 2026-10-01

## Disposition update — 2026-10-17 (F2-D)

Every finding below has a recorded disposition in `docs/reviews/dispositions/reconciliation-2026-10-01.json` (fixed, already-fixed, superseded or open, with evidence). The 42 findings that were Pending were checked against current main; those that cannot be shown resolved stay **OPEN** and appear on `docs/LAUNCH-LEDGER.md`. Resolving a GitHub thread still needs the exact-head evidence shown here.

Baseline main: d7c10346214fcec548fffcc8d0d1b709e4dbecbf; #105 and #116 merged.
GitHub inventory: 108 PRs (open/closed/merged), 36 review submissions,
91 unresolved inline threads. Review submissions contain automated-review summaries;
all actionable inline findings are inventoried below. No open PRs at inventory time.

Pending means the finding has not yet been discharged with current-code and
behavioral evidence. Outdated lines or merged PR status do not establish resolution.
Review repair precedes new backlog features. Do not resolve a fixed thread until
its PR exact-head review, full CI and applicable preview checks pass.

The approved O09 contract explicitly preserves team-shared task visibility;
the old personal-only recommendation requires reconciliation with that contract,
not a new assignment schema before O02. O02 hosted fixture/storage gates and O32
sequencing remain incomplete. No live activation, spending or customer-data cleanup.

| PR/thread | Finding | Disposition |
|---|---|---|
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148766) | Source metadata titles from business settings | Already fixed — tests/business-metadata.test.ts covers settings-backed titles. |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148769) | Record fee changes in PricingRule | Already fixed — src/domains/settings/index.ts updateAppliancePrice writes a PricingRule row (old and new value, who) plus an audit row in one transaction; tests/rental-packages-integration.test.ts reads PricingRule rows. |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148772) | Preserve lead capture when no types are published | Verified/merged #121; CI 36861119917 (830 tests/134 browser checks) + Vercel; resolved |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148774) | Show price-save errors instead of success | Already fixed — e2e/appliance-price-save-feedback.spec.ts covers error versus saved feedback on the price form. |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148776) | Gate the property-manager premium on multiple units | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#2](https://github.com/christcr2012/appliance-desk/pull/2#discussion_r4112288147) | Keep delivery troubleshooting open until the send result is checked | Superseded — Delivery follow-up is now the recorded message ledger with UNCERTAIN and MISSED states and a runbook: docs/runbooks/MESSAGE-DELIVERY.md; tests/scenarios/07-message-send-failure-reconcile.test.ts. |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000933) | Add the required cross-customer isolation tests | Verified existing two-customer real-Postgres portal/maintenance/invoice isolation; #120 CI 36858585089; resolved |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000937) | Include the waiver in the monthly total | Verified/merged #125; CI 36870323155 (860 tests/138 browser checks), exact 16 blobs/Vercel; prepaid protected, waiver reconciled to later one-time contract; resolved |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000939) | Restrict maintenance appliances to active agreements | Verified/merged #129; CI 36882411929 (878/138), eight real DB eligibility/submission cases, exact four blobs/main tree/Vercel; resolved |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000942) | Stop reporting an agreed deposit as paid | Verified/merged #129; CI 36882411929 (878/138), three actual server-page render cases, exact four blobs/main tree/Vercel; resolved |
| [#28](https://github.com/christcr2012/appliance-desk/pull/28#discussion_r4114120283) | Add an automated regression test for the generated title | Already fixed — tests/business-metadata.test.ts. |
| [#29](https://github.com/christcr2012/appliance-desk/pull/29#discussion_r4116481229) | Correct the live lead-recipient state | Already fixed — docs/GO-LIVE-CHECKLIST.md section 2 lists the staff alert addresses as 'Not set' and unticked. |
| [#29](https://github.com/christcr2012/appliance-desk/pull/29#discussion_r4116481236) | Keep the Resend domain marked as pending | Already fixed — docs/GO-LIVE-CHECKLIST.md section 2 lists the Resend domain as 'Not live' and unticked. |
| [#30](https://github.com/christcr2012/appliance-desk/pull/30#discussion_r4116857380) | Add automated coverage for the HSTS response | Already fixed — e2e/security-response-headers.spec.ts covers the response headers including HSTS. |
| [#30](https://github.com/christcr2012/appliance-desk/pull/30#discussion_r4116857382) | Review the non-MySQL advisory separately | Already fixed — The dependency audit runs in CI; the advisory review was recorded in docs/DECISIONS.md. |
| [#30](https://github.com/christcr2012/appliance-desk/pull/30#discussion_r4116857387) | Record this security pass in the handoff | Superseded — HANDOFF.md was retired; docs/STATUS.md and docs/DECISIONS.md are the record. |
| [#31](https://github.com/christcr2012/appliance-desk/pull/31#discussion_r4117061551) | Update the handoff when unblocking Stripe work | Superseded — HANDOFF.md was retired (docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md); docs/STATUS.md is the single current record. |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202521) | Wait for ACH settlement before recording payment | Verified existing pending/settled/failed ACH real-Postgres regressions; #120 CI 36858585089; resolved |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202524) | Reconcile a failed invoice when Stripe later collects it | Verified existing failed-to-paid same-invoice real-Postgres recovery; #120 CI 36858585089; resolved |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202529) | Honor paid-in-full agreements before starting a subscription | Verified/merged #125; CI 36870323155 (860 tests/138 browser checks), exact 16 blobs/Vercel; prepaid protected, waiver reconciled to later one-time contract; resolved |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202535) | Keep the damage waiver as a recurring monthly charge | Verified/merged #125; CI 36870323155 (860 tests/138 browser checks), exact 16 blobs/Vercel; prepaid protected, waiver reconciled to later one-time contract; resolved |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202542) | Provide a way to resume an abandoned Checkout | Already fixed — A customer resumes payment of an open bill from the portal 'Pay now' link (src/domains/portal/pay-now.ts); tests/scenarios/16-failed-charge-to-recovery.test.ts proves it, one payment only. |
| [#37](https://github.com/christcr2012/appliance-desk/pull/37#discussion_r4118009218) | Update the stale webhook setup instruction | Already fixed — docs/ARCHITECTURE.md records the registered Stripe endpoint /api/webhooks/stripe as done 2026-09-27 (and the Resend and Twilio endpoints). |
| [#38](https://github.com/christcr2012/appliance-desk/pull/38#discussion_r4118039254) | Make local fixture instructions load `.env.local` | Superseded — Local fixtures now run through npm run test:db, which builds its own disposable database and never reads an existing DATABASE_URL (docs/PLAYBOOK.md step 4b). |
| [#39](https://github.com/christcr2012/appliance-desk/pull/39#discussion_r4118271829) | Add regression tests for the new status labels | Already fixed — tests/status-labels.test.ts covers the status label functions for estimates, invoices, jobs, maintenance and agreements. |
| [#39](https://github.com/christcr2012/appliance-desk/pull/39#discussion_r4118271833) | Let the desk content flex item shrink | OPEN — The desk shell was rebuilt since; no test checks that wide content cannot push the page sideways on a phone. Needs a narrow-width browser check. |
| [#52](https://github.com/christcr2012/appliance-desk/pull/52#discussion_r4119608648) | Limit the SWAP completion prompt to the replacement | Verified/merged #124; CI 36867157292 (854 tests/137 browser checks), all 15 blobs + Vercel; resolved |
| [#52](https://github.com/christcr2012/appliance-desk/pull/52#discussion_r4119608655) | Filter appliance audits to actual status changes | Already fixed — Every status writer uses the one audit action appliance.unit.status (src/domains/inventory/index.ts, guarded-status.ts, cleaning.ts, guided-actions.ts and src/domains/jobs/completion.ts); tests/scenarios/14-set-lifecycle.test.ts and 15 assert the status trail. |
| [#52](https://github.com/christcr2012/appliance-desk/pull/52#discussion_r4119608659) | Capture agreement-driven transitions in appliance history | Already fixed — Pickup completion, cancellation and cleaning transitions write appliance.unit.status rows; tests/scenarios/15-ending-to-ready.test.ts asserts the chain for every ending path. |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719016) | Anchor dispatch dates to America/Denver | Verified/merged #123; CI 36864737390 (842 tests/136 browser checks), all 14 blobs + Vercel; resolved |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719027) | Include adjacent-range jobs in conflict detection | Verified/merged #123; CI 36864737390 (842 tests/136 browser checks), all 14 blobs + Vercel; resolved |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719038) | Add real behavior coverage for dispatch persistence | Verified/merged #123; CI 36864737390 (842 tests/136 browser checks), all 14 blobs + Vercel; resolved |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719046) | Update the handoff with the completed dispatch work | Verified/merged #123; CI 36864737390 (842 tests/136 browser checks), all 14 blobs + Vercel; resolved |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814097) | Persist edits made after returning to earlier steps | Superseded — The builder now saves a draft checkpoint and says 'To use different terms, open a separate draft' (src/app/desk/agreements/new/rental-wizard.tsx); tests/rental-builder-recovery.test.tsx. |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814104) | Use the discounted monthly price in the review total | Already fixed — The server stores the discounted line price (calculatePrepayDiscountCentsPerMonth in src/domains/agreements/index.ts) and the review total sums stored line prices; tests/agreement-builder-actions.test.ts 'returns the stored discounted cents'. |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814111) | Add accessible labels to every address input | Verified/merged #121; CI 36861119917 phone keyboard/axe/address persistence + Vercel; resolved |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814118) | Surface failed activation emails before advancing | Verified/merged #119; CI 36858433312 + Vercel; automated review waived; resolved |
| [#55](https://github.com/christcr2012/appliance-desk/pull/55#discussion_r4119945202) | Neutralize spreadsheet formulas in exported CSV cells | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#55](https://github.com/christcr2012/appliance-desk/pull/55#discussion_r4119945208) | Add a unique tie-breaker to paginated job ordering | Verified/merged #122; CI 36862952621 real Postgres 60-job pagination + Vercel; resolved |
| [#55](https://github.com/christcr2012/appliance-desk/pull/55#discussion_r4119945212) | Return every skipped appliance and its reason | Verified/merged #122; CI 36862952621 real action/UI + phone bulk/axe/persistence + Vercel; resolved |
| [#56](https://github.com/christcr2012/appliance-desk/pull/56#discussion_r4120027259) | Compare recurring receipts instead of all invoice payments | OPEN — src/domains/reports/index.ts still adds all paid invoices less refunds as 'actual' earnings, which is not limited to recurring rent receipts. Needs a decision on what the report should compare. |
| [#56](https://github.com/christcr2012/appliance-desk/pull/56#discussion_r4120027266) | Honor calendar-month anniversary billing in the estimate | OPEN — Not re-verified against the current estimate calculation for calendar-month anniversary billing; needs a focused test. |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169719) | Persist edits when revisiting wizard steps | Superseded — Same as the earlier builder finding: the saved-draft checkpoint replaced going back to edit; tests/rental-builder-recovery.test.tsx. |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169721) | Display the discounted monthly price in the review | Already fixed — Same fix as the earlier discount finding: tests/agreement-builder-actions.test.ts. |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169727) | Compare rent against rent in the earnings report | OPEN — Same as the earlier earnings finding: actual earnings include more than rent while estimated earnings are rent only (src/domains/reports/earnings.ts). |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169735) | Use America/Denver for dispatch calendar calculations | Verified/merged #123; CI 36864737390 (842 tests/136 browser checks), all 14 blobs + Vercel; resolved |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169741) | Neutralize formulas in CSV cells | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169747) | Document the new database records in DATABASE.md | Superseded — The docs gate scripts/check-docs-updated.mjs now fails any PR that changes prisma/schema.prisma without docs/DATABASE.md. |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386805) | Clean up Blob objects when references are discarded | OPEN — Ordinary removal or replacement of a stored photo does not delete the stored file; only privacy deletion removes media (src/domains/backup/media-deletion.ts, tests/scenarios/08). Needs a decision and a clean-up job. |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386818) | Normalize HEIC uploads before storing their URL | OPEN — The upload route accepts HEIC and HEIF (src/app/api/uploads/photo/route.ts) but does not convert them, so some browsers cannot show them. |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386822) | Show focus when the hidden file input is focused | OPEN — Not re-verified: no test checks the visible keyboard focus on the hidden file input. |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386834) | Announce upload failures in appliance settings | OPEN — Not re-verified: no test checks that an upload failure is announced to a screen reader in appliance settings. |
| [#59](https://github.com/christcr2012/appliance-desk/pull/59#discussion_r4123799792) | Delete Blob objects when removing or replacing photos | OPEN — Same as the earlier stored-file clean-up finding: replacing or removing a photo leaves the old stored file. |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170402) | Record the completed features in HANDOFF | Superseded — HANDOFF.md was retired; docs/STATUS.md is the current record. |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170420) | Delete blobs when customers remove uploaded photos | OPEN — Same as the earlier stored-file clean-up finding for customer-removed photos. |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170433) | Accept only trusted uploaded photo URLs | Already fixed — privatePhotoPathFromUrl in src/lib/photo-storage.ts accepts only https URLs on the store's own private host with no credentials or port; used by the photo routes and privacy deletion. |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170447) | Remove the contradictory maintenance-photo roadmap entry | Fixed — docs/ROADMAP.md: the contradictory 'not wired yet' maintenance-photo entry is struck through and points to the done entry (this PR). |
| [#61](https://github.com/christcr2012/appliance-desk/pull/61#discussion_r4124590917) | Mark the restore attribution as unconfirmed | Superseded — docs/runbooks/RESTORE.md was rewritten for the real restore path with Neon branch verification; the restore is proved by tests/scenarios/09-restore-and-media-recovery.test.ts. |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549128) | Restrict financial operational pages from STAFF | Verified existing #105 role guards/projections; current #123 CI real staff payload/route checks; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549136) | Honor failed email results before recording a reminder | Verified/merged #119; CI 36858433312 + Vercel; automated review waived; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549141) | Scope staff appliance updates to the originating job | Verified/merged #124; CI 36867157292 (854 tests/137 browser checks), all 15 blobs + Vercel; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549150) | Propagate staff activation delivery failures | Verified/merged #119; CI 36858433312 + Vercel; automated review waived; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549157) | Keep completed swap jobs visible for status follow-up | Verified/merged #124; CI 36867157292 (854 tests/137 browser checks), all 15 blobs + Vercel; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549168) | Filter the driver view to the signed-in staff member | Verified/merged #124; CI 36867157292 (854 tests/137 browser checks), all 15 blobs + Vercel; resolved |
| [#76](https://github.com/christcr2012/appliance-desk/pull/76#discussion_r4135862592) | Apply the brand kit's heading weight | Superseded — Replaced by the Evergreen Signature tokens: src/app/globals.css sets the heading weight (--text-h2--font-weight: 800) and V-1 to V-4 are merged. |
| [#76](https://github.com/christcr2012/appliance-desk/pull/76#discussion_r4135862605) | Keep the design-system brand guidance in sync | Superseded — docs/DESIGN-SYSTEM.md was rewritten for the Evergreen Signature system (V-1 to V-4). |
| [#78](https://github.com/christcr2012/appliance-desk/pull/78#discussion_r4136765429) | Ask before installing the Neon CLI globally | Superseded — No instruction to install the Neon command line globally remains in docs, scripts or package.json. |
| [#79](https://github.com/christcr2012/appliance-desk/pull/79#discussion_r4136879568) | Hide desk chrome when printing work orders | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#79](https://github.com/christcr2012/appliance-desk/pull/79#discussion_r4136879577) | Apply default job checklists to work orders | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#80](https://github.com/christcr2012/appliance-desk/pull/80#discussion_r4137359495) | Add the promised way to supply a missing email | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#80](https://github.com/christcr2012/appliance-desk/pull/80#discussion_r4137359503) | Hide the add-lead control from staff or allow the action | Already fixed — createLeadAction is OWNER and ADMIN only (src/app/desk/leads/actions.ts) and the new-lead form lives on that restricted page; role boundary stays at the action. |
| [#80](https://github.com/christcr2012/appliance-desk/pull/80#discussion_r4137359513) | Cover the new persistence and approval flow with tests | Already fixed — tests/lead-conversion-integration.test.ts and tests/scenarios/01-lead-to-recurring-billing.test.ts create and convert leads against a real database. |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431819) | Add behavior tests before marking the CRM buildout complete | Already fixed — e2e/crm-workspace.spec.ts and the integrated scenarios cover the CRM flows with behavior tests. |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431829) | Restrict personal tasks to their creator | Superseded by approved O09 team-shared visibility contract; current scope/role tests verified in #117 CI; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431837) | Keep tasks due today out of the overdue group | Verified existing Denver date-key fix; business-date/task workspace tests in #117 CI 36854516416; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431842) | Preserve the selected Colorado due date | Verified existing UTC calendar-date rendering; selected-day regression in #117 CI 36854516416; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431849) | Calculate Today using Mountain Time | Verified existing Denver midnight/DST boundaries; date/query/browser coverage in #117 CI 36854516416; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431858) | Clear the lost reason when reopening a lead | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909733) | Make purchase-order receiving atomic | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909741) | Synchronize the stock editor after stock changes | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909747) | Associate every purchase-order line label with its field | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909752) | Subtract used parts atomically | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909756) | Record the completed feature in the handoff | Superseded — HANDOFF.md was retired; docs/STATUS.md is the current record. |
| [#86](https://github.com/christcr2012/appliance-desk/pull/86#discussion_r4143931482) | Block preview writes from changing live email settings | Already fixed — src/lib/email.ts never sends in previews or without the owner's switch (NOT_ATTEMPTED), and previews use their own database; docs/GO-LIVE-CHECKLIST.md section 2. |
| [#98](https://github.com/christcr2012/appliance-desk/pull/98#discussion_r4147176159) | Expect the later email-verification backfill | Already fixed — prisma/migrations/20260928160000_require_email_verification adds the email-verification requirement and backfill. |
| [#102](https://github.com/christcr2012/appliance-desk/pull/102#discussion_r4149812016) | Return to newest notes after adding from a filtered page | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#102](https://github.com/christcr2012/appliance-desk/pull/102#discussion_r4149812022) | Exclude overdue scheduled jobs from the next-visit slot | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#102](https://github.com/christcr2012/appliance-desk/pull/102#discussion_r4149812032) | Claim the lead before sending account side effects | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#104](https://github.com/christcr2012/appliance-desk/pull/104#discussion_r4149971361) | Remove omitted concept files from the checksum inventory | Already fixed — docs/brand/00_Start_Here/SHA256SUMS.txt checked with sha256sum -c: every listed file is present and matches (this PR). |
| [#104](https://github.com/christcr2012/appliance-desk/pull/104#discussion_r4149971370) | Replace the empty light-mark PNG | Already fixed — docs/brand/01_Logos/mark/Robinson-mark-light.png exists and is not empty (no zero-size PNG under docs/brand). |
| [#104](https://github.com/christcr2012/appliance-desk/pull/104#discussion_r4149971375) | Mark the official logo copies as still pending | Already fixed — docs/brand/README.md states that public/brand/logo-light.svg and logo-dark.svg are not yet synchronized and that update remains pending. |

## Current verification checkpoint

#117–#123 merged after exact-head inspection, full CI and ready Vercel. Expected-head
merges used; stacked PRs retargeted to main and merge trees matched tested heads.
Automated review quota unavailable; Chris waived that step October 1. Forty-four
threads resolved: forty-one historical and three new #117 findings. Fifty
historical findings remain open; pending does not mean fixed.

- #117 head 8418428571: CI 36854516416; merged fdc7de4.
- #118 head bd89a9ac10: CI 36854626321; merged 9a917f3.
- #119 head 2bcbcf1498: CI 36858433312; merged 18f272e.
- #120 head 8d8002dfe3: CI 36858585089; merged 4151c99.
- #121 head 73416ff92a: CI 36861119917 (830 tests/134 browser checks); merged
  b5a4319. Empty-catalog lead/consent persistence and phone address accessibility
  and reload verified. Both historical findings resolved after merge.
- #122 head 2e6483d340: CI 36862952621 (835 tests/135 browser checks); merged
  9bcdda4. Stable real-database job paging and per-unit bulk results verified;
  both historical findings resolved after merge.

Also reconciled existing ACH settlement/retry and two-customer isolation fixes
against current code and actual Postgres tests in #120 full CI; three threads resolved.

#123 head 0308d9e00111ab093d0697ba9e80e69a088bf211 passed full CI
36864737390: 842 tests/136 browser checks. All 14 published blobs matched inspected
local commit; prospective main merge tree matched tested head. Vercel ready.
Merged 2f75a47b03248215e1722921f042a4b9f9566594; five calendar/coverage/handoff
findings resolved. Existing #105 financial isolation verified against current
role guards, narrow operational projections and real staff payload/route tests;
#62 financial isolation thread resolved. Forty-four resolutions total:
forty-one historical plus three #117 findings; fifty historical remain.

Before this follow-on, preceding/latest #123 reviews/threads/comments checked:
no findings; quota notice 5931872476. Owner explicitly waived unavailable automated
review. Staff job appliance updates require and verify job membership before writes;
owner/admin broader authority retained. Swap suggestions use frozen guided-swap
audit intent, restricted to linked units, and never guess legacy replacements.
Failed writes show retryable errors. Driver completion opens swap/maintenance job
detail; route explicitly shared/unassigned. No assignment schema or Mine claim.
Local 807 tests pass, fifteen guarded CI-only cases skipped and four existing DB
suites excluded; types/lint pass (two existing warnings). Real disposable Postgres
membership/provenance/audit/financial projection regression and phone staff swap
completion/update/reload/axe checks await full CI and preview. Four findings remain
open until verification. No O13/O14 completion, scheduling write unification or
stored timestamp rewrite. Paid-in-full billing, recurring waiver and earnings
comparison remain priorities before new backlog features. O02 storage/isolation,
O32 sequencing and live-action approvals unchanged.

Prepaid follow-on checked preceding/latest #124 submissions/threads/comments before
starting: no findings; automated quota notice 5932207577, owner waiver retained.
#124 staff workflow merged after full CI 36867157292: 854 tests/137 browser
checks, ready Vercel and all 15 inspected blobs; four findings resolved. This follow-on avoids
recurring rent for recorded full-term advance payments before any Stripe calls,
with either free-month setting and without fabricating receipts/billing start dates.
Damage waiver screens now match the later approved one-time signing contract,
superseding the old recurring-waiver recommendation. Local 812 tests pass;
sixteen guarded CI-only cases skipped, four existing DB suites excluded. Types/lint
pass (two existing warnings). Real disposable delivery and phone actual signing/
owner labels/axe checks await CI. Three prepaid/waiver findings remain open.
Existing subscriptions are not cancelled or rewritten. Abandoned Checkout recovery,
rent-only/refund-adjusted earnings and calendar billing estimates remain unresolved.

Security/billing audit #126 reviewed at c416e4cc648095265236a0c04ea88d49da7d88ed:
original HANDOFF replacement corrected to prepend the reminder and retain current
main verbatim. Exact two-document diff, zero production changes/deletions; submitted
review 5379930095. Full CI pending. This prepaid follow-on incorporates that audit
before merge and reruns exact-head CI after integration. AGENTS requires reading
the full audit per PR. Existing duplicate-event, delayed ACH success/failure and
failed-to-paid webhook regressions remain in full CI; no webhook/payment settlement
logic changes here. New prepaid tests verify no recurring provider calls or
fabricated invoice/start date. The audit's concurrency/partial-failure P0 remains
open and takes priority over earnings work. Preview host gates and best-effort
limiter interpretation remain intact; no provider activation or infrastructure edit.

Current update: #126 reviewed docs audit merged 38809e1f787e8eff74e61fef31ab2edfe71da22a
after exact-head CI 36869113324 (854 tests/137 browser checks) and ready Vercel.
#125 head e0074b7d29df69b7988edb87014b89da0f55511f merged
e1ff6688ad322146accedc74b3a63351a9ea127c after CI 36870323155 (860/138),
all 16 matching blobs, matching prospective main tree, audit review and Vercel.
Three prepaid/waiver findings resolved; 44 total resolutions/50 historical remaining.
New business audit B01–B33 mapped to existing evidence, gaps, policy/data inputs and
launch gates. This changes planning, not financial/lifecycle policy or production code.
Checked preceding/latest #125/#126 reviews/threads/comments: only the submitted
documentation review, no blocking findings. Automated quota unavailable and waived.
Security audit webhook concurrency/partial-failure P0 remains first code priority.

Owner follow-up adds B34–B36: customer renewal, early termination fee workflow and
optional auto-renewal. These are scope/acceptance additions, not shipped features
or approved fee amounts/live collection. Existing signed/payment history preserved.

Portal review follow-on: #14's equipment and deposit assertions are already corrected
in current production code. Verify them with owned disposable-Postgres fixtures for
DRAFT/AWAITING_SIGNATURE/ENDED/CANCELLED, ACTIVE-but-RESERVED/inspection and eligible
RENTED/pickup cases; actual server rejection leaves no request. Actual rentals-page
render checks deposit-required copy across draft/signature/active terms. No new
production code or paid-state inference. Both threads stay open until full gates.
Preceding/latest #128 review submissions/threads/comments checked: no code findings;
quota notice 5934224054, owner waiver applies. #127 renewal audit retains 36 outcomes.

Settings follow-on: #1 price-save defect reproduced in current callback; the action
result was discarded and Saved displayed unconditionally. Fix checks explicit
success, surfaces validation/unconfirmed failure and retains the amount; edits freeze
while pending so old-save acknowledgement cannot describe a new unsaved number.
Five client cases and a settings-backed root metadata test pass locally; real phone
invalid/valid price write/history/reload/axe and home/child title composition await
CI. #1/#28 metadata production fix already exists; new tests supply missing behavior
acceptance. These three findings remain open. #1 fee PricingRule history still open:
settings only writes AuditLog; rate units must not be stuffed into cents fields.
#127 merged 816f3e3ace5af45d46908cf3400992e7d02d5ef8, CI 36880648787 (860/138).
#128 merged 9b6a362a43171924e8a40095fd85996f6a429eac, CI 36881617240 (867/138),
including seven real DB race/rollback tests; four source blobs and prospective main
merge tree verified. Full security audit/hosted provider capacity remain incomplete.
Preceding/latest #129 reviews/threads/comments checked: no blocking findings;
quota notice 5934332376, owner waiver applies. #129 still awaits final CI gates.

Current update: #129 merged da3cf4243686805195640f9dd3293e38a8621e61 at exact head
5ef63a05a68591c1f107ded52b572f634e4ad3bb, CI 36882411929 (878/138), ready Vercel;
four blobs and matching prospective main tree verified. Two #14 threads replied
with accepted evidence then resolved. Totals: 46 resolutions (43 historical +
three #117), 48 historical still open. #130 price-save/metadata remains under full
CI 36884412728; its three related threads remain open until gates pass.

Security audit P1 follow-on validates identity, known role and explicit archive
state before exposing sessions. Direct readers receive active accounts only;
requireSession preserves the deactivation redirect. Missing/unknown roles no longer
become CUSTOMER. Twelve malformed/archive cases and login role denial added; real
provider sign-in→API/page deactivation denial→restoration tests remain CI acceptance.
A broad local run exposed an existing pickup retry test race (alert before pending
settles); it now waits for the retry button to be enabled without weakening behavior.
No live setup/message/schema changes. Preceding/latest #130 reviews/threads/comments
checked: no findings, quota notice 5934632895; owner waiver applies.

Historical #30 follow-on: response-level production HSTS tests cover page/static/
protected redirect/rejected API paths without changing configuration. Deepmerge-ts
is independently reachable through Prisma configuration; PostgreSQL-only rationale
was inadequate. Later patched overrides already replaced vulnerable resolutions;
current lock deepmerge-ts 8.0.2/mysql2 3.24.4 and fresh successful npm audit reports
zero known vulnerabilities. HANDOFF and DECISIONS record scope/limits. Three threads
remain open until full CI/preview/exact-head verification. Latest/predecessor #131
reviews/threads/comments checked, quota notice 5935092513 and no code findings.


## 2026-10-01 — Open PR CI fixture repair

Latest runs for #130/#131/#132 failed only browser acceptance: #130 had
139 passing browser checks and one failed title test; #131 had 139 passing
and title/auth-loader failures; #132 had 141 passing and those same failures.
All earlier migration/schema/unit/type/lint/build gates passed. These failed
runs are not acceptance or merge evidence.

Title setup now supplies a valid owned email as well as the business name:
the seeded [Email Address] blocks native form submission. Name restoration
still exercises the actual save/revalidation; placeholder email restoration
is conditional on the owned value in disposable CI Postgres. Deactivation
setup (where present) calls the running app's signup endpoint, avoiding the
Playwright worker's Better Auth ESM loader failure; UI login and active,
deactivated and restored page/API assertions remain unchanged. No production
logic, schema, test skips, retry allowances or validation weakening.

Open PR threads/review submissions were rechecked: no new actionable findings;
automated review is unavailable under the owner's recorded quota waiver.
Exact updated source inspection and full replacement CI/preview remain required.
Historical findings remain open. B01–B36 and unfinished O02/O13/O14/O32 are
preserved. No live activation, provider writes, messages, spending or real-data
cleanup. Local full execution unavailable in this fresh workspace; CI is the
real database/build/browser verification gate.
