# COM-L12 — Telecom reconciliation and inactive alerts

Status: MERGED after exact-head CI green and review (PR number assigned at release). Baseline: main e52eb47 (COM-L11 #377 merged). Design: BATCH-COM sections 6 and 9. IN-53 is NOT approved; do not activate spending, live SMS/voice, notifications or provider configuration.

A. Verified code boundary: COM-L10 gives exact signed provider decimals, rate versions, statements and account-scoped cursors. COM-L11 records GMT usage and individual Message/Call costs with revisions. BusinessSettings communicationsPolicy is a strict owner-only versioned object. K accounting, provider invoice uploads and Today/report screens are separate future work.

B. Acceptance:
- Aggregate provider total for exactly matching GMT range, or complete nonoverlapping daily totals; never add overlapping dates, parent and child categories, resource charges or invoice layers together.
- Preserve ESTIMATED, PROVIDER_REPORTED and INVOICE_RECONCILED separately, signed credits included. Missing prices/fees/taxes are UNKNOWN, not free. Only one cents rounding after aggregation.
- Compare statement only if actually owner VERIFIED and matching date/currency. Return signed residual and independently configured ANY/ALL percent/cents mismatch criteria.
- Evaluate spend tiers, spikes and stale sync only on complete comparable evidence. $50/$75/$100 are an inactive suggested starting point, not approved spend; no sender/voice cutoff.
- Pure unit and isolated PostgreSQL tests for GMT, duplicate snapshots, corrections, unknown categories, partial periods, refunds, mismatch, stale source and no live side effects.
- Update STATUS, card, work-index, CHANGES-SINCE-DESIGN as if merged. Exact-head CI green; self-review because automated review unavailable — waived.

Next after merge: COM-L13A owner settings and private statement handling; IN-51/52/53 remain gated.

## Evidence and next handoff
- `telecom-costs.ts` handles provider GMT interval only, daily non-overlapping fallback, latest correction, source currencies, signed and known-only estimate values, distinct evidence layers, and owner-provided tolerance semantics. No payments or journal writes.
- `telecom-costs-store.ts` permits only active OWNER/ADMIN, bounded scoped evidence, and only an explicitly verified single statement for comparison. It does not expose a route or spend to STAFF.
- `telecom-alerts.ts` previews tiers/spikes/staleness; the policy starts disabled and even enabled configuration never performs a notification or circuit action. IN-53 stays unapproved, with any alert or paid action deferred to separate owner activation.
- Tested in disposable PostgreSQL: 17 related files/97 tests and direct 5 DB tests passed, plus 7 pure unit cases; no unexpected skips. Final merge requires full exact-head CI and thread disposition.
- Automated review unavailable — waived. Self-inspect money calculations, role checks, incomplete data, and policy activation boundary. Next COM-L13A owner-facing setup/private statement evidence, still without live provider mutation.
