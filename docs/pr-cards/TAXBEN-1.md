# TAXBEN-1 — Write-offs and tax benefits, found automatically

Build spec: `docs/build-specs/engines/TAX-BENEFITS.md` sections 1–3. Requested by Chris 2026-10-25. Depends on BA-1,
TFA-1, CMP-2, DEC-1. Risk: **tax estimates** (always "your CPA confirms").

## Acceptance
- [ ] Every expense account maps to a deduction (line, percent, kind); mixed-use percentages asked once, 0% until answered.
- [ ] Each purchase is expensed (de minimis) or capitalized with the reason shown; expensed units stay in the asset register.
- [ ] Signed capitalization policy generated and renewed each December.
- [ ] Start-up costs tagged and computed; the benefit list (vehicle, home office, QBI, SE, retirement, enterprise zone, county value, losses, ordinary deductions) with amounts, conditions and deadlines.
- [ ] Mid-quarter warning before Q4 buying; every number from the rule book (lint test).
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
