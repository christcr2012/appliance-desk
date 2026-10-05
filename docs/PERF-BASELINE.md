# Batch E performance baseline

Batch E measures the list/read paths that are expected to stay usable as the business grows. The measurement runs in `.github/workflows/perf.yml` against its own disposable PostgreSQL 17 database, never production.

## Fixture

The isolated performance job bulk-generates the scale data after migrations and the normal CI seed: **1,000 customers, 2,000 invoices, 500 jobs, and 1,000 leads**. Fixture setup is deliberately outside the timed section; existing domain/integration tests prove write-path business rules, while this harness measures the read/query paths without spending CI time hashing 1,000 invitation passwords or sending test invitations.

The measured reads are:

- customer page, capped at 50 rows;
- job page, capped at 50 rows;
- win-back list, capped at 100 rows;
- churn-risk result, capped at 100 rows while its invoice/payment/maintenance inputs are independently bounded.

Every timed query prints `[batch-e-perf] <label>: <milliseconds>ms` in the workflow log. The test fails if a list loses its documented result bound. Stable ID tie-breakers are part of the corresponding list contracts so paging does not depend on database storage order.

## Exact-head baseline

The numeric wall-time baseline is recorded from the first green `Batch E Performance Baseline` run for the E6-E8 PR. Do not copy timings from local development or production; runner/database conditions must stay comparable. If a later change materially increases one of these times, inspect the query plan before adding an index—the Batch E design allows indexes only when the measurement shows they are needed.
