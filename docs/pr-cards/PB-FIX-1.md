# PB-FIX-1 — customers-list owed-desc: end the per-call invoice re-aggregation

**Source:** follow-on card commissioned by the owner direction via main chat 2026-10-31, executing
Door 2(a) of `docs/PERF-BASELINES-INVESTIGATION-2026-10-31.md` (merged PR #821). Design record
amended: `docs/build-specs/screens/CUSTOMERS.md` §1 — this card IS the §1 escalation ("written up
first"), narrowed to a single maintained value and answering §1's missed-write objection (below).
Base: `79a555e0` (current main at card start). Lane 6.

## The problem, in numbers (from the investigation)

The customers-list `owed-desc` sort re-aggregates the whole Invoice table on every call
(`SUM(GREATEST(0, amountDue - amountPaid))` over every open-status invoice, grouped by customer).
At the 20,000-customer capacity fixture that aggregate is ~32 ms of the sort's 85 ms database
phase; at 40,000 customers the database phase alone is ~175 ms — over the whole 150 ms budget on
the fastest hardware measured. It is the only perf measurement projected to break its budget by
book growth alone.

## The pick — a trigger-maintained `Customer.owedCents`, and why not the index

Both sanctioned shapes were prototyped on PostgreSQL 17 (Workshop, CI shape) at 20k and 40k
customers, Phase A query verbatim from `src/domains/customers/list.ts`:

| Shape | 20k Phase A | 40k Phase A |
|---|---:|---:|
| Baseline (per-call aggregate) | 90.5 ms | 184.6 ms |
| Partial covering index on Invoice `(customerId, GREATEST(0, due-paid)) WHERE status IN (open set)` | 89.0 ms | 180.6 ms |
| **Maintained `Customer.owedCents` column (this card)** | **56.2 ms** | **112.0 ms** |

The index fails structurally, not marginally: the planner ignores it at both scales (a sequential
scan beats fetching 100–200k index rows), and no index can shrink an aggregate that must touch
every open invoice — it narrows rows, never their count. The maintained column removes the
aggregate from the read entirely; what remains is the same population pass the `name` sort already
pays. Win condition from the assignment: 40k database phase under 150 ms (112.0 ms, 25% headroom)
plus visible 20k margin (90.5 → 56.2 ms).

## Correctness — how the total stays right (the §1 objection, answered)

CUSTOMERS.md §1 rejected an application-maintained summary because invoice writes live in 30+
files (billing, tax, agreements, sales, privacy, webhooks, jobs; census at card authoring:
29+ direct `*.invoice.*` mutation sites plus raw-SQL writers) and any missed write makes the list
silently wrong. This card maintains the value **in the database**, not in application code:

- An `AFTER INSERT OR UPDATE OR DELETE` row trigger on `"Invoice"` adjusts the owning customer's
  `owedCents` by `contrib(NEW) − contrib(OLD)`, where
  `contrib(r) = CASE WHEN r.status IN ('OPEN','PARTIALLY_PAID','DELINQUENT','FAILED')
  THEN GREATEST(0, r."amountDueCents" − r."amountPaidCents") ELSE 0 END`.
  The trigger fires inside the writing transaction itself, for every writer — Prisma, raw SQL,
  seeds, jobs, future code — so there is no application path to miss. House precedent for
  trigger-kept columns: `sync_tax_rate_columns` (migration 20261003190000).
- **Concurrency:** the adjustment is an `UPDATE` of the single Customer row, which takes that
  row's lock until commit; concurrent writes to different invoices of the same customer
  serialize on it and each delta applies atomically under the lock, so no update can be lost.
  Writes for different customers never contend. A delta of 0 (e.g. a due-date-only change)
  skips the update.
- **Retries:** the delta is part of the writing transaction — a retried transaction replays
  whole or not at all, so a delta can never double-apply. Reassignment (`customerId` changes)
  subtracts from the old customer and adds to the new in the same trigger firing.
- **Cutover:** column add + backfill + trigger creation land in ONE migration transaction;
  the trigger's `SHARE ROW EXCLUSIVE` lock on `"Invoice"` blocks writers until commit, so a
  write either lands before the backfill's snapshot (counted) or after the trigger exists
  (maintained). No gap, no double count. Backfill computes exactly the live aggregate.
- **Repair story (kept honest):** the column is a sort key + display-grade total, never a
  source of money truth — invoices remain authoritative. The integration tests recompute the
  live aggregate and assert equality; a one-statement recompute (the backfill SQL) is the
  documented repair if drift is ever suspected.

## Build contract (ordered)

1. **Schema:** `Customer.owedCents Int @default(0)` (additive). Regenerate the Prisma client.
2. **Migration** (one transaction): add column → backfill from the live aggregate → create
   `maintain_customer_owed_cents()` + trigger `Invoice_maintain_customer_owed`.
3. **Read:** `src/domains/customers/list.ts` Phase A, unscoped path only — the `owed-desc`
   branch drops the invoice aggregate join and orders by `c."owedCents" DESC, nameKey, id`.
   Identical ordering semantics: `COALESCE(aggregate, 0)` ≡ maintained total (0 for customers
   with no open invoices), same tie-breaks. The scoped (search) Phase A and the Phase B facts
   keep their live aggregates — candidate/window-scoped, not the problem, and they serve as a
   permanent cross-check on the column in tests.
4. **No other behavior change.** Budgets, perf thresholds, the perf fixture and the measurement
   method are untouched (Door 1 is the owner's parked decision, NOT this card).

## Named regression cases (proof, not promises)

- Trigger invariant integration test (real migrated Postgres): insert invoice → total moves;
  partial payment → moves; pay-off + status flip out of the open set → returns to 0; status
  flip into the open set → appears; delete → removed; reassign to another customer → both
  totals correct; two concurrent transactions writing different invoices of one customer →
  final total equals the live aggregate; an update that changes no money field → total
  unchanged. Each assertion compares against the live aggregate query.
- Owed-desc ordering parity: on a mixed fixture, the ordered id list from `getCustomerList`
  (sort `owed-desc`) equals the order computed from the live aggregate — before/after the read
  change, byte-identical results on the CU-1 test surface; existing customers suites pass
  unmodified.
- Perf evidence, measured exactly as the investigation: perf test file unchanged, Workshop
  PG17 CI shape, before/after medians for owed-desc (full call) at 20k, plus EXPLAIN Phase A
  at 20k and 40k (before numbers: 90.5 / 184.6 ms; prototype after numbers: 56.2 / 112.0 ms).

## Excluded and deferred

- `attention`'s invoice aggregate and segment counts: different shape (oldest due date), not
  this card; the column does not serve them and they stay live.
- Budget re-basing (Door 1): owner's parked decision; untouched here.
- `rent-desc` maintained total: same pattern, separate future card if the owner wants it.

## Completion evidence

Migration + trigger + read change merged with CI green at the exact head; before/after table
filed in the PR body and STATUS; CUSTOMERS.md §1 amendment recorded; DATABASE.md trigger
inventory updated if it catalogs triggers (check at build time).
