# Design — Batch X: <name>

Status: **DRAFT** | **APPROVED DESIGN — implement from this document**.
Written <date> by <model> against `main` <sha>. Scope and acceptance:
`docs/PLAN.md` → Batch X.

<!-- Writing guide for the design author (delete when done):
- Read the code first. Every file you name must exist at the sha above, and
  every line range you cite must be right. The implementer trusts you.
- Decide. A design that says "consider" or "either/or" has not finished.
  State the decision and one or two sentences of reasoning so the
  implementer can resolve an unforeseen edge case the same way.
- Prefer the repo's existing patterns and name them by file and function.
- Schema as literal Prisma text. Function signatures as literal TypeScript.
- Tests by file name and case. Concurrency = real-Postgres integration test.
- Keep the stop-and-ask list honest: anything an owner must decide, anything
  that costs money, anything irreversible, anything you could not verify.
-->

## 0. Verify before starting

| # | Assumption about the code | How to check |
|---|---|---|
| A1 | … | `grep …` / read file lines … |

If any row is false, stop and report; the design may need amending.

## 1. Decisions (made — do not re-open)

**X1. <Decision in one sentence.>** Reason: <why; what breaks without it;
which finding/requirement it closes>.

**X2. …**

## 2. Schema changes (additive only)

```prisma
// literal Prisma; comments say which decision each field serves
```

Raw SQL (partial indexes etc.), backfills, and the order they run in.
Every new table: schema-health list + backup export + `docs/DATABASE.md`.

## 3. Shared primitives (if any)

Literal signatures; rules of use; tests.

## 4. Work units (in order; one commit each)

### WU-X1 — <name>
Closes: <finding/requirement IDs>.
Files: <exact paths; (new) where applicable>.
Change: <precise description or pseudocode; name the pattern to copy>.
Tests: `<file>` — <case>, <case>; (integration) <case>.
Done when: <observable condition, e.g. a grep that returns nothing>.

### WU-X2 — …

### WU-Xn — Docs and PR
Which docs change and what each gets; owner inputs to add; STATUS.

## 5. Stop-and-ask points

1. Any Section 0 assumption false.
2. …

## 6. Acceptance mapping

| PLAN checklist line | Evidence (test file / artifact) |
|---|---|
| … | … |

## Amendments

(Dated entries only. Never edit a decision silently.)
