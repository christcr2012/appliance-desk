# CMP-5 — Hiring readiness

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-5. Depends on CMP-1. Dormant until employees > 0.

## Acceptance
- [x] Payroll obligations wake only when employees > 0; hiring checklist with links and dates (new hire report 20 days, etc.).
- [x] Decisions question "payroll inside the app or a payroll service" (starting value: service); provider CSV import to books.
- [x] `ci` green; every review comment read.

## Progress
Built 2026-10-27 on `ai/vivienne/cmp-5` (owner decision the same day: build now, ahead of the first
hire). The CMP-1 wake (employees fact → 941/940/W-2/withholding/UI/FAMLI) gains the Colorado new-hire
report obligation (due start + 20 days from the new `firstHireDate` fact), a fact-driven hiring
checklist on the Compliance screen, DQ-CMP-PAYROLL-HOW (starting value: payroll service), and the
provider CSV import posting balanced PAYROLL journals (new WAGES and EMPLOYER_PAYROLL_TAXES system
accounts, Schedule C lines 26 and 23). Tests: tests/hiring-readiness.test.ts,
tests/compliance-registry.test.ts, tests/payroll-import-integration.test.ts.

MERGED 2026-10-27 via PR #679, squash d22a76e8 on main (chain: #674 → #676 → #679, the first two
closed unmerged for GitHub merge-check reasons only — the API-assembled branch reading "dirty", then
the re-derived STATUS.md top-of-file conflict with OPS-8; the tree never changed). First CI found
the new integration test belongs in the serial shared-state project (registered in
vitest.config.mts). Three Codex findings on #674, all fixed with regression tests: the imports list
showed the stored pay DATE shifted a day (now formatted date-only), the checklist could read a
retired new-hire filing after a corrected start date (now matched by periodKey), and the checklist's
rate figures now quote the registry entries instead of carrying copies. With CMP-5 merged, Lane 5's
compliance line (CMP-1…CMP-5) is complete.
