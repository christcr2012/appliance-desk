# Remediation R1 — Stripe billing-calendar amendment

**Date:** 2026-10-04  
**Applies to:** `docs/designs/REMEDIATION-BATCH-R-2026-10-04.md`, R1-C / R03–R04 and the existing shared subscription-term boundary used by renewal/early termination.  
**Status:** Approved design amendment for the current R1 implementation.  
**Reason:** The original R1 design deliberately required the Stripe provider sub-step to stop rather than approximate if the installed/current Stripe API could not preserve the Colorado delivery anniversary without changing money behavior. Exact-head review and provider verification exposed DST, proration, month-end, and cancellation-boundary interactions that were not specified precisely enough in the original design.

This amendment is the authoritative implementation contract for the Stripe-calendar portion of R1. All other R1 design decisions remain unchanged.

## 1. Problem discovered during implementation

The local business rule is calendar based, not elapsed-seconds based:

- the first real delivered Colorado business date is the billing anchor;
- a January 29/30/31 anniversary falls on February's last valid day and returns to the original day in March when possible;
- DST must not move a customer's billing date to the preceding Colorado date;
- the customer must be billed whole anniversary periods, not a fractional period introduced only by UTC/DST representation;
- fixed-term and early-ending provider cancellation must stop on the same provider cycle boundary rather than a few minutes/hours before it.

A single UTC timestamp chosen from a short month or a DST-specific Colorado-midnight instant cannot satisfy all of those rules by itself.

## 2. Verified Stripe capabilities and evidence

Current Stripe subscription creation supports:

- `backdate_start_date` (must be in the past);
- `billing_cycle_anchor_config` with `day_of_month`, `hour`, `minute`, `second` for monthly billing;
- `billing_mode: { type: "flexible" }`.

Test-mode verification was performed before this amendment using a $40 monthly price. No live-mode Stripe action was used.

Observed provider behavior:

1. Flexible billing with a provider start at 07:00 UTC and the matching monthly provider boundary produced exact full monthly lines with no partial-hour overcharge. Three periods totaled exactly $120.00.
2. `billing_cycle_anchor_config` with `day_of_month: 31` produced the required Jan 31 → Feb end → Mar 31 → Apr 30 sequence rather than permanently drifting to February's day.
3. Using the old Colorado end-of-day instant as Stripe `cancel_at` while the provider cycle recurred at 07:00 UTC prorated the final period ($119.95 in the three-$40-period test). Cancelling exactly at the matching provider cycle boundary produced the intended $120.00.

These provider facts are implementation evidence, not new business policy.

## 3. Authoritative provider-calendar contract

### 3.1 Local business facts remain authoritative

`RentalAgreement.firstDeliveredOn`, `billingStartedAt`, `endDate`, and `terminationEffectiveOn` remain Colorado business facts. Do not rewrite them to 07:00 UTC merely to suit Stripe.

- `firstDeliveredOn` remains the write-once first real delivery business-date value.
- `billingStartedAt` remains `firstDeliveredOn` when recurring billing is confirmed.
- `endDate` remains the final real Colorado second of the local term.
- customer/owner-visible dates continue to use the business-date helpers.

### 3.2 Provider representation

For Stripe only, represent a Colorado billing date at **07:00 UTC** on that same calendar date. 07:00 UTC is never on the preceding Colorado date: it is midnight during MST and 1:00 a.m. during MDT.

Create one shared helper in the billing domain for this provider representation. Do not duplicate date math in checkout, renewal, or termination code.

For monthly recurring creation:

- `backdate_start_date` = 07:00 UTC on `firstDeliveredOn`'s Colorado business date;
- `billing_cycle_anchor_config.day_of_month` = the original delivery day-of-month;
- `billing_cycle_anchor_config.hour/minute/second` = `7/0/0`;
- `billing_mode.type` = `flexible`;
- do not derive a permanent recurring day from a clamped next-month date;
- do not use a one-off `billing_cycle_anchor` timestamp for this contract.

### 3.3 Future-backdate guard

Stripe requires `backdate_start_date` to be in the past. During MDT, a delivery completed between Colorado midnight and 1:00 a.m. occurs after the local business date begins (06:00 UTC) but before the provider-safe 07:00 UTC representation.

In that window:

- do **not** send a future `backdate_start_date`;
- do **not** substitute provider-call time;
- do **not** shift `firstDeliveredOn` to another date;
- do **not** consume the handoff retry budget;
- return a deferred/non-success handoff outcome and leave the provider operation unclaimed/unwritten;
- a later handoff sweep may start Stripe billing after the 07:00 UTC boundary, still backdated to that same delivery business date.

This is a provider-timing defer only. It is not a customer/payment-method blocker and it must not change the local billing-start fact.

### 3.4 Fixed-term and early-ending cancellation

Stripe cancellation boundaries must use the same provider calendar as the recurring cycle.

- Natural fixed term: Stripe `cancel_at` = 07:00 UTC at the start of the Colorado business date immediately following local `endDate`.
- Early ending: `terminationEffectiveOn` is the Colorado anniversary on which the next period must not begin; Stripe `cancel_at` = 07:00 UTC on that effective business date.
- Renewal extend/revert and withdrawal paths must call the same shared helper; no caller may re-create the old local-end timestamp math.

Local agreement end dates are not changed by this provider representation.

### 3.5 Webhook/local persistence boundary

Stripe invoice period timestamps may now be at 07:00 UTC. That instant is intentionally on the correct Colorado calendar date under both MST and MDT. Existing local invoice/provider timestamp fields may preserve the raw provider instant; all business-date interpretation continues through the existing America/Denver helpers. Do not rewrite provider timestamps to fake midnight and do not change cash/webhook idempotency behavior in R1.

## 4. Full affected-system inventory before code

The R1 implementation must verify every caller/consumer in this set before the next push:

- `src/domains/billing/checkout.ts` — subscription create parameters and provider timing defer;
- `src/domains/billing/stripe-billing-anchor.ts` — the single provider calendar helper;
- `src/domains/billing/subscription-term.ts` — natural term, renewal extend/revert, and early-ending Stripe boundaries;
- `src/domains/billing/webhooks.ts` — confirm raw provider period timestamps remain on the correct Colorado business date and no new webhook dedupe/payment behavior is introduced;
- `src/domains/jobs/completion.ts` — deferred/BLOCKED handoff outcomes must keep retry budget and eventually re-run;
- renewal/auto-renew callers of `cancelAtSecondsFor` / `cancelAtSecondsForAgreement`;
- all tests that hard-code Stripe `cancel_at`, backdate, anchor, period, or next-billing timestamps;
- canonical `docs/BUSINESS-RULES.md`, `docs/ARCHITECTURE.md`, and `docs/DATABASE.md` descriptions.

Do not fix only the currently failing assertion. Search the whole repo for the shared helpers/provider parameters and update every affected expectation in the same implementation unit.

## 5. Required regression matrix

Before this amendment is considered implemented, the exact PR head must prove all of the following:

### Subscription creation

- ordinary delivery date: Stripe receives `billing_mode.flexible`, the 07:00 UTC backdated provider date, and `billing_cycle_anchor_config` from the original delivery day;
- delivery days 29, 30, and 31 preserve the original day-of-month through February and return to that day when the following month supports it;
- autumn DST fallback never moves the Colorado billing date backward;
- spring DST transition never moves the Colorado billing date backward/forward;
- delayed provider execution uses the original delivery date, never retry time;
- a summer delivery completed before that date's 07:00 UTC provider boundary is deferred without claiming Stripe work or consuming handoff retry budget; after the boundary the same logical handoff can proceed;
- local `billingStartedAt` remains the true `firstDeliveredOn`, not 07:00 UTC.

### Money outcome

- no fractional period is introduced solely by the provider clock representation;
- the provider evidence above (three $40 monthly periods = exactly $120.00) is recorded in the PR validation notes;
- no live-mode Stripe action is used.

### Cancellation / renewals / early ending

- natural fixed-term `cancel_at` is the matching 07:00 UTC provider cycle boundary after local `endDate`;
- early-ending `cancel_at` is the matching 07:00 UTC provider boundary on `terminationEffectiveOn`;
- auto-renew withdrawal/revert restores that same natural provider boundary;
- scheduled/manual renewal tests using `cancelAtSecondsFor` stay green;
- existing renewal overlap/idempotency/provider-operation tests stay green.

### Existing R1 behavior

All previously required R01–R05 real-Postgres tests remain green: explicit handoff outcomes, exclusive lease/stale recovery, zero-delivery behavior, delayed-provider recovery, fair deferred work, exhausted handoff finalization, renewal/job serialization, and SWAP/current-lineage locking.

## 6. Review-thread disposition rule

The unresolved Stripe-calendar review findings are one design cluster, not independent patches:

- preserve Denver billing date across DST;
- avoid billing past the anniversary through a shifted UTC anchor;
- preserve original month-end anniversary;
- never send a future `backdate_start_date`;
- align fixed-term/early-ending Stripe cancellation with the provider cycle;
- update all real-Postgres assertions and canonical docs for that shared contract.

Resolve those threads only after the **same exact head** satisfies the full matrix above and CI/preview/review gates pass. Outdated thread position does not mean the finding is resolved.

## 7. Scope boundary

This amendment does not authorize:

- live Stripe mode;
- a new billing policy;
- changing local contract dates to provider timestamps;
- a webhook redesign (R08 remains later remediation scope);
- invoice/payment-state changes outside what is necessary to preserve the established delivery-anniversary rule;
- automatic renewal activation or customer messaging.

If current Stripe behavior or the installed SDK cannot implement this exact contract, stop the provider sub-step again and record the conflict rather than approximating.