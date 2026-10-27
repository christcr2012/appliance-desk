# TAXBEN-1 — Write-offs and tax benefits, found automatically

Build spec: `docs/build-specs/engines/TAX-BENEFITS.md` sections 1–3. Requested by Chris 2026-10-25. Depends on BA-1,
TFA-1, CMP-2, DEC-1. Risk: **tax estimates** (always "your CPA confirms").

## Acceptance
- [x] Every expense account maps to a deduction (line, percent, kind); mixed-use percentages asked once, 0% until answered.
- [x] Each purchase is expensed (de minimis) or capitalized with the reason shown; expensed units stay in the asset register.
- [x] Signed capitalization policy generated and renewed each December.
- [x] Start-up costs tagged and computed; the benefit list (vehicle, home office, QBI, SE, retirement, enterprise zone, county value, losses, ordinary deductions) with amounts, conditions and deadlines.
- [x] Mid-quarter warning before Q4 buying; every number from the rule book (lint test).
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/vivienne/taxben-1` (execution packet `docs/pr-cards/execution/TAXBEN-1.json`):
the deduction chart and thirteen rule seeds; the classification engine with recorded,
reason-carrying decisions wired into purchase recording (related-party question included); the
Section 195 start-up module on the packet and the 4562 Part VI block; the signed capitalization
policy as a Business record with the December renewal To do; the compute-on-read benefit list on
Taxes › Tax benefits with Write-off settings and the mid-quarter / retirement / enterprise-zone /
business-use To dos; the guided-setup walkthrough. Six starting values filed as DQ-TAXBEN-*.
Local proof: the five taxben suites plus the purchase, packet, exceptions and setup suites on
throwaway Postgres. CI and review land with the PR.
