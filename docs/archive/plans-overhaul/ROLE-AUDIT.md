> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-02.
> Nothing in this file is a current instruction; any "current", "next" or
> "supersedes" language below is historical. The working documents are
> `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# O01 role and data boundaries

Status: IN_REVIEW pending gate G on grouped foundation PR.
Owner reassigned O01 to Codex on 2026-09-30. PR #89 remains historical;
reviewed applicable code was reused and its missing surfaces completed.

| Surface | STAFF | OWNER/ADMIN | Enforcement |
|---|---|---|---|
| Today | Operational exceptions and schedule | Includes billing/repair exceptions | Authorized queries skip financial categories for staff; narrow customer/schedule select |
| Search | Customer/lead/appliance lookup fields | Same lookup fields | requireRole plus explicit select/DTO; customers and signed-out denied |
| Activity | Approved operational actions and matching totals | All actions | Same allowlist for count/page/summary; no arbitrary metadata |
| Customer detail | Contact/property/rental/job/note/task context | Full credits/referrals/prices and actions | Dedicated operational select; full read/timeline owner/admin only |
| Agreement list/detail | Status, appliance count/assigned equipment, address | Pricing, signature and owner controls | Separate operational selects; no free-text price labels |
| Job/driver/dispatch | Operations, checklist, status, photos, address | Repair-cost editing on detail | Narrow selects/client props; cost action owner/admin guard |
| Work order | Printable operational DTO | Same document | Authorized access; explicit non-financial DTO |
| Inventory detail/QR | Unit identity/status/condition/photos/QR | Cost/profitability and owner actions | Dedicated operational select; finance read helpers owner/admin |
| Fleet | Denied | Full profitability | Page and analytics requireRole; nav owner-only |
| New agreements/jobs; exports | Denied | Allowed | Page/domain/server action/export guards before queries or writes |
| Customer portal invoice | Own invoice only | Portal-scoped access | Existing customer-scoped query; CI second-customer negative fixture |

Tests: today/activity/operational-customer/desk-role/search/preview-database
unit suites; existing session/customer-isolation suites; staff-security e2e.
Free-text internal operational notes remain visible to staff as existing policy
allows; these are not automatic financial redaction. No new staff role or
per-user assignment policy is introduced. Browser/visual gates remain pending.
