# Performance baselines

Performance measurements run in `.github/workflows/perf.yml` against one disposable PostgreSQL 17 database, never production. Test files run serially so one scale fixture cannot distort another. Fixture setup and cleanup are outside timed sections.

## Batch E list/read baseline

The existing Batch E harness bulk-generates **1,000 customers, 2,000 invoices, 500 jobs, and 1,000 leads** and measures bounded customer/job/growth reads. It logs `[batch-e-perf]` timings and asserts the result caps; these historical reads remain in the workflow.

## Batch F capacity fixtures

Batch F adds the two launch-capacity scenarios required by the approved design:

- **large property-manager account:** 1 customer, 50 service addresses, 50 active agreements, 200 rental lines/appliances/assignments. The timed operation is the real owner property workspace plus current-equipment query.
- **large invoice ledger:** 1 customer with 5,000 invoices. The timed operation is the real billing-page count plus its first 50-row page.

Each F measurement gets one warm-up and five samples; the committed value is the median. A future result more than **20% slower** fails. `PERF_BASELINE_OVERRIDE_REASON` can override that failure only when a nonblank reviewed reason is printed into the workflow log.

| Metric key | Baseline | Fixture / operation |
|---|---:|---|
| f-large-account-owner-read | 1000 ms | Bootstrap ceiling for first F1-c CI measurement; **replace with the first green runner median before merge** |
| f-large-invoices-billing-page | 1000 ms | Bootstrap ceiling for first F1-c CI measurement; **replace with the first green runner median before merge** |

The two 1000 ms values above are intentionally temporary first-run ceilings, not claimed measurements. **F1-c must not merge with them.** After its first green `Performance Baselines` run, replace them with that exact runner's printed medians and record the tested commit/run below. Subsequent runs enforce the +20% rule against those measured values.

## Baseline evidence

Pending the first green F1-c performance run. Record: commit SHA, workflow run ID, both medians, PostgreSQL 17 / Ubuntu 24.04 / Node 24.

Do not copy timings from a developer laptop or production. If a regression appears, inspect the query/query-plan and fixture first; do not add an index simply to silence the guard.
