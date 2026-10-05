# Remediation Batch R — acceptance ledger (2026-10-04)

Maps each finding R01–R17 in `docs/designs/REMEDIATION-BATCH-R-2026-10-04.md` to the merged pull
request and the tests that prove it. It does not rewrite the two original review reports; their
findings stay as written and this file is their disposition.

How to read the evidence: every PR below was merged with the `ci` check green at its exact head
and no unresolved review thread. Tests named here run against a throwaway real Postgres in CI (the
`remediation-r*` files). "Fails on old code" means the new test was run against the previous
implementation and failed, so it really tests the fix.

Review record: Codex answered "usage limits reached" on #187–#197 (waived under the owner's
standing waiver of 2026-10-01, recorded on each PR after checking); no Copilot review was posted;
the diffs were inspected by the implementing agent. #186 had five Codex threads plus one late
thread; all are resolved with fixes and tests (below). No finding is open.

| ID | Finding (plain English) | Disposition | PR (merge) | Evidence |
|---|---|---|---|---|
| R01 | Billing hand-off could be marked done while the Stripe work had failed or was unknown | Fixed | #185 | `remediation-r1-handoff-delivery-integration` (blocked work keeps its retry budget), `remediation-r1-handoff-queue-integration`, `remediation-r1-exhausted-handoff-recovery-integration` |
| R02 | Hand-off claim was not exclusive while work was in flight | Fixed | #185 | `remediation-r1-handoff-delivery-integration` (one worker holds the lease; abandoned lease recovered once), `remediation-r1-deferred-handoff-fairness-integration` |
| R03 | A delivery visit where nothing was delivered could start recurring billing | Fixed | #185 | `remediation-r1-handoff-delivery-integration` (nothing delivered: no first-delivery fact and no billing hand-off; partial delivery behaves as before) |
| R04 | The real first-delivery date was lost before billing ran | Fixed locally; provider side deliberately not changed (see "Not done" 1) | #185 | `firstDeliveredOn` stored once and used for fixed-term dates (`remediation-r1-handoff-delivery-integration`, `remediation-r1-delayed-credit-integration`) |
| R05 | A renewal could leave stale jobs, custody or billing lineage | Fixed | #185 | `remediation-r1-renewal-lineage-integration`, `remediation-r1-cancelled-renewal-lineage-integration` |
| R06 | A deposit moved with a renewal but its original Stripe payment did not | Fixed | #186 (18fbba1) | `Deposit.sourceReceiptId` (migration `20261005010000`); `remediation-r2-deposit-provenance-integration` (2- and 3-agreement renewal chains keep the original receipt; manual deposits link a manual receipt), `remediation-r2-deposit-provenance-ambiguity-integration`, `remediation-r2-deposit-refund-authorization`, `remediation-r2-deposit-refund-reconciliation-integration` (a failed refund is retried on the source receipt's charge, never the oldest payment; no receipt evidence means no Stripe call). Review threads: five Codex threads and one late thread, all fixed and resolved |
| R07 | Refund/payment reads ignored the older uppercase payment status | Fixed | #187 (73a176a) | `remediation-r2-webhook-payment-status-integration`, `billing-refunds-integration` (lowercase and uppercase history give identical results) |
| R08 | A slow Stripe call held the global webhook lock | Fixed | #188 (0091f4e) | `remediation-r2-webhook-evidence-integration`: every Stripe lookup completes while the lock is free; replay makes no Stripe call; a Stripe failure records nothing; evidence found missing under the lock is fetched outside it and applied once. `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` updated |
| R09 | An expired estimate could still be approved or changed | Fixed | #189 (059b1b1) | `remediation-r2-estimate-expiry-integration` (approve and change-request refused and marked Expired; lead-based estimate creates no customer; last second of the day still works; three fail on old code), `remediation-r2-estimate-expiry` (winter, summer, spring-forward and fall-back days, exact boundary, old midnight-UTC rows) |
| R10 | Sending an estimate twice at once could email twice | Fixed | #190 (2609931) | `remediation-r2-estimate-send-integration` (three overlapping sends give one email; key built from the saved send time; re-send gets a new key; REJECTED and UNKNOWN leave a history note and are not replayed; email-off is not a failure; five of six fail on old code) |
| R11 | Date-only inputs bypassed the Colorado date helpers | Fixed | #189 (estimate valid-until) and #191 (4451ce7) (appliance purchase date) | `remediation-r2-purchase-date`, `remediation-r2-estimate-expiry`. Task due dates and a lead's desired start date keep their existing date-only convention (stored and shown as the same date) and were left alone on purpose (`docs/DECISIONS.md`) |
| R12 | Repair costs accepted negatives, bad text and silently erased the old value | Fixed | #192 (961c4fb) | `remediation-r2-repair-costs` (25 cases through the parser, action and a direct domain call), `remediation-r2-repair-costs-integration` (the "parts already itemized" guard still works) |
| R13 | Inventory commands were not one guarded transaction | Fixed | #193 (e4ff783) | `remediation-r2-inventory-guarded-commands-integration` (staff and archived admin refused by all five commands with nothing written; a forced history-write failure leaves no change for each; two overlapping retires give one winner; 12 of 17 fail on old code). Manual status change and inspection were already guarded; staff keep only the job-scoped paths from Batch C |
| R14 | Purchase-order creation checked the supplier and wrote its history outside one transaction | Fixed | #194 (3047617) | `remediation-r2-purchase-order-create-integration` (staff refused; history failure leaves no order; archived supplier refused; eight archive-vs-create races always consistent) |
| R15 | Part usage could record a stale purchase cost during a receipt | Fixed | #195 (378a3bc) | `remediation-r2-part-usage-cost-integration` (a receipt that commits first is the cost used; a usage that wins first uses the earlier cost; the first fails on old code) |
| R16 | Receipt retry identity ignored free-text lines | Fixed | #196 (94e34f3) | `PurchaseOrderReceiptOperation` (migration `20261005020000`, additive, in backup policy); `remediation-r2-po-receipt-operation-integration` (same payload replays; changed free-text quantity, price or known-vs-unknown refused; line order irrelevant; new key allows a later partial receipt; failed receipt leaves no claim; three simultaneous requests give one effect; five of nine fail on old code) |
| R17 | Today loaded whole history tables and sorted in memory | Fixed | #197 (657f075) | `today-role-access` (all 12 category reads capped at 50 with an id tie-break), `remediation-r2-bounded-exceptions-integration` (57 overdue jobs give 50 shown, true total reported, oldest first; maintenance-due and term-ended rules done in the database), `today-workspace` ("more not shown" note) |

First-review item P1-2 (historical staff `JobAppliance` provenance): verified fixed by #174
(`job-scope-integration`), not by Batch R.

## Whole-flow scenarios (design section 8)

| # | Scenario | Evidence |
|---|---|---|
| 1 | First delivery and retry | `remediation-r1-handoff-delivery-integration`, `remediation-r1-handoff-queue-integration`. The original delivery date is kept locally; the Stripe-side anchor is not (see "Not done" 1) |
| 2 | Renewal plus field work | `remediation-r1-renewal-lineage-integration` |
| 3 | Deposit across several renewals, then refund | `remediation-r2-deposit-provenance-integration` (two- and three-agreement chains), `remediation-r2-deposit-refund-reconciliation-integration` |
| 4 | Old lowercase vs uppercase payment status | `remediation-r2-webhook-payment-status-integration`, `billing-refunds-integration` |
| 5 | Estimate race and expiry | `remediation-r2-estimate-send-integration`, `remediation-r2-estimate-expiry-integration` |
| 6 | Purchasing races | `remediation-r2-purchase-order-create-integration`, `remediation-r2-part-usage-cost-integration`, `remediation-r2-po-receipt-operation-integration` |
| 7 | Authorization rollback | `remediation-r2-inventory-guarded-commands-integration` |

## Not done, or not proven here (read this before calling Batch R closed)

1. **(Superseded 2026-10-04: built after Chris answered IN-28, see `docs/DECISIONS.md`.) Stripe-side billing anchor for a late first delivery (second review P2-1) was not changed in Batch R.**
   #185 stores the real delivery date locally and derives local dates from it, but deliberately does
   not move or backdate Stripe's billing calendar, because the current Stripe behavior could change
   amounts or dates through proration. The design lists this as a stop-and-ask boundary. A Stripe
   subscription started late still bills from the day it was created. Chris must decide whether to
   accept that, or approve a designed approach; it is recorded in `docs/OWNER-INPUTS.md` as a question
   to answer before real customers.
2. **No preview (browser) check of the touched owner and customer screens** was done by me: the
   public estimate page, the add-appliances form, the job repair-cost form and Today. Automated
   tests and the CI browser suite passed, which is not the same as someone looking at them.
3. **(Done 2026-10-04) The migration upgrade drill on a populated database.** A scratch Postgres was built by
   applying every earlier migration in order (56), then filled with old-style data: 8 agreements each with a deposit,
   invoice, deposit line and payments; 7 receipts; a supplier and a purchase order. Cases: one clean payment, a payment
   split across two receipts, an uppercase `SUCCEEDED` status, no payment, two deposits sharing one receipt, a receipt
   belonging to another customer, and a failed payment. Then `20261005010000` and `20261005020000` were applied.
   Result: row counts identical before and after (8/8/7/8/1/8); every existing Deposit column byte-identical; only the
   clean payment (D1) and the uppercase-status payment (D3) were linked to their receipt, and the six ambiguous or
   unsafe cases stayed empty (no guessing); the unique index refused a second deposit claiming a linked receipt; deleting
   a linked receipt was refused; the new `PurchaseOrderReceiptOperation` table started empty, refused a duplicate
   operation key, and was removed with its purchase order. Scratch database only; nothing was run against production.
4. **Unrelated open work stays open and is not claimed by this batch:** Batch B renewal-lifecycle items
   R1/R2/R3/R4/R6/D2 (the old, different "R" numbers in `docs/STATUS.md`), the month-to-month notice
   (IN-21), and C-09. Re-assess C-09 and Batch D against the contract changes in
   `docs/designs/CHANGES-SINCE-DESIGN.md` before starting them.
5. No live Stripe, email or SMS behavior was turned on, and no fixtures were run against production.
