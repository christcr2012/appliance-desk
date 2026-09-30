# O01 role audit — in progress, 2026-09-30

Policy source: DECISIONS “Staff permissions” gives STAFF operational access,
but walls off financial/settings data. No new role or policy is invented.
Customer A/B portal isolation is already exercised by the existing real-DB
tests; this update does not replace those tests or claim their newest CI result.

| Surface | OWNER/ADMIN | STAFF | Evidence/status |
|---|---|---|---|
| Today exceptions | Full existing exceptions | Operational exceptions only | O01A: billing blocked/invoices/repair cost queries skipped at source; negative query tests |
| Today schedule | Existing schedule | Bounded id/type/status/time/customer identity/address DTO | O01A: explicit select, no job costs or full customer record |
| Customer detail | Existing full record and owner actions | Separate operational record: contact, addresses, rental status, jobs and existing notes | O01A: no prices, credits, Stripe fields or referral reward queries; no full owner timeline loaded |
| Activity | All existing action categories | Explicit operational action allowlist | O01A: same where for counts/page/summary, unknown actions excluded, metadata not selected |
| Global search | Existing bounded contact/equipment/lead result | Same operational result | Inspected searchAll output: no money fields; protected desk layout; direct page-level guard should be included in final O01 pass |
| Billing/revenue/reports/settings/financial exports | Existing guards | Existing server rejection | Existing requireRole OWNER/ADMIN at routes/actions; full negative route inventory remains to be recorded |
| Agreement list/detail/new | Existing owner flows | Existing pages expose prices despite owner-only mutation actions | FOUND: must fix in O01B with operational read views; do not mark O01 complete |
| Job detail/client payload | Full internal repair cost bookkeeping | Existing full job payload may include bookkeeping | FOUND: must fix in O01B while retaining status/photo/checklist/inspection operations |
| Driver and work order | Operational read | Operational read | Existing rendered DTOs omit money; audit source selects and guards in O01B |

O01A is a bounded first PR. O01 remains IN_PROGRESS until the remaining rows
are fixed and negative URL/action/export/RSC checks plus gate G are verified.
O09/O13 remain blocked by O01/O02; no schema or finance side effects changed.

Local verification: 26 focused tests passed across Today rules and the three
new role suites; typecheck passed; lint passed with two existing warnings
(public/theme-init.js unused catch binding; contact form React Hook Form watch).
Full current-head CI/Playwright and preview evidence are tracked in HANDOFF.

Internal human notes remain operational team context, as before. This query
boundary controls structured finance records and system-generated activity;
it does not redact arbitrary free text written by a person. Any change to
team note visibility needs an explicit business rule rather than guessed filtering.
