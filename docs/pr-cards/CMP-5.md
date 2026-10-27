# CMP-5 — Hiring readiness

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-5. Depends on CMP-1. Dormant until employees > 0.

## Acceptance
- [x] Payroll obligations wake only when employees > 0; hiring checklist with links and dates (new hire report 20 days, etc.).
- [x] Decisions question "payroll inside the app or a payroll service" (starting value: service); provider CSV import to books.
- [ ] `ci` green; every review comment read.

## Progress
Built 2026-10-27 on `ai/vivienne/cmp-5` (owner decision the same day: build now, ahead of the first
hire). The CMP-1 wake (employees fact → 941/940/W-2/withholding/UI/FAMLI) gains the Colorado new-hire
report obligation (due start + 20 days from the new `firstHireDate` fact), a fact-driven hiring
checklist on the Compliance screen, DQ-CMP-PAYROLL-HOW (starting value: payroll service), and the
provider CSV import posting balanced PAYROLL journals (new WAGES and EMPLOYER_PAYROLL_TAXES system
accounts, Schedule C lines 26 and 23). Tests: tests/hiring-readiness.test.ts,
tests/compliance-registry.test.ts, tests/payroll-import-integration.test.ts.
