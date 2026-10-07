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
| f-large-account-owner-read | 13.5 ms | 50 properties / 200 active appliances; owner property workspace + active-equipment query |
| f-large-invoices-billing-page | 3.3 ms | 5,000 invoices; billing count + first 50-row page |

The two 1000 ms values above are intentionally temporary first-run ceilings, not claimed measurements. **F1-c must not merge with them.** After its first green `Performance Baselines` run, replace them with that exact runner's printed medians and record the tested commit/run below. Subsequent runs enforce the +20% rule against those measured values.

## Baseline evidence

Baseline source: commit `ee1370a`, workflow run `37548514814`, job `112558203896`, PostgreSQL 17 / Ubuntu 24.04 / Node 24. The run passed 4 perf files / 6 tests in 6.33 s. Measured medians: `f-large-account-owner-read` 13.5 ms; `f-large-invoices-billing-page` 3.3 ms.

Do not copy timings from a developer laptop or production. If a regression appears, inspect the query/query-plan and fixture first; do not add an index simply to silence the guard.
