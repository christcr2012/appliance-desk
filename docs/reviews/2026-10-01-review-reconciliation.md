# Historical review reconciliation — 2026-10-01

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
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148766) | Source metadata titles from business settings | Pending |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148769) | Record fee changes in PricingRule | Pending |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148772) | Preserve lead capture when no types are published | Verified/merged #121; CI 36861119917 (830 tests/134 browser checks) + Vercel; resolved |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148774) | Show price-save errors instead of success | Pending |
| [#1](https://github.com/christcr2012/appliance-desk/pull/1#discussion_r4112148776) | Gate the property-manager premium on multiple units | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#2](https://github.com/christcr2012/appliance-desk/pull/2#discussion_r4112288147) | Keep delivery troubleshooting open until the send result is checked | Pending |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000933) | Add the required cross-customer isolation tests | Verified existing two-customer real-Postgres portal/maintenance/invoice isolation; #120 CI 36858585089; resolved |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000937) | Include the waiver in the monthly total | Pending |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000939) | Restrict maintenance appliances to active agreements | Pending |
| [#14](https://github.com/christcr2012/appliance-desk/pull/14#discussion_r4113000942) | Stop reporting an agreed deposit as paid | Pending |
| [#28](https://github.com/christcr2012/appliance-desk/pull/28#discussion_r4114120283) | Add an automated regression test for the generated title | Pending |
| [#29](https://github.com/christcr2012/appliance-desk/pull/29#discussion_r4116481229) | Correct the live lead-recipient state | Pending |
| [#29](https://github.com/christcr2012/appliance-desk/pull/29#discussion_r4116481236) | Keep the Resend domain marked as pending | Pending |
| [#30](https://github.com/christcr2012/appliance-desk/pull/30#discussion_r4116857380) | Add automated coverage for the HSTS response | Pending |
| [#30](https://github.com/christcr2012/appliance-desk/pull/30#discussion_r4116857382) | Review the non-MySQL advisory separately | Pending |
| [#30](https://github.com/christcr2012/appliance-desk/pull/30#discussion_r4116857387) | Record this security pass in the handoff | Pending |
| [#31](https://github.com/christcr2012/appliance-desk/pull/31#discussion_r4117061551) | Update the handoff when unblocking Stripe work | Pending |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202521) | Wait for ACH settlement before recording payment | Verified existing pending/settled/failed ACH real-Postgres regressions; #120 CI 36858585089; resolved |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202524) | Reconcile a failed invoice when Stripe later collects it | Verified existing failed-to-paid same-invoice real-Postgres recovery; #120 CI 36858585089; resolved |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202529) | Honor paid-in-full agreements before starting a subscription | Pending |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202535) | Keep the damage waiver as a recurring monthly charge | Pending |
| [#32](https://github.com/christcr2012/appliance-desk/pull/32#discussion_r4117202542) | Provide a way to resume an abandoned Checkout | Pending |
| [#37](https://github.com/christcr2012/appliance-desk/pull/37#discussion_r4118009218) | Update the stale webhook setup instruction | Pending |
| [#38](https://github.com/christcr2012/appliance-desk/pull/38#discussion_r4118039254) | Make local fixture instructions load `.env.local` | Pending |
| [#39](https://github.com/christcr2012/appliance-desk/pull/39#discussion_r4118271829) | Add regression tests for the new status labels | Pending |
| [#39](https://github.com/christcr2012/appliance-desk/pull/39#discussion_r4118271833) | Let the desk content flex item shrink | Pending |
| [#52](https://github.com/christcr2012/appliance-desk/pull/52#discussion_r4119608648) | Limit the SWAP completion prompt to the replacement | Pending |
| [#52](https://github.com/christcr2012/appliance-desk/pull/52#discussion_r4119608655) | Filter appliance audits to actual status changes | Pending |
| [#52](https://github.com/christcr2012/appliance-desk/pull/52#discussion_r4119608659) | Capture agreement-driven transitions in appliance history | Pending |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719016) | Anchor dispatch dates to America/Denver | Implemented in Colorado dispatch repair; full CI/exact-head inspection/preview pending |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719027) | Include adjacent-range jobs in conflict detection | Implemented in Colorado dispatch repair; full CI/exact-head inspection/preview pending |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719038) | Add real behavior coverage for dispatch persistence | Implemented in Colorado dispatch repair; full CI/exact-head inspection/preview pending |
| [#53](https://github.com/christcr2012/appliance-desk/pull/53#discussion_r4119719046) | Update the handoff with the completed dispatch work | Implemented in Colorado dispatch repair; full CI/exact-head inspection/preview pending |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814097) | Persist edits made after returning to earlier steps | Pending |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814104) | Use the discounted monthly price in the review total | Pending |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814111) | Add accessible labels to every address input | Verified/merged #121; CI 36861119917 phone keyboard/axe/address persistence + Vercel; resolved |
| [#54](https://github.com/christcr2012/appliance-desk/pull/54#discussion_r4119814118) | Surface failed activation emails before advancing | Verified/merged #119; CI 36858433312 + Vercel; automated review waived; resolved |
| [#55](https://github.com/christcr2012/appliance-desk/pull/55#discussion_r4119945202) | Neutralize spreadsheet formulas in exported CSV cells | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#55](https://github.com/christcr2012/appliance-desk/pull/55#discussion_r4119945208) | Add a unique tie-breaker to paginated job ordering | Verified/merged #122; CI 36862952621 real Postgres 60-job pagination + Vercel; resolved |
| [#55](https://github.com/christcr2012/appliance-desk/pull/55#discussion_r4119945212) | Return every skipped appliance and its reason | Verified/merged #122; CI 36862952621 real action/UI + phone bulk/axe/persistence + Vercel; resolved |
| [#56](https://github.com/christcr2012/appliance-desk/pull/56#discussion_r4120027259) | Compare recurring receipts instead of all invoice payments | Pending |
| [#56](https://github.com/christcr2012/appliance-desk/pull/56#discussion_r4120027266) | Honor calendar-month anniversary billing in the estimate | Pending |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169719) | Persist edits when revisiting wizard steps | Pending |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169721) | Display the discounted monthly price in the review | Pending |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169727) | Compare rent against rent in the earnings report | Pending |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169735) | Use America/Denver for dispatch calendar calculations | Implemented in Colorado dispatch repair; full CI/exact-head inspection/preview pending |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169741) | Neutralize formulas in CSV cells | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#57](https://github.com/christcr2012/appliance-desk/pull/57#discussion_r4123169747) | Document the new database records in DATABASE.md | Pending |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386805) | Clean up Blob objects when references are discarded | Pending |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386818) | Normalize HEIC uploads before storing their URL | Pending |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386822) | Show focus when the hidden file input is focused | Pending |
| [#58](https://github.com/christcr2012/appliance-desk/pull/58#discussion_r4123386834) | Announce upload failures in appliance settings | Pending |
| [#59](https://github.com/christcr2012/appliance-desk/pull/59#discussion_r4123799792) | Delete Blob objects when removing or replacing photos | Pending |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170402) | Record the completed features in HANDOFF | Pending |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170420) | Delete blobs when customers remove uploaded photos | Pending |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170433) | Accept only trusted uploaded photo URLs | Pending |
| [#60](https://github.com/christcr2012/appliance-desk/pull/60#discussion_r4124170447) | Remove the contradictory maintenance-photo roadmap entry | Pending |
| [#61](https://github.com/christcr2012/appliance-desk/pull/61#discussion_r4124590917) | Mark the restore attribution as unconfirmed | Pending |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549128) | Restrict financial operational pages from STAFF | Pending |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549136) | Honor failed email results before recording a reminder | Verified/merged #119; CI 36858433312 + Vercel; automated review waived; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549141) | Scope staff appliance updates to the originating job | Pending |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549150) | Propagate staff activation delivery failures | Verified/merged #119; CI 36858433312 + Vercel; automated review waived; resolved |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549157) | Keep completed swap jobs visible for status follow-up | Pending |
| [#62](https://github.com/christcr2012/appliance-desk/pull/62#discussion_r4125549168) | Filter the driver view to the signed-in staff member | Pending |
| [#76](https://github.com/christcr2012/appliance-desk/pull/76#discussion_r4135862592) | Apply the brand kit's heading weight | Pending |
| [#76](https://github.com/christcr2012/appliance-desk/pull/76#discussion_r4135862605) | Keep the design-system brand guidance in sync | Pending |
| [#78](https://github.com/christcr2012/appliance-desk/pull/78#discussion_r4136765429) | Ask before installing the Neon CLI globally | Pending |
| [#79](https://github.com/christcr2012/appliance-desk/pull/79#discussion_r4136879568) | Hide desk chrome when printing work orders | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#79](https://github.com/christcr2012/appliance-desk/pull/79#discussion_r4136879577) | Apply default job checklists to work orders | Verified/merged #120; CI 36858585089 + Vercel; automated review waived; resolved |
| [#80](https://github.com/christcr2012/appliance-desk/pull/80#discussion_r4137359495) | Add the promised way to supply a missing email | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#80](https://github.com/christcr2012/appliance-desk/pull/80#discussion_r4137359503) | Hide the add-lead control from staff or allow the action | Pending |
| [#80](https://github.com/christcr2012/appliance-desk/pull/80#discussion_r4137359513) | Cover the new persistence and approval flow with tests | Pending |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431819) | Add behavior tests before marking the CRM buildout complete | Pending |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431829) | Restrict personal tasks to their creator | Superseded by approved O09 team-shared visibility contract; current scope/role tests verified in #117 CI; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431837) | Keep tasks due today out of the overdue group | Verified existing Denver date-key fix; business-date/task workspace tests in #117 CI 36854516416; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431842) | Preserve the selected Colorado due date | Verified existing UTC calendar-date rendering; selected-day regression in #117 CI 36854516416; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431849) | Calculate Today using Mountain Time | Verified existing Denver midnight/DST boundaries; date/query/browser coverage in #117 CI 36854516416; resolved |
| [#81](https://github.com/christcr2012/appliance-desk/pull/81#discussion_r4138431858) | Clear the lost reason when reopening a lead | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909733) | Make purchase-order receiving atomic | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909741) | Synchronize the stock editor after stock changes | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909747) | Associate every purchase-order line label with its field | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909752) | Subtract used parts atomically | Verified/merged #118; CI 36854626321 + Vercel; automated review waived; resolved |
| [#83](https://github.com/christcr2012/appliance-desk/pull/83#discussion_r4138909756) | Record the completed feature in the handoff | Pending |
| [#86](https://github.com/christcr2012/appliance-desk/pull/86#discussion_r4143931482) | Block preview writes from changing live email settings | Pending |
| [#98](https://github.com/christcr2012/appliance-desk/pull/98#discussion_r4147176159) | Expect the later email-verification backfill | Pending |
| [#102](https://github.com/christcr2012/appliance-desk/pull/102#discussion_r4149812016) | Return to newest notes after adding from a filtered page | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#102](https://github.com/christcr2012/appliance-desk/pull/102#discussion_r4149812022) | Exclude overdue scheduled jobs from the next-visit slot | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#102](https://github.com/christcr2012/appliance-desk/pull/102#discussion_r4149812032) | Claim the lead before sending account side effects | Verified/merged #117; CI 36854516416 + Vercel; automated review waived; resolved |
| [#104](https://github.com/christcr2012/appliance-desk/pull/104#discussion_r4149971361) | Remove omitted concept files from the checksum inventory | Pending |
| [#104](https://github.com/christcr2012/appliance-desk/pull/104#discussion_r4149971370) | Replace the empty light-mark PNG | Pending |
| [#104](https://github.com/christcr2012/appliance-desk/pull/104#discussion_r4149971375) | Mark the official logo copies as still pending | Pending |

## Current verification checkpoint

#117–#122 merged after exact-head inspection, full CI and ready Vercel. Expected-head
merges used; stacked PRs retargeted to main and merge trees matched tested heads.
Automated review quota unavailable; Chris waived that step October 1. Thirty-one
threads resolved: twenty-eight historical and three new #117 findings. Sixty-three
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

Preceding/latest #122 submissions/threads/comments checked before Colorado dispatch
repair; no findings, automated review quota notice 5931613975. Calendar grouping,
day/week/agenda ranges and driver day/display now use explicit America/Denver;
23/25-hour days resolve both midnights independently. Conflict candidates include
the adjacent two-hour windows, while only visible-range jobs render.

Local 796 tests pass, typecheck/lint pass (two existing warnings). New regressions
cover invalid dates, evening/year boundaries, DST, driver ranges and rendered
boundary warnings. Guarded real-Postgres query checks and phone day/week/agenda,
checklist server-action persistence/reload and axe browser checks require full CI.
Five findings remain open until that verification/preview and exact-head inspection.
This repairs existing behavior; it does not complete O13/O14 or add assignment,
duration/version fields. New-job input/timezone unification remains in its gated
contract; no stored timestamps are rewritten.

Known remaining defects include paid-in-full subscription handling, recurring
waiver and earnings comparison. Staff job-origin status scope and driver SWAP
follow-up are valid unresolved findings. New backlog features remain behind
reconciliation; O02/O32 and live-action approvals unchanged.
