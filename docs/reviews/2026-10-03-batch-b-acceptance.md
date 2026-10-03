# Batch B acceptance ledger (2026-10-03)

One line per item in `docs/PLAN.md` → Batch B → Acceptance checklist, with the
tests that prove it and an honest strength rating. "Integration" tests run on a
real throwaway Postgres in CI (`CI=true`); "unit" tests use fakes. Updated when
evidence changes. **Batch B is not marked complete until the "Not done" list at
the bottom is empty or accepted by Chris.**

| # | Checklist item | Evidence (tests/) | Strength |
|---|---|---|---|
| 1 | Provider-success/local-failure reconciliation (customer, subscription, referral) | Customer: `billing-ensure-stripe-customer.test.ts`. Subscription: `billing-subscription-renewal-integration.test.ts` ("Stripe succeeds but the local write fails": stale claim taken over, same idempotency key, one Stripe object), `billing-subscription-identity.test.ts`, `agreements-close-stripe-subscription.test.ts`, `billing-reconciliation.test.ts`. Referral: `referrals-integration.test.ts` | Strong (customer, subscription, referral all have a real-Postgres or simulated-provider test) |
| 2 | No duplicate Stripe customer / subscription / referral credit under concurrency or retry | Customer: `billing-ensure-stripe-customer-integration.test.ts`, `billing-provider-ops-integration.test.ts`. Subscription: `billing-subscription-renewal-integration.test.ts` (5 concurrent starts, one Stripe call, one operation row). Referral: `referrals-integration.test.ts`, `billing-receipts-integration.test.ts` | Strong |
| 3 | Webhook out-of-order and unknown-state reconcile without loss or double-apply | `webhook-atomicity-integration.test.ts`, `billing-webhooks.test.ts`, `billing-credit-and-webhook-race-integration.test.ts` | Strong for checkout, ACH, refunds, failure-then-paid and the write-off race. **Weaker** for `invoice.paid` before `checkout.session.completed` and `subscription.deleted` before the subscription is linked (not tested on real Postgres) |
| 4 | Late fee exactly once under concurrent cron runs | `billing-late-fees-integration.test.ts`, `billing-late-fees.test.ts` | Strong |
| 5 | Write-off cannot override a racing paid invoice | `billing-writeoff-race-integration.test.ts`, `manual-payment-concurrency-integration.test.ts`, and for a Stripe payment racing a write-off (20 rounds, both launch orders) `billing-credit-and-webhook-race-integration.test.ts`. **That last test found a real bug, fixed in this batch** (see Findings) | Strong |
| 6 | Gross / net / refund / deposit / tax / credit category tests | `billing-collected.test.ts` (categories, collected cash net of cash refunds, credit refunds excluded, overpayment counted, Colorado month edges), `billing-tax.test.ts`, `billing-refunds-integration.test.ts` | Strong, except there is no single fixture that combines a deposit line with gross→net in one assertion |
| 7 | Manual overpayment: one receipt, no double-spendable credit | `billing-manual-payments.test.ts`, `billing-ledger.test.ts`, `billing-receipts-integration.test.ts`, `manual-payment-concurrency-integration.test.ts`, and for ten parallel spenders of one credit `billing-credit-and-webhook-race-integration.test.ts` | Strong |
| 8 | Statement totals reconcile to line detail (refunds, unpaid, partial) | `billing-statements.test.ts` ("statement reconciliation": paid-then-refunded, unpaid, partly paid, credit-paid, written-off, draft and void in one fixture; flags a mismatch; carried forward) | Medium: the fixture uses fakes for the database, not real Postgres |
| 9 | Fixed-term end, renewal, cancellation, auto-renew: no overlap, no double-charged deposit | `agreements-term-integration.test.ts`, `agreements-term.test.ts`, `billing-subscription-renewal-integration.test.ts` (renewal creates a draft with no deposit, no Stripe call, old agreement untouched, second renewal refused) | Medium: nothing yet executes a scheduled termination or the renewal charge, because that behaviour is not built (see Not done) |
| 10 | Drift workbench lists seeded mismatches and performs no writes | `billing-drift-integration.test.ts` (real rows for 8 mismatch kinds, healthy rows absent, bounded, rows byte-identical after three runs, Stripe sees reads only), `billing-reconciliation.test.ts`, `billing-reconciliation-page.test.ts` | Strong. Known limits: only 50 closed agreements and 50 customers are checked per run; a local invoice paid while Stripe says unpaid is not detectable |
| 11 | Stripe test mode only; no live keys touched | `deployment-safety.test.ts`; every new test mocks Stripe | Medium: guards exist; nothing Batch-B-specific asserts it |
| 12 | `docs/BUSINESS-RULES.md` and `docs/DATABASE.md` updated | BUSINESS-RULES: "The payments ledger", tax, terms, reports and statements sections; DATABASE: Billing section with provider operation kinds/statuses, receipt, refund and credit fields | Done |
| 13 | Rules that apply to every batch | PR descriptions record AI-PR-READ-FIRST handling | Done per PR |

## Findings the tests produced

- **Fixed:** a Stripe `invoice.paid` event racing an owner write-off could leave an invoice PAID and still marked written off (the webhook rewrote the invoice without locking it). Now the webhook locks the customer and invoice first; if the invoice is already written off or void the money is recorded but held (a `held` payment, no spendable credit) and flagged for review (IN-23). Review follow-up (Codex on #154): the first version minted spendable credit before Chris had chosen, and a later Stripe refund of that charge could not find the payment; both fixed.
- **Noted, not reproduced:** a losing concurrent subscription starter writes its "already being started" message outside the lock; in theory that could briefly leave a stale message after the winner succeeds.
- **Limit, documented:** subscription healing after a crash re-uses the same Stripe idempotency key, which Stripe honours for about 24 hours; later recovery depends on the reconciliation job.

## Not done (honest list)

- Renewal billing and any job that acts on auto-renew consent or executes a scheduled early termination (nothing bills or ends a rental at the effective date yet).
- A signed-ahead renewal shows as active before its start (IN-22).
- Policy values are not entered yet (IN-19), so early-termination quotes are off until Chris enters them.
- Notice emails for term changes (live customer email needs Chris's approval; IN-21).
- Per-customer terms screens (Batch D).
- Out-of-order webhook cases listed in item 3.
- A screen for the owner to resolve a held payment (credit it, reverse the write-off, or refund it) — waiting on IN-23.

## Review dispositions (Codex threads open on #148–#153 when this PR was opened)

| PR | Finding | Disposition |
|---|---|---|
| #148 | P1 re-check the acting admin inside the policy write | **Already fixed.** `updateBusinessSettings` locks the settings row and calls `assertActiveTeamActor` inside its transaction (`src/domains/settings/index.ts`); `tests/settings-transaction.test.ts` "rejects a deactivated or non-admin author before touching settings". |
| #148 | P2 term-end readers must use the saved end date | **Already fixed.** Growth and exceptions readers use `endDate ?? start + term` (`src/domains/growth/index.ts`, `src/domains/exceptions/index.ts`); `tests/growth.test.ts` and `tests/exceptions.test.ts` cover a delivery-date end. |
| #149 | P1 show locked terms before the signature | **Fixed in #151** (signing page sections) and tightened here (wording, real-browser test). |
| #149 | P2 renewal signed ahead shows ACTIVE before its start | **Still open.** Needs a status or reader change the design is silent on; owner input IN-22. Next step: decide in the next billing-adjacent PR once Chris answers. |
| #151 | P1 optional renewal described as already on | **Fixed here.** Wording now says renewal is optional and not started unless turned on; unit test and browser test assert "opt out" is gone. |
| #151 | P1 test the real signing flow in a browser | **Fixed here.** `e2e/signing-waiver-presentation.spec.ts` has a fixed-term snapshot case: sections visible, before the "Sign agreement" button, axe clean at phone width (already assigned to a CI shard). |
| #152 | P1 approved design contradicts the tax migration | **Fixed here.** `docs/designs/BATCH-B.md` D12 and WU-B10 amended. |
| #152 | P2 old/new tax columns can drift during deploy | **Fixed here.** Migration `20261003190000_tax_rate_columns_stay_in_step` adds two-way triggers; `tests/tax-rate-columns-sync-integration.test.ts` (4 cases, real Postgres). |
| #153 | P2 statements drop legacy `SUCCEEDED` payments | **Fixed here.** One shared rule (`src/domains/billing/payment-status.ts`) used by statements, drift checks, the invoice page and the backfill script; `tests/billing-legacy-payment-status.test.ts` fails without the fix. |

| #154 | P1 refund of a held payment cannot find it | **Fixed in this PR.** The hold now keeps a `held` payment row with the Stripe payment-intent id, so `charge.refunded` records the refund; `tests/billing-credit-and-webhook-race-integration.test.ts` "held (not spendable), recorded once, and a Stripe refund of it is recorded". |
| #154 | P1 do not mint spendable credit before the owner approves (IN-23) | **Fixed in this PR.** No credit is created; the money is held and listed (drift workbench `HELD_PAYMENT`, revenue page). Design amended (D13 note). The owner action to resolve it waits on IN-23 and is on the Not-done list. |

AI-PR-READ-FIRST constraints for this PR: webhook duplicate/ACH tests kept and extended
(`tests/billing-credit-and-webhook-race-integration.test.ts`); no new email/SMS sends; no
public-form change; no auth change; no preview-safety change.
