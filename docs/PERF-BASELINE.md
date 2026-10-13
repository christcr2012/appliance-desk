# Performance baselines

Performance measurements run in `.github/workflows/perf.yml` against one disposable PostgreSQL 17 database, never production. Test files run serially so one scale fixture cannot distort another. Fixture setup and cleanup are outside timed sections.

## Batch E list/read baseline

The existing Batch E harness bulk-generates **1,000 customers, 2,000 invoices, 500 jobs, and 1,000 leads** and measures bounded customer/job/growth reads. It logs `[batch-e-perf]` timings and asserts the result caps; these historical reads remain in the workflow.

## Batch F capacity fixtures

Batch F adds the two launch-capacity scenarios required by the approved design:

- **large property-manager account:** 1 customer, 50 service addresses, 50 active agreements, 200 rental lines/appliances/assignments. The timed operation is the real owner property workspace plus current-equipment query.
- **large invoice ledger:** 1 customer with 5,000 invoices. The timed operation is the real billing-page count plus its first 50-row page.

Each F measurement gets one warm-up and five samples. Each sample times 20 repeated real reads and records milliseconds per operation; the committed value is the median of those five per-operation samples. This batching reduces runner-scheduling noise on very fast queries. A future result more than **20% slower** fails. `PERF_BASELINE_OVERRIDE_REASON` can override that failure only when a nonblank reviewed reason is printed into the workflow log.

| Metric key | Baseline | Fixture / operation |
|---|---:|---|
| f-large-account-owner-read | 11.94 ms | 50 properties / 200 active appliances; owner property workspace + active-equipment query |
| f-large-invoices-billing-page | 4.42 ms | 5,000 invoices; billing count + first 50-row page |

These are the exact per-operation medians from the first green batched F1-c `Performance Baselines` run. Subsequent runs enforce the +20% rule against these committed measurements.

## October 13, 2026 — 5,000-invoice page root-cause investigation

PR #429's independent performance run measured approximately **5.42 ms/op**
against the unchanged 4.42 ms baseline / **5.304 ms 20%-regression guard**.
It failed, and that result must remain in the record. Other runs (including
#432) passed, indicating runner variability but not making the red run green.

A disposable PostgreSQL 17 diagnosis on exact post-#432 main
`917b22c` reproduced the **actual missing-order-index bottleneck** with the
same 5,000-invoice fixture and existing `getInvoicesCount()` +
`getInvoicesPage(undefined, 0, 50)` operations. Before the index,
`EXPLAIN (ANALYZE, BUFFERS)` for the first-page sort showed a sequential scan
of 5,002 invoices and top-N heapsort (**1.551 ms SQL execution**).
Five batched real read samples were 4.30, 4.06, 3.82, 3.70 and 3.57 ms/op;
median **3.82 ms/op**.

A **temporary index in disposable Postgres only** on
`("createdAt" DESC, "id" DESC)` changed the plan to an index-only ordered
scan of the first 50 rows (**0.045 ms SQL execution**). Real full count +
page samples were 1.63, 2.40, 1.30, 1.49 and 1.68 ms/op; median **1.63 ms/op**,
approximately **57% below** the same-run pre-index median. This is evidence
of an avoidable sort/scan cost, not a guarantee of identical production or
runner latency. No test, guard, baseline, override or fixture was weakened.

An additional untouched-guard performance suite run **after applying the
actual migration** to a fresh throwaway PostgreSQL database passed at
**3.17 ms/op**, with samples 3.62, 3.17, 2.73, 2.93 and 3.65; both
the index existence regression and the existing 5,000-invoice
count+page guard passed. The isolated diagnostic and full migrated
suite have different warmed runner conditions, so do not compare
their absolute medians as a controlled production benchmark.

The corresponding additive `Invoice_createdAt_id_idx` migration is reversible
with `DROP INDEX IF EXISTS "Invoice_createdAt_id_idx";` and preserves
customer, status, issued date and primary-key indexes. The performance suite
must verify that the index exists on actual migrated PostgreSQL and must
continue enforcing **the recorded 4.42 ms baseline**. Require unchanged
exact-head performance and CI before claiming the correction shipped;
continue investigating if measured regressions recur.

## Baseline evidence

Baseline source: commit `96f2827`, workflow run `37550747298`, job `112565355118`, PostgreSQL 17 / Ubuntu 24.04 / Node 24. Batched medians: `f-large-account-owner-read` **11.94 ms/op** (samples 14.78, 11.90, 12.89, 11.94, 11.74); `f-large-invoices-billing-page` **4.42 ms/op** (samples 4.66, 4.42, 4.00, 4.75, 3.98). The earlier single-query 13.5/3.3 ms run is superseded because it was intentionally replaced by the more stable batched method.

Do not copy timings from a developer laptop or production. If a regression appears, inspect the query/query-plan and fixture first; do not add an index simply to silence the guard.
