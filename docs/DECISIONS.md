# Decisions log — current

This is the **current** decisions log. Keep it short and useful: dated entries,
newest first, for decisions made from 2026-10-03 forward.

The original decisions log was retired because it had grown too large to serve
as routine working context. Its archive entry follows the same retirement
convention as the other retired project documents:

`docs/archive/DECISIONS-before-2026-10-03.md`

That retired index points to the unchanged historical log. Do **not** read the
historical log end to end during normal work. Search it only when a specific
older decision, date, feature, PR, or code comment requires the historical
reasoning. If an older code comment says “see docs/DECISIONS.md” and cites a
date before 2026-10-03, use the retired archive entry above.

If a current decision is later reversed, add a new dated entry here rather than
editing the earlier decision away.

---

### 2026-10-04 (later) — IN-28: Stripe billing begins on the real delivery day

Chris: "Billing should begin upon delivery." A new subscription is created with Stripe's
`backdate_start_date` = Colorado midnight of `firstDeliveredOn`, `billing_mode` named explicitly as
`flexible`, and `cancel_at` as before. Evidence (Stripe test mode, 2026-10-05 UTC, probe objects cancelled):
delivered 2026-08-01 and set up 2026-10-05 produced one invoice with three whole-month lines ($100 each, no
partial amounts) and a current period 2026-10-01 to 2026-11-01; delivered 2026-10-01 with a 12-month
`cancel_at` produced one $100 line and Stripe accepted the end date. Reasons for the shape: (1) the start is
derived from the delivery date only, never from "today", so a retry on a later day sends the identical request
(Stripe rejects a reused idempotency key with changed parameters); (2) no `billing_cycle_anchor` is sent, so
there is no time-based proration and no daylight-saving drift between a hand-built anchor and Stripe's UTC clock;
(3) naming flexible mode means a change in the Stripe account default cannot change what customers pay.
Known and accepted: Stripe keeps its monthly date at the same UTC clock time, so in winter the renewal instant is
11 pm Colorado time the evening before the delivery day-of-month. A customer set up months late is charged all the
months since delivery on the first invoice; there is no cap (the customer had the item). Existing subscriptions
are not changed.

### 2026-10-03 (later) — One stack per batch, clustered PRs, CI budget lifted, owner-configurable by default

Chris replaced the earlier PR-size rules: each batch is one stack of
reasonably sized, coherent PRs (not single-item PRs, not one giant PR); CI
time/cost is no longer a constraint; agents should use the web for current
practice; and anything a business might change must be an owner-editable
setting. Model switches are never done by the agent: it hands Chris a prompt
for a separate chat instead. `gh stack` could not be installed in the agent
sandbox (403 on the extension download), so stacks are chained by hand there.
Reason: fewer, better-checked PRs with real review, and a system Chris can
run himself. Recorded in `AGENTS.md`.

### 2026-10-03 — Stacked PRs and smaller chunks, instead of one PR per batch

Chris asked (2026-10-03) for manageable chunks of work rather than one large PR
per batch, while keeping CI cost down, and for each PR to be built on top of the
previous one so work does not wait on merges. This supersedes the "one
substantial PR per batch" rule in `AGENTS.md` for Batch B onward. Cost control
stays: verify locally and push once per PR, docs-only PRs skip CI, and the
5-minute CI budget is unchanged. A stacked branch is created from its
predecessor and retargeted to `main` when the predecessor merges.

### 2026-10-03 — Tax rate precision: milli-percent helpers first, storage move later

Owner decision IN-17 requires rates exact to 0.001 percentage point (7.375%).
`docs/designs/BATCH-B.md` D12 predates it and kept tenths of a percent. The new
helpers in `src/domains/billing/tax.ts` use thousandths of a percent and convert
the existing tenths values exactly. Moving the stored rate (an additive
migration, the settings screen, the agreement snapshot and Stripe tax-rate
creation) is a separate, later chunk because it touches money display and
Stripe; nothing is half-migrated in the meantime.

### 2026-10-03 — Local testing: cheap checks only; CI runs the full suite

CI on the public repo is free and finishes in about 3 minutes, while setting up
a throwaway Postgres and running the whole suite locally costs the agent far
more effort than one CI round trip. Chris left the choice to the agent (he pays
for agent usage). Decision: run typecheck, lint and the tests touching the
change before each push; rely on CI for the full unit suite and browser specs;
go local only for migrations/SQL, unexplained failures, or a spec being
iterated on. On a CI failure, read the full job logs, fix everything, push
once. Revisit if CI failures after pushing become frequent.

### 2026-10-03 — Tax rate storage moved to thousandths of a percent (completes IN-17)

Added `taxRateMilliPercent` to `BusinessSettings` and `RentalAgreement` (additive
migration; existing values multiplied by 100, proven on a scratch database:
73 became 7300). The old `taxRatePermille` columns stay so nothing is dropped. Because
production runs migrations before the new app takes over, a second migration
(`20261003190000_tax_rate_columns_stay_in_step`) adds a database trigger that keeps
the two columns in step in both directions, so the old app saving a rate mid-deploy
(or a rollback) can never leave tax at zero (review finding on #152). A later cleanup
migration removes the old columns and the trigger together. Settings, the rental
builder, the public pricing page and Stripe tax-rate creation use the exact
value; new agreements start with the owner's rate once it is CPA-confirmed.
Stripe's rate list is read page by page so an existing rate is reused rather
than duplicated.

### 2026-10-03 — Reports and statements read the ledger (WU-B11)

Cash reports now come from receipts, not from per-invoice payment allocations,
so one check is one row and overpayments are counted. A refund kept as account
credit is not treated as cash returned. "This month" in revenue reporting is the
Colorado month, replacing UTC (the old UTC wording was a documented simplification
that contradicted the business-time-zone rule). Statement balances count only
invoices actually owed; a voided, draft or written-off invoice no longer inflates
"balance owed". Added an `ADJUSTMENT` group to the line categories because
invoice lines of that kind exist and the design's list had none for them.

### 2026-10-03 — Fixed terms start at delivery; policy values are entered in the app

Chris answered IN-20: a 6- or 12-month term starts at delivery (when billing
starts). Before this, nothing set `RentalAgreement.endDate` for a fixed term, so
the Stripe `cancel_at` from WU-B4 never took effect. `startRecurringBillingForAgreement`
now saves the end date under its row lock the first time billing is attempted
after delivery and never overwrites it, so a retry sends Stripe the same stop
date. Chris also answered IN-19's "where do these values live": they are entered
by the owner in Settings → Ending and renewing rentals (no values in code), with
blank meaning "not decided yet". The auto-renew terms version is generated from
the wording and notice days rather than typed, so a wording change cannot
silently reuse an old version. The values themselves are still for Chris to enter.

### 2026-10-03 — Retire the first decisions log and start a fresh current log

Chris requested that the oversized original `docs/DECISIONS.md` stop being part
of routine working context. It is retired using the same archive convention as
the other historical working documents: a top-level **RETIRED DOCUMENT —
reference only** warning at `docs/archive/DECISIONS-before-2026-10-03.md`, with
the complete original history preserved unchanged behind that index.

Going forward, new decisions are recorded here. Historical context is pulled
from the archive only when a concrete question requires it.

### 2026-10-03 — Code-review fixes ride the next planned PR

Chris decided that review comments are fixed inside the next planned PR rather
than in their own PRs or extra pushes, because every push costs a CI run. Each
finding still gets a recorded disposition and a regression test. Only a
security or money-correctness hole already on `main` is fixed immediately.

### 2026-10-03 — Agreements keep their own terms; policy changes need 30 days' notice

Chris decided: fixed-term leases are locked to the ending/renewal terms they
signed; changing the system-wide terms must not affect them. Month-to-month
agreements follow the system-wide terms, effective 30 days after the change,
with every customer told in writing (current leases unaffected, month-to-month
affected). Terms can also be customized per customer at sign-up/setup/estimate.
Consequence: early-ending quotes read the agreement's saved terms, not the live
settings. Sending the notice is live customer email and needs Chris's approval
before it is turned on.

### 2026-10-03 — CI is built to cost minutes, not to be fast

GitHub Actions minutes ran out on day 3 of the month: ~190 runs since Oct 1
(43 cancelled mid-run, still billed) at ~22 billed minutes per full run (five
working jobs, three of them repeating install + build for the browser tests).
Chris asked for a drastic efficiency improvement. Changes: CI runs when a PR is
opened or marked ready, not on every push (re-run by hand once after local
verification); draft PRs run nothing; type-check, lint and the unit suite share
one job; the browser suite runs on one runner, only when the change can affect
a browser, and nightly on `main`; a push to `main` runs the cheap checks only;
the failure-only Playwright report is kept 3 days. This supersedes the
2026-10-02 "5-minute wall-clock" goal, which was achieved by spending more
minutes. Accepted trade-off: a logic-only change that breaks a screen is caught
by the nightly run, not before merge. Not done: making the repo public (free
Actions, but exposes the code).

### 2026-10-03 — Repository made public; CI rebuilt for speed and secret scanning

Chris made the repository public (the code is a customized version of existing
things, nothing in it needs to be private), which makes standard Actions minutes
free. This supersedes the cost-saving CI of the same day: CI now runs on every
push, all checks in parallel (secret scan, type-check + lint, unit tests in 3
shards, browser tests in 4 shards), with `permissions: contents: read` and no
secrets. Quality is unchanged or better: same checks, plus `scripts/check-secrets.mjs`
and gitleaks over the whole git history on every run, including docs-only
changes. Real production Neon/Vercel identifiers found in old docs and one test
were replaced with placeholders; they remain in git history (identifiers only, no
passwords or keys), so Chris was advised to optionally rotate the production
database password. The 1-to-2-minute target was not promised for browser tests:
a production build plus browser install is a fixed cost of about two minutes per
runner. Chris must enable GitHub secret scanning/push protection and the fork
pull-request approval setting himself (agents cannot reach those settings).


### 2026-10-03 — Payments that arrive after a write-off are held, not credited (IN-23, review on #154)

First version turned such a payment into spendable account credit. Codex pointed
out (rightly) that this chose the money policy before Chris had, and that a later
Stripe refund of that charge could not find the payment. Now the payment is a
receipt plus a `held` payment row: recorded as cash received, applied to nothing,
not spendable, visible to the owner, and refundable through the normal refund
event. Resolving a held payment waits on IN-23.

## 2026-10-03 — IN-19: recommended starting terms, still fully owner-editable
Chris asked for common-practice defaults that the owner (and appropriate staff) can change. Decision: a one-time migration (`20261003200000_recommended_terms_starting_values`) writes the starting values only when all nine policy settings are empty, so nothing the owner already typed is ever overwritten. Values: $50 flat or 25% of rent still owed (larger of the two), capped at $200; 30 days notice; unused prepaid time refunded; 30-day renewal reminder (Colorado C.R.S. 6-1-732 requires 25–40); plain-English wording that repeats no changeable number. Editing stays with OWNER and ADMIN (existing `requireRole`); STAFF cannot. The Settings form has "Restore recommended starting terms" (fills the form; nothing saves until the owner presses save). Agreements already sent keep their frozen terms. The same values live in `src/domains/settings/recommended-terms.ts`; an integration test proves the migration and the app agree. A Colorado attorney should read the wording.

## 2026-10-03 — IN-22: renewals signed ahead are "scheduled", not active
Best practice for contracts that begin in the future is a separate "booked/scheduled" state: counted as backlog (contracted future revenue), not as in-force rentals or current revenue, and the equipment stays committed to the rental that is still running. Decision: add `RentalAgreementStatus.SCHEDULED` (additive migration `20261003210000`). Signing a renewal sets it (never ACTIVE); a nightly job (and a call right after signing when the date has already arrived) runs `startRenewalInTx`, which in one transaction (customer locked first, then agreements) moves appliance assignments (matched to the renewal's lines by label and price), the Stripe subscription id, next billing date, billing-start date and deposit to the renewal, ends the old agreement (end date stays the term end), and activates the renewal; nothing is sent for pickup and no Stripe call is made. Renewal signing no longer opens a new payment-setup checkout. Existing `ACTIVE` filters need no change and correctly exclude SCHEDULED. Ending or cancelling the old rental while a renewal waits is refused. Stuck renewals raise `RENEWAL_NOT_STARTED`. Not decided here (still open): renewals at a different price (the subscription would need a price change; Batch D renewal screens) and billing/customer-facing display of a scheduled renewal in the portal.

### 2026-10-03 addendum to IN-22 (from Codex review of the scheduled-renewals PR)
A fixed-term rental's Stripe subscription ends itself on the last day of the term (`cancel_at`), so merely moving the subscription id to the renewal at the start date would hand it an already-cancelled subscription. Decision: when the renewal is signed (while the subscription is still live) its end date is moved to the renewal's end date (removed for month-to-month) through a durable provider operation `SUBSCRIPTION_UPDATE` (`src/domains/billing/subscription-term.ts`); cancelling a waiting renewal puts the old end date back. The target is always derived from the agreements' current state, and the billing reconciliation pass retries a failed or unknown change by reading Stripe. The hand-over refuses to run (reason `BILLING_NOT_READY`, shown in Today if it stays stuck) until Stripe has confirmed the change. The renewal's `billingStartedAt` is its own start date (so revenue history never double-counts the overlap), its `endDate` is stored when it is signed, and a renewal whose lines do not match the old lines one-to-one is refused.

## 2026-10-03 — IN-23: held payments are settled one at a time, with a recommendation
Chris asked for plain-language options and a recommendation. Decision: a screen (Billing → Held payments, owner and admin only) shows each held payment with three choices and highlights one. Rule for the highlight (`recommendHeldPaymentOption`): invoice written off and still owing → mark paid (reverses the write-off; the customer did owe it and it was collected); invoice voided → refund to the card; credit is offered every time but recommended only when a refund is impossible (the payment did not come through Stripe) and never as the default when the customer owed the money. Marking paid applies at most what was still owed and turns any excess into credit. Refund reuses the existing durable refund flow (provider operation, reconciliation recovery) and records a Refund on the closed invoice, so the Stripe "refunded" notice is not recorded twice. Outcomes are payment statuses `succeeded`, `held_to_credit`, `held_refunded`. All three run under the customer ledger lock, so two decisions at once settle it only once.

## 2026-10-03 — Auto-renew and early-ending execution
Auto-renew: a nightly pass queues a **month-to-month** renewal (state "signed, starts later") for each active fixed-term rental whose customer agreed to auto-renew and still has it on, once the reminder window of THAT agreement's locked terms opens (term end minus its notice days; no new setting). The renewal is marked `createdByAutoRenew` (additive column, migration `20261003231000`), copies lines and prices like a hand-made renewal (shared `renewal-data.ts`), and Stripe's end date is cleared through the existing `SUBSCRIPTION_UPDATE` flow. Turning auto-renew off, or asking to end early, cancels only these automatic renewals; a renewal someone signed by hand is never cancelled by it, and a request to end early is refused while one is waiting. An automatic renewal also refuses to start if consent was withdrawn (`AUTO_RENEW_WITHDRAWN`), so a failed cancel cannot bill a customer who opted out. No email, no charge.
Early ending: when the ending is requested, Stripe's end date is set to one second before the agreed ending date (the anniversary), so Stripe never bills one more month (`subscription-termination-<id>` operation, retried by reconciliation; giving an old term back never undoes it). The nightly pass on the agreed date invoices the fee once (OPEN invoice, new line kind `EARLY_TERMINATION_FEE`, grouped with fees, no tax for now, due on the ending date, never auto-charged) and ends the rental through the normal ending path with the last day as its end date and no staff actor. Rentals paid in advance are never ended automatically (unused-month settlement needs the owner); they and any stuck ending raise the `EARLY_ENDING_NOT_DONE` item in "Needs your attention". The route `/api/cron/start-renewals` now runs the whole nightly rental pass in that order: auto-renewals, early endings, renewal starts.

## 2026-10-03 — IN-21 (renewal reminder part): notices are saved, honest about delivery, and gate the renewal
Colorado's automatic-renewal law asks for a reminder 25 to 40 days before an automatic renewal, so an automatic renewal must never start without one. New table `CustomerNotice` (migration `20261003240000`, in the backup list): the notice text is saved exactly as written; status PENDING / SENT / NOT_NEEDED; `sentVia` says EMAIL or "HAND: <how>". The reminder is created in the same transaction as the automatic renewal (it uses the renewal wording the customer's own agreement was signed with, plus dates and price), so there is never a renewal without its reminder. A nightly step emails waiting notices through the existing email wrapper; with live customer email OFF (Chris's approval needed; unchanged) nothing is sent and the notice stays PENDING, shown in "Needs your attention" and at Desk → Notices, where the owner/admin can mark it delivered by hand (who and when saved). An automatic renewal refuses to start (`NOTICE_NOT_SENT`) until its reminder is SENT. Turning auto-renew off withdraws a waiting reminder. The reminder goes out when the window opens (the agreement's notice days, recommended 30), inside the legal 25-40 day range. Still open: the 30-day change notice for month-to-month customers (needs Chris's answer on which rules apply to them, IN-21), built on the same notice table.

### 2026-10-03 addendum to IN-21 (Codex review of the notices PR) and the owner email switch
Chris asked for a dashboard switch for live customer email. Built: `BusinessSettings.customerEmailEnabled` (migration `20261003250000`, starts OFF), Desk → Settings → Notifications, OWNER only (re-checked inside the transaction, every change in the audit log), with the plain-English explanation on screen. Every email addressed to a customer now goes through `sendCustomerEmail` (`src/lib/customer-email.ts`): renewal reminders, payment heads-up, estimates and follow-ups, referral credits. Staff alerts, sign-in/password email and the launch list (its own controls) are unchanged. Previews never send regardless. Also from the review: the nightly job claims a notice (PENDING→SENDING) before emailing so the job and an owner's "mark delivered" cannot both deliver it (a stale claim after 15 minutes is retried); a hand-delivered notice records the real delivery date the owner gives; an automatic renewal only starts if its reminder was delivered 25–40 days before the renewal (otherwise `NOTICE_OUT_OF_WINDOW`, shown in "Needs your attention"); cancelling an automatic renewal withdraws its reminder in the same transaction; the auto-renew notice-days setting now only accepts 25–40 (Colorado's window).

### 2026-10-03 addendum to IN-21 (Copilot review of the notices PR)
- The 25-to-40-day window is counted in Colorado calendar days (not 24-hour blocks), for both when the nightly job queues the renewal and when a delivery is checked.
- For an automatic renewal, billing's end date is extended only after the reminder was delivered in the window. The nightly job (and the owner marking a notice delivered) releases it.
- The owner can record the real delivery date when marking a notice delivered by hand.
- Turning auto-renew off withdraws only a waiting reminder, never one being sent; turning it back on brings the same reminder back.
- A customer can turn off automatic renewal from "My rentals" (Colorado expects an easy online cancel).
- With customer email off, an estimate is still marked sent but the owner is told to share the link; estimate follow-ups are not marked as sent.
- A written prompt for a stronger-model review of these rules is in `docs/prompts/REVIEW-RENEWAL-NOTICES.md` (optional, owner's choice).

### 2026-10-03 addendum: second Copilot round and the independent review of PR #161
- A reminder is never emailed once it can no longer be delivered 25 to 40 days before the renewal; it stays on the owner's Notices list.
- An interrupted email send is never retried by itself (the provider may already have sent it): the owner sees "may already have been sent" and records the real delivery date by hand.
- A saved opt-out or early-ending request blocks any billing extension at once, before the renewal's cancellation has run. Notices that keep failing go to the back of the line.
- An independent review (`docs/reviews/2026-10-03-pr161-independent-review.md`) found larger gaps that need a design, not a patch: overlapping Stripe updates (R1), a lost billing-stop restoration after a crash (R2), no customer cancel after the first renewal (R3), annual reminders (R4), uncertain-send recovery (R6), manual-delivery evidence (D2). Automatic renewal is held by a new owner-only master switch, "Automatic renewals", OFF by default (blank wording settings were NOT a real off switch: a migration fills in recommended starting wording). It stays off until `docs/archive/prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md` has been run and built. Recorded as a blocker in `docs/GO-LIVE-CHECKLIST.md`.
- Email results now say what happened (`NOT_ATTEMPTED`, `REJECTED`, `UNKNOWN`). An unknown outcome or a failed "sent" save leaves a notice as "may already have been sent" for the owner; it is never resent by itself. A reminder that missed its 25-40 day deadline shows a red "Deadline missed" warning on Notices and says a late delivery will not let the renewal start.

## 2026-10-03 — Pickup and delivery billing rules (IN-24 / IN-26 / IN-27), built from Chris's own spec

Chris gave three rules directly (late return charged per day per item; an
item missing from the first delivery still billed with the whole agreement and
credited per day on the next bill once it arrives; the pickup day is never
charged), each as an owner setting with a stated default. There was no
approved Batch C design for them yet (the drift-check PR had just written the
prompt for one), so this is an owner-directed exception to "implement only
from an approved design", kept to the rules as stated and no further.

**Corrected the same day.** The first version of PR #165 misread rule 2 as an
"early return" credit (an item returned while the agreement continues). Chris
never asked for that; it was removed in the same PR and replaced with the
late-delivery credit he actually described. The one setting that had shipped
under the early-return name moved to `lateDeliveryProrationBasis` by a new
migration; the old column is a dead leftover.

Decisions made while building, and why:

- **Late-return charges are an ordinary OPEN invoice, not a Stripe charge.**
  The agreement has ended (or is about to) and its subscription is cancelled
  by then, so there is no "next" recurring bill; the same pattern the
  early-ending fee uses (visible, adjustable, never auto-charged) keeps the
  company-caused waiver (IN-24, not built yet) possible by hand. The invoice
  carries the agreement's own tax rate because the charge is rent.
- **Late vs on time is decided by the dates, never by the agreement's
  status.** A pickup after the end date is a late return even while the
  agreement is still marked ACTIVE (the nightly job may not have ended it
  yet).
- **The day a job's work happened is a fact staff record** (`Job.performedOn`,
  defaulting to the day they complete it), else the scheduled date — never
  the moment the status button was pressed, which can be days later.
- **A missing item is a record, not a guess.** Staff tick what was not on the
  truck when they complete the delivery; each becomes a `PendingDelivery`
  that stays on Today until a later delivery job brings it. Billing for the
  whole agreement starts from the first visit exactly as before (the
  subscription already covered every line).
- **Late-delivery credits go to Stripe as customer-balance credit**, the
  proven path referral rewards already use (durable provider operation,
  reconciled on failure), so the credit really comes off the next charge.
  The mirrored invoice shows the applied balance as labeled lines, oldest
  first, only for credits of this source type, part by part
  (`CustomerCredit.shownCents`, `shownOnInvoiceId`); credits from before the
  rule existed are marked fully shown by the migration so they are never
  relabeled.
- **Daily amounts are rounded once on the total**, never per day, so ten days
  of a $30 item is $10.00 and three days of a $35 item is $3.50, not $3.51.
- **A set's price is split evenly per appliance** (one line, two machines):
  there is no per-appliance price to use instead; documented on the screen.
- **A credit never exceeds what was billed for the item**: its monthly share
  × the billing periods that have started.
- **No credit for prepaid-in-full rentals or rentals whose billing never
  started**: the first needs the owner's eyes (same as early endings), the
  second has nothing to credit against. Both are recorded in the audit entry.
- **A never-delivered item taken off the agreement still has its line on the
  Stripe subscription.** Reducing a live subscription is a provider operation
  nobody has designed; the audit entry tells the owner to adjust it in Stripe.
  Roadmap item.
- **"Actual days in that month"** means the real length of the anniversary
  billing period that contains the original delivery date (28–31 days), the
  only exact reading for a rental billed on, say, the 8th.

### 2026-10-03 addendum: the subscription after a missing item (Chris's rule, not yet built)

Chris decided what happens to a customer's monthly Stripe subscription when an
item was missing from the first delivery: delivered late → the line stays (the
credit is the remedy); swapped for an alternate unit of the same type delivered
later → the line stays and the replacement takes the item's place; permanently
cancelled (never delivered, removed from the agreement) → the item comes off
the subscription from the next period, on top of the credit for everything
billed. Only the credit side exists today. The subscription change is written
up as a Batch C work unit (`docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`), with
the merge handled by Chris's coding agent, not by Claude in this session.

- **2026-10-03 (Claude, Batch C scheduling)** — Date-time boxes on job forms are Colorado clock time, converted by `businessDateTimeFromLocal`. Reason: `new Date("2026-10-05T09:00")` on the server used UTC, so a 9:00 visit showed as 3:00 or 2:00 in the Denver screens. A time that does not exist (spring-forward gap) is refused; in the repeated fall-back hour the first occurrence is used. Also: a no-show is "cancelled + `noShowAt`" and moves nothing else, as the literal spec says.

- **2026-10-04 (Claude, Batch C parts ledger)** — Ledger foreign keys restrict deletion, and the test database keeps its ledger fixtures instead of deleting them (append-only on purpose). Reason: history must survive; deleting a part or job that has stock history would erase it. Free-text-only receipts are made replay-safe through the audit log because they have no stock movement to carry the key.

- **2026-10-04 (Claude, Batch C custody and completion)** — Custody is its own table, not the assignment row, so it survives renewals and endings. A blank "date the work was done" means today in Colorado; backdating is allowed so billing counts from the real visit. Until swaps are built (P2-C), completing a swap closes the original's custody only if one is open, rather than failing. Reason: the spec's swap rules arrive in the next slice and old data has gaps; failing would block real work.

- **2026-10-04 (Claude, Batch C swaps and maintenance)** — A swap moves nothing until the visit is completed, and a swap that finds the old unit left behind still moves the agreement to the new unit and leaves a "Collect" task. Reason: the customer then has two units, the agreement and billing follow the unit that is working, and the task makes sure the old one comes back. A maintenance request only resolves when the repair visit is fully completed; any other outcome sends it back to reviewing so it cannot be forgotten.

- **2026-10-04 (Claude, Batch C inspection and job scope)** — The inspection result is worked out on the server from the answers (all checked is a pass), and a pass with an unchecked item needs an owner or admin and a written reason. The recorded inspection is locked by a database rule, and the test database switches that rule off only to clean up its own rows. Staff may work an unassigned job only while a new owner setting is on (starting value on, because that is how it worked before). Reason: the old screen trusted a pass/fail button, so the saved result could disagree with the checklist, and "staff may do anything on any job" was wider than a delivery driver needs. The plain appliance status change was also opened only by a page-level check, so it now checks the person inside the change.

- **2026-10-04 (Claude, Batch C missing item and subscription)** — A late or swapped-for item never changes the subscription: the whole line keeps billing and the customer is credited for the missing days. Only permanently cancelling an item lowers its line, from the next billing period, as a never-edited amendment, and the same transaction records the Stripe update so it cannot be lost. If Stripe cannot be reached the local decision stands, the screen says "Cancelled — Stripe update pending", and the reconciliation pass retries until Stripe matches. A different-type substitute is refused for staff and needs the owner to change the agreement ("Different type: ask the owner."). Cancelling the last item ends or cancels the agreement the normal way (cancelled if nothing was ever delivered).
- **2026-10-04 (Claude, Chris's instruction on PR #175)** — An item that never arrives is REFUNDED, not turned into account credit: its monthly share plus tax for each month billed, capped at what was actually paid, newest invoice first. Stripe-paid money goes back to the original card or bank through the same durable refund path as other invoice refunds. Cash, check and prepaid-in-advance money is recorded for the owner to pay back by hand, because Stripe can only refund to the original payment method. Chosen defaults (Chris said to use mine): tax included, only paid months refunded, late-delivery credits unchanged. Sources: Stripe refund docs (refunds can only go to the original payment method, failed refunds need another arrangement). Colorado's sales tax guide says nothing specific about refunding tax on a cancelled sale, so tax-included is the standard cautious default and worth confirming with an accountant.
- **2026-10-04 (Chris confirmed)** — For a never-delivered item, applicable sales tax IS refunded with the price, and months that were billed but never paid are NOT refunded. This matches what PR #175 built, so the earlier suggestion to confirm tax with an accountant is closed by the owner's answer.
- **2026-10-04 (Chris, redesign batch)** — The whole redesign (owner desk, public site, customer portal; desktop, phone and dark mode) is its own batch, **E2**, placed after Batch E and before Batch F. Reason: E migrates every screen to the Evergreen tokens and real dark theme, so restyling first would be done twice; F's end-to-end verification must run against the final look. It needs an approved design before any code.
- **2026-10-04 (Chris)** — Batch E2 re-uses the current appliance photos already in the app; no new photography. Reason: avoids a dependency on new photos before the redesign can be built.
- **2026-10-04 (Claude, Remediation R08)** — Stripe is read before the webhook transaction, never inside it. The one global advisory lock stays, because the ledger still has cross-customer rules, but it is now held only for local database work. Reason: a slow Stripe response used to hold the lock (and every other webhook) for as long as Stripe took. A fact found missing under the lock is fetched outside it and the event is replayed, so a race between the early check and the lock cannot record a half-applied event.
- **2026-10-04 (Claude, Remediation R09 and the estimate half of R11)** — An estimate's "valid until" date means good through the end of that Colorado day; it expires at the next Colorado midnight. Approving or asking for changes after that is refused, and the estimate is marked Expired in the same step (nothing else happens: no approval, no new customer from a lead, no email). The public page shows the same rule and the date in Colorado time. The date box on the new-estimate screen now accepts only a real calendar date (or blank); "2026-02-30" is rejected instead of being rolled over. Older estimates saved before this change were stored as midnight UTC, which is the previous evening in Colorado; those are read as the date that was typed. Reason: the old page said "valid until" but the approve button ignored it, so a customer could approve an out-of-date price.
- **2026-10-04 (Claude, Remediation R10)** — Sending an estimate is now one locked step: the estimate is marked Sent, with its send time saved, before any email is attempted, and only the click that wins that step emails. A second click at the same moment is told the estimate was already sent. The email carries a key made from the estimate and that saved send time, so a retry of the same send cannot email twice, while a deliberate re-send of a revised estimate gets a new key. If the email service says "rejected" or "unknown", a note is saved in the estimate's history for the owner and nothing is re-sent automatically (an unknown result may already have been delivered). Reason: two quick clicks used to email the customer twice.
- **2026-10-04 (Claude, Remediation R11 remainder)** — The appliance purchase date is read strictly: a real calendar date or blank, otherwise the screen says so and nothing is saved ("2026-02-30" no longer becomes March 2). It is stored as the start of that day in Colorado time and shown in Colorado time, so it can no longer slip to the previous evening. A purchase date means "on this day", so it uses the start of the day; a deadline such as an estimate's valid-until date uses the end of the day. Task due dates and a lead's desired start date keep their existing date-only convention, which shows and stores the same date, so they were left alone.
- **2026-10-04 (Claude, Remediation R12)** — Repair costs (parts and labor) are read strictly. A blank clears the cost; a plain amount like 125 or 125.50 is accepted; negatives, letters, more than two decimals and anything over $100,000 are refused with a message and nothing is changed. Before, a typo such as "abc" silently erased the saved cost, and "1.005" was quietly rounded. The same rule is checked again inside the saving step, so nothing else that calls it can store a negative or fractional-cent cost. The rule that a hand-typed parts cost is refused when parts were itemized from the parts list is unchanged and now has a real-database test.
- **2026-10-04 (Claude, Remediation R13)** — The five owner/admin inventory commands that were not yet fully guarded (add units, edit details, add photo, start a repair, retire) now each do everything in one database step: confirm the person is still an active owner or admin, lock and re-read the appliance, check the rules, make the change, and write the history entry. If any part fails, none of it is saved. Before, someone removed from the team a moment earlier could still finish one of these, and a failed history write could leave the change behind without a record. Manual status change and recording an inspection already worked this way. Staff keep only the job-scoped abilities from Batch C; no general staff path was reopened.
- **2026-10-04 (Claude, Remediation R14)** — Creating a purchase order is now one database step: confirm the person is an active owner or admin, lock the supplier and the parts on the order, check none are archived, save the order, and write the history entry. If any part fails, no order is left behind. Before, the supplier was checked first and the history written afterward, so archiving a supplier at the same instant could still produce an order on it, and a failed history write could leave an order with no record. The locks are always taken supplier first, then parts in a fixed order, so archiving and ordering cannot deadlock.
- **2026-10-04 (Claude, Remediation R15)** — When parts are used on a repair, the part is locked first and only then is its last known purchase cost looked up, and the lock is held until the usage is written. Before, the cost was looked up first, so a delivery recorded at the same instant could finish in between and the usage would be saved with the older, wrong cost. Now a delivery that finished first is the cost used, and a usage that finished first honestly uses the earlier cost. The movement history is still the only record of stock.
- **2026-10-04 (Claude, Remediation R16)** — Each "these items arrived" request on a purchase order now leaves a small permanent record of exactly what was submitted (the order, each line, how many, and the price or "unknown"). Sending the same request again (a double-click or a retry) changes nothing; sending the same request number with different numbers is refused with a message. Before, only items tied to a stocked part were compared, so a repeated request with a changed quantity on a free-text line (for example, a whole appliance or a bulk supply with no part record) could be treated as a harmless repeat. The record is saved in the same step as the receipt, so a receipt that fails leaves no record and can be retried. This adds one small table, included in the nightly backup; nothing existing is changed.
- **2026-10-04 (Claude, Remediation R17)** — The "Needs your attention" list on Today now reads each group (past-due invoices, overdue jobs, term-ended agreements, and so on) with a limit of 50 items, oldest first, ties broken by a fixed id order, instead of loading every matching record from history and sorting in memory. When a group has more than 50, the screen says so ("showing the 50 that have waited longest, N more not shown") using the real total. The overall order is unchanged: high priority first, then longest waiting. Two groups needed real database queries instead of memory work: "term ended" (the agreement's end date, or its start plus its term in calendar months, so a 31 January start with a one-month term ends 29 February, not 2 March) and "maintenance due" (latest completed maintenance visit, else purchase date, else the day the unit was added). The limit of 50 is a safety setting for speed, not a business rule, so it is a fixed constant rather than an owner setting.

## 2026-10-05 — Remaining work rewritten for lower-cost implementing models (Claude Opus 5.5)
Chris asked for every remaining piece of work to be written the way the D–F designs are (decisions made, exact schema,
function signatures, named tests, stop-and-ask), updated for what is now built, so Claude Sonnet 5.5 or ChatGPT Sol 5.6
can implement it. Done against `main` 47bd833: new `docs/designs/BATCH-B2.md` (renewal lifecycle R1–R7, D1, D2; IN-21
mechanism; C-09) and `docs/designs/BATCH-E2.md`; drift-checked rewrites of D, E and F. Key B2 decisions: one stored,
versioned billing-end answer per Stripe subscription, saved in the same transaction as the decision and applied by one
leased worker (newest version wins); returning equipment never changes billing by itself — only agreed endings do; a
month-to-month rental can be ended online with no fee at the first billing date after the notice days; month-to-month
terms are versioned and reach a customer 30 days after their notice is delivered; annual reminders follow
`continuousSince`; notices gain UNCERTAIN/MISSED/FAILED states with fenced evidence; a phone call is not a notice
delivery. Owner questions with built defaults: IN-29 to IN-32. B2 and E2 wait for Chris's approval.

## 2026-10-04 (late) — Chris's answers to IN-29 to IN-32, folded into the B2 and E2 designs
- **IN-29 early returns:** configurable, not one fixed rule. Owner settings for billing (continue to the agreed end, or
  stop at pickup), unused paid days (keep, credit, refund), the early-ending fee (the agreement's own terms, none, or a
  custom amount with a reason; fixed terms only), and whether the system asks each time or applies the defaults; a
  per-rental screen can change any of them before anything is charged or refunded. Recommended starting values keep
  today's approved behaviour (keep billing to the agreed end, keep unused days, agreed-terms fee, ask me). The dead
  column `earlyReturnProrationBasis` is read again for the day count. (`BATCH-B2.md` B2-19, WU-B2-9b.)
- **IN-30 missed reminders:** one "Fix a missed reminder" screen with every option (cancel the automatic renewal and
  optionally schedule pickup; send a new renewal to sign; move the renewal later with a fresh reminder — still needs a
  signature; record delivery another way; keep waiting with a reminder date; end the rental now). Nothing extends
  billing without a delivered reminder or a signature. (B2-18, WU-B2-5.)
- **IN-31:** deferred by Chris; stays documented and blocks turning on automatic renewals / live customer email.
- **IN-32 home page:** ivory in light mode, evergreen in dark mode, one dominant action in both — consistent with the
  brand kit's light and dark tokens, so no contrast exception and no extra preview step. (`BATCH-E2.md` E2-7.)

## 2026-10-05 — Batch B2 and Batch E2 designs approved
Chris: "I approve e2 and b2." `docs/designs/BATCH-B2.md` and `docs/designs/BATCH-E2.md` are approved for
implementation (including the IN-29/IN-30/IN-32 answers folded in the night before). Next batch to build: B2.

## 2026-10-05 — Batch B2 built (PRs #205–#207 and PR 4)
Built as designed. Deliberate differences are in `docs/designs/BATCH-B2.md` → Amendments. Early-return changes of an automatic decision are limited to "no refund, no credit, fee unpaid", and an automatic keep-billing decision is changed by first taking back the ending it recorded.

## 2026-10-06 — Tax, books and owner-control designs proposed (G, T, K, O)
Chris asked for a Colorado sales/use tax subsystem using the state's free lookup, a decision on Stripe Tax, an
accounting export system (QuickBooks and others), and designs a cheaper model can implement. Proposed (not approved):
`docs/designs/BATCH-G.md`, `BATCH-T.md`, `BATCH-K.md`, `BATCH-O.md`; summary `docs/plans/TAX-AND-BOOKS-OVERVIEW.md`.
Key recommendations and why: (1) the app calculates tax from Colorado's GIS lookup and owner/CPA-set rules, and Stripe
only collects through ordinary Tax Rates — Stripe Tax cannot know the short-term lease election (C.R.S. 39-26-713),
would disagree with the app's own invoices, and costs ~0.5% of taxed volume; (2) every tax policy starts "Not decided
yet" and blocks billing, replacing the decorative `taxRateConfirmed` gate; (3) books are a derived, append-only
double-entry journal, exported as daily summary journals so the accounting software never needs customer records (Xero
forbids manual journals to its Accounts Receivable; QuickBooks needs a customer name on A/R journal lines); direct
QuickBooks sync is a later phase. Research notes: Greeley is home-rule, self-collected, 4.11%, not a SUTS participant
(as listed 2026-10-06); public sources give 7.01% combined for Greeley vs the 7.375% in the owner's notes (IN-17).

## 2026-10-06 (later) — Documentation audit, master roadmap, Batch V proposed
Chris asked for the docs to be audited against the code, archived docs reviewed for intent, the remaining plans
reconciled into one roadmap a cheaper model can follow, and a true premium redesign that keeps the brand. Done:
`docs/MASTER-ROADMAP.md` (single ordered list; recommends splitting Batch F so its product-wide proof runs after G, T
and V — IN-41); `docs/designs/BATCH-V.md` + concept "Evergreen Signature" (keeps every kit colour, Manrope and radii;
the logo's 45° Split-R cut becomes the one signature shape; hairline ledgers replace card grids; marketing copy moves
into settings; hero address check against the owner's service area only — IN-42). Audit fixes are listed in
MASTER-ROADMAP section 6. Newly found in code: dark-mode success/error text at 2.0–2.7:1 contrast (added to Batch G as
D-G6). Archive review: the September "complete operating platform" brief and growth ideas are mostly built; the
remaining customer self-service and growth items are listed as Batch P candidates, not designed.

## 2026-10-06 (evening) — Designs G, T, V, K, O and the Batch F split approved
Chris, after reviewing the audit, the tax/books plan, the master roadmap and the Evergreen Signature concept: "I love
all of this! Update the repo!" Recorded as approval of `docs/designs/BATCH-G.md`, `BATCH-T.md`, `BATCH-V.md`,
`BATCH-K.md`, `BATCH-O.md` and the F split (IN-40, IN-41, IN-42). Order: F-part-1 → G → T → V → F-part-2 → launch →
K → O (`docs/MASTER-ROADMAP.md`). Still open and unchanged by this approval: the CPA/attorney tax answers (IN-17,
IN-33 … IN-39 — billing real customers stays blocked until they are entered), SUTS registration, live payment/email
activation, and Chris's acceptance of Batch V's before/after screenshots.

## 2026-10-06 (night) — Self-review of PR #264 (Codex and Copilot out of quota)
Chris asked for a self-review in place of the unavailable reviewers. Fixes made in the designs before merge:
(1) BATCH-T: `CREDIT` lines are account credit applied after tax (Stripe customer balance), so they are never taxed
and never lower taxable rent — the earlier "follows parent" rule would have raised a false Stripe-mismatch card on
every bill using a credit; whether late-delivery credits *should* lower taxable rent was added to IN-34. (2) BATCH-T:
local bills (late/early return, pickup) never block job completion — tax problems leave the bill DRAFT with a card and a
"Recalculate tax" button. (3) BATCH-T: a rate first learned from the GIS lookup returns its jurisdiction to review before
use. (4) BATCH-T: tax lines and use-tax rows get real foreign keys; Prisma upsert caveat noted. (5) BATCH-K: opening
balances at the books start date (D-K12); the Stripe clearing check compares both sides at the same cut-off; refund and
payout transaction handling made explicit. (6) BATCH-G: two-step-login enforcement exempts the setup page, auth API,
sign-out and password reset. (7) BATCH-O: approvals execute as the approving owner. Doc corrections: nightly
`start-renewals` job description, how Notices is reached, the 7.375% wording, and "books from any start date".

## 2026-10-06 (night) — PR size budget and CI rules for the remaining batches
Chris asked that agents not spend more time on CI than on implementation, and not take on more than they can finish.
Added: a numeric PR budget (`docs/PLAYBOOK.md` Step 3a — about 500 production lines, ~15 files, one migration, one risk
area, ≤2 expected CI runs, ≤2 merged PRs per session), CI rules for a moving codebase (Step 8 — is-it-mine check against
`main`, a 3-run CI budget, updating deliberately changed assertions in the same commit, stack refresh and migration
timestamp rules, change-proof tests), and an explicit PR list for F, G, T, V, K and O (`docs/MASTER-ROADMAP.md`
section 7, about 34 PRs) that supersedes the coarser PR groupings in the designs. Two predictable CI ripples are named
in advance: Batch T's billing gate needs tax-ready fixtures in the same PR; Batch G's two-step login needs the CI
login and saved browser sessions updated in the same PR.
Audit of these rules the same night (Chris: "audit them first"): fixed the stack-refresh rule (merge each PR's *base*
branch, not `main`, into upper PRs), counted only *red* CI runs against the budget, allowed splitting inside an
over-budget work unit at a complete-and-tested point, added the budget measurement commands, the local real-Postgres
run for schema/money/auth PRs before the first push, a no-idle rule with a 20-minute timebox for unavailable automated
reviewers, a "CI runs used" report with a split-smaller trigger, the WU-T0 row, the safe migration-rename rule, and
corrected the PR count to 33.

## 2026-10-06 — CI matches production Node; skipped tests fail CI; docs-only pushes skip Vercel builds

Chris asked whether the tests, Vercel builds and warnings could be improved without breaking anything. Findings and
decisions: (1) Vercel production runs Node 24.x but CI tested on Node 22 — CI now uses 24 so the tests run on what
customers get. (2) npm 12 (already npm's latest) blocks dependency install scripts not listed in `allowScripts`;
`@prisma/engines`' download of the migration engine is one of them, so a future Vercel npm upgrade could have broken
`prisma migrate deploy` in every build. The four reviewed packages are approved by name in `package.json`. (3) About 20
real-database test files and several browser specs skip themselves when their environment is missing; correct
locally, but in CI that would be a green run that tested nothing. CI now fails on any skip except the perf baseline
(runs in its own workflow). All 1,988 unit/integration tests and 170 browser tests already ran with zero unexpected skips, so
this guards the future rather than fixing a present gap. (5) A full local run exposed one timing-flaky test
(`tests/remediation-r2-webhook-evidence-integration.test.ts`): it probed a database lock that other test files also
take briefly. It now retries the probe for up to a second; the code under test is paused inside the probe, so if it
ever held the lock every retry would still fail (checked by holding the lock by hand: the test fails). (4) Docs-only pushes produced full Vercel builds; an ignored-build
step now skips them using CI's docs-only rule, building whenever unsure. Rejected: removing the TypeScript check from
`next build` (8 s; it is the only check between a deployment and CI finishing), and upgrading to ESLint 10 (our
accessibility lint plugin does not support it yet — `docs/ROADMAP.md`).

## 2026-10-07 — Sales tax filing: SUTS entry packet and filing calendar (Batch T Amendment A)

Chris asked that the system handle as much of filing as possible, and otherwise give him exactly what to type into
SUTS, with scheduling so he is always prompted on time. Decisions (`docs/designs/BATCH-T.md` section 11): each return
becomes an entry packet in SUTS's order with copy buttons and a plain checklist; a daily automation keeps a filing
calendar (monthly/quarterly/annual, Colorado weekend/holiday rule, license renewal) and prompts on Today and by
owner-only email until the return is marked filed; a calendar file is downloadable. Rejected for now: automatic filing
(SUTS XML filing is for certified software vendors) and generating SUTS's Excel upload file (account-specific template,
a new spreadsheet library and possible Department approval, for a return with only a handful of rows — revisit above
about 8 rows). Research corrections: Greeley is a SUTS participating city (code 030057, since 2023-08-01), correcting
the 2026-10-06 note above that it is not; the state vendor fee ended 2026-01-01 (HB25B-1005). Reminders count from the
plain due date, never the holiday-shifted one, so a holiday can never make a reminder late. New owner inputs: IN-43
(SUTS screen details after registration), IN-44 (CPA: how to report non-taxed amounts).
