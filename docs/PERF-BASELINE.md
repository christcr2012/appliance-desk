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
| f-large-account-owner-read | 1000 ms | Temporary bootstrap ceiling for the batched measurement; **replace with the first green batched-run median before merge** |
| f-large-invoices-billing-page | 1000 ms | Temporary bootstrap ceiling for the batched measurement; **replace with the first green batched-run median before merge** |

The two 1000 ms values are intentionally temporary bootstrap ceilings for the revised batched measurement and are not claimed performance. **F1-c must not merge with them.** Replace them with the first green batched-run medians, then subsequent runs enforce the +20% rule.

## Baseline evidence

Previous single-query evidence (superseded because it was too noise-sensitive): commit `ee1370a`, workflow `37548514814`, medians 13.5 ms and 3.3 ms. Pending: first green batched-measurement run.

Do not copy timings from a developer laptop or production. If a regression appears, inspect the query/query-plan and fixture first; do not add an index simply to silence the guard.
