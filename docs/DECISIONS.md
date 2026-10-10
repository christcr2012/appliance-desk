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

### 2026-10-08 — owner-requested K-CASH design (documentation review pending)

Chris requested current startup-bank/QBO research and robust envelopes/planned costs with advance domain/UI/tests
for Sol 5.6 light/medium. Proposed one operating account, Bluevine Standard first/Axos Basic alternative, QBO Free
only after actual import/matching/reconciliation proof. Appliance Desk retains customer detail, K journals are the
accounting source. Only confirmed cash funds envelopes; future receipts are estimates. Targets/occurrences never
post payments. CSV bank evidence avoids paid APIs. Nine groups after K-8 before M, no launch reorder; K opening/
export/tax/forecast/source-revision amendments in design section 9. IN-54/55 gate actual setup/policy. No account
application/spending/activation authorized; researched rates/software limits are dated, not coded constants.

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
`docs/archive/designs-completed/BATCH-B.md` D12 predates it and kept tenths of a percent. The new
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
- A written prompt for a stronger-model review of these rules is in `docs/archive/prompts/REVIEW-RENEWAL-NOTICES.md` (optional, owner's choice).

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
up as a Batch C work unit (`docs/archive/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`), with
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
can implement it. Done against `main` 47bd833: new `docs/archive/designs-completed/BATCH-B2.md` (renewal lifecycle R1–R7, D1, D2; IN-21
mechanism; C-09) and `docs/archive/designs-completed/BATCH-E2.md`; drift-checked rewrites of D, E and F. Key B2 decisions: one stored,
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
Chris: "I approve e2 and b2." `docs/archive/designs-completed/BATCH-B2.md` and `docs/archive/designs-completed/BATCH-E2.md` are approved for
implementation (including the IN-29/IN-30/IN-32 answers folded in the night before). Next batch to build: B2.

## 2026-10-05 — Batch B2 built (PRs #205–#207 and PR 4)
Built as designed. Deliberate differences are in `docs/archive/designs-completed/BATCH-B2.md` → Amendments. Early-return changes of an automatic decision are limited to "no refund, no credit, fee unpaid", and an automatic keep-billing decision is changed by first taking back the ending it recorded.

## 2026-10-06 — Tax, books and owner-control designs proposed (G, T, K, O)
Chris asked for a Colorado sales/use tax subsystem using the state's free lookup, a decision on Stripe Tax, an
accounting export system (QuickBooks and others), and designs a cheaper model can implement. Proposed (not approved):
`docs/archive/designs-completed/BATCH-G.md`, `BATCH-T.md`, `BATCH-K.md`, `BATCH-O.md`; summary `docs/plans/TAX-AND-BOOKS-OVERVIEW.md`.
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
all of this! Update the repo!" Recorded as approval of `docs/archive/designs-completed/BATCH-G.md`, `BATCH-T.md`, `BATCH-V.md`,
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
Same day, follow-up: an unfiled return is a computed Today task (exception categories `TAX_RETURN_DUE`,
`TAX_FILING_NOT_READY`, `TAX_LICENSE_RENEWAL`) rather than a stored task, so nothing but marking the return filed can
clear it; it opens a guided "File this return" page (11.11). Chosen over a `StaffTask` because a task can be ticked off
without the return actually being filed.
Review fixes the same day (Codex on PR #282): a change to a filed period is reported on an **amended return for that
period** (`TaxFilingAmendment`, 11.12), not netted into the next return — this also corrects the original D-T11; a
local service fee is shown only for on-time returns and never on amended additional tax; overdue starts only after the
holiday-shifted legal deadline; IN-43/IN-44 never block billing; SUTS Bulk XML eligibility is checked rather than ruled
out.
Also 2026-10-07 (Chris): the SUTS setup (IN-43) is entered and updated by the owner in the app (11.13), with a yearly
check task, instead of being sent to a developer. Amendment B (section 12) handles Colorado's Retail Delivery Fee:
status decided automatically from the lease election and the $500,000 small-business exemption, one record per
qualifying delivery at job completion, a separate untaxed customer line or "pay it myself", owner-entered July 1
amounts, and its own return on the shared filing calendar. Replaces stop-and-ask S-T4.
Also 2026-10-07 (Chris: "monitor the correct official places and update tax changes automatically"): Amendment C
(section 13). Rate changes from Colorado's official GIS lookup are applied automatically for already-reviewed areas
when seen on two different days, within a one-percentage-point limit and never backdated, with a Today notice and
undo; this reverses the 2026-10-06 rule that every GIS rate change needs manual review, by owner request, with the
switch starting ON. Law and rule changes are only watched (official page text hashes) and alerted, never applied.
Second Codex review (PR #282) fixes: retail delivery fee counted once per sale (not per trip); new-business 90-day
grace; undecided fee status blocks readiness and deliveries are kept as pending records; pending records allowed when
the year's amount is missing; RDF over-reporting is a credit on the current return (DR 1786) while added fees amend;
service-fee eligibility uses the payment date as well as the filing date.
Third Codex review fixes: free repair swaps never owe the retail delivery fee (Colorado's regulation; the owner
setting was removed); the fee amount and reporting period follow the sale's first-payment date (`saleOn`); an
undecided record resolves to PENDING_RATE when no amount exists; the rate/page watch route runs daily so the two-days
rule can be met; the page watch keeps the previous text so it can show what actually changed.
Also 2026-10-07 (Chris: "make sure this is all properly organized in the UI"): BATCH-T section 14 is the single screen
map — one "Sales tax" entry in the Money nav group (`/desk/sales-tax`, OWNER/ADMIN), six tabs (Overview, Returns, Areas
& addresses, What's taxed, Exemptions, Setup), one combined return/filing page, every tax Today item routed to its fixing
screen, a setup checklist identical to the billing blockers, and an on-screen glossary (no "jurisdiction", "packet",
"GIS" or "RDF" in the UI).
Fourth Codex review fixes: the delivery fee's sale date is the first rent charge (not the signing date); prepaid or
ended agreements get a standalone fee invoice so a collected fee is never only reported; a prior-period fee credit is
tied to the return that claims it so it cannot be reused; the page watch counts consecutive failures.

## 2026-10-07 — Batch S: one place for system problems, checked every morning by an AI agent

Chris asked for problems the system detects (failed automations, moved pages, …) to be recorded where an AI agent can
check them on a schedule and work out fixes. Decided (`docs/designs/BATCH-S.md`): one `SystemIssue` table with
fingerprint de-duplication and auto-resolve, strict redaction (no customer data or secrets), a System health page and a
Today "System" group for high issues, and a private `/api/ops/issues` endpoint (read + notes only) authenticated by an
owner-created, hashed, revocable key. The scheduled agent is a Claude Routine by default (it runs with the repository
attached and can open fix PRs, never merge unattended); any agent with scheduled tasks can use the same endpoint.
Rejected: writing issues to GitHub automatically (the repository is public), and giving the agent database access.
Fifth Codex review fixes (PR #282): new D-T14 — prepaid rent gets one local invoice at signing so its sales tax reaches
the returns (before, prepaid rent was collected outside the app and its tax would never be reported); retail delivery
fees are filed by delivery date while the amount follows the sale date; a collected fee is credited only after the
customer is refunded in full; rate versions found on or after their start date are pushed to Stripe immediately; only
the real tax decisions (and the delivery fee when it applies) block billing — filing setup never does.
Sixth Codex review fixes: prepaid rent and standalone delivery-fee invoices are manual-payment-only (the portal cannot
pay local invoices yet; roadmap); prepaid reporting follows the chosen basis and the fee's sale date is the recorded
payment date; Batch S issue details are built only from allowlisted typed fields (raw error text never leaves the app)
and people-written notes are redacted; stale-automation detection uses a per-rule expected interval.

## 2026-10-07 — Amendment D: purchase tax recorded at appliance intake; rental exemption per appliance; DR 0252 filing

Chris asked that the appliance entry form record whether sales tax was paid at purchase (and how much), log use tax for
private-party/untaxed purchases, prepare the state form, and drive rental tax from it. Research showed Colorado's
short-term lease exemption is conditioned on tax having been paid on *that* leased property (C.R.S. 39-26-713), so the
exemption is now decided per appliance (`Appliance.acquisitionTaxStatus`), refining the business-wide election. Use
tax goes on the Consumer Use Tax Return (DR 0252) via Revenue Online (recommended) or a filled official PDF / worksheet
for paper; city use tax (Greeley) is filed separately; the state account switches from annual to monthly automatically
past $300 a year. Intake is never blocked ("fill in later"), but an appliance with unknown purchase tax cannot be put on
a rental being signed or billed. New PR T-6d; `pdf-lib` is the one new library allowed, only for filling the official form.

## 2026-10-07 — Batch M: shop sales and what happens to retired appliances

Chris plans to resell small items (hoses, cords) and sometimes sell, scrap or dispose of retired appliances. Decided
(`docs/designs/BATCH-M.md`): sellable items reuse the parts stock ledger (one inventory, new `SALE` movement); resale
stock is bought tax-free and owes use tax only if used on a repair; a sale is a local invoice taxed by where the goods
go (shop pickup vs delivered) with the delivery fee rules applying to delivered taxable sales; a retired appliance
records one ending — sold (a taxed sale), scrapped (scrap trips split one payment across appliances by book value,
untaxed by default pending the CPA), thrown away (dump fee as an expense) or other — feeding revenue reports and Batch K
gain/loss. Card payment for local invoices becomes PR M-3. Placement after K by default, earlier if Chris sells before
launch (IN-47).

## 2026-10-07 — Batch M revised: selling after launch; retired appliances get a "what's next" plan, no per-item fees

Chris answered IN-47: no selling before launch, so Batch M stays after Batch K. He also described the retire process he
wants: retiring takes the unit out of rental (already true — RETIRED is final and never rentable), then he decides
what's next: sell it, strip it for parts (working parts back into parts stock, the rest scrapped or thrown away), scrap
it or throw it away; he does not want to track scrap or dump amounts per appliance. Decided (BATCH-M D-M4, replacing
the per-appliance "endings" and scrap trips split by book value): one changeable plan per retired appliance
(`RetiredAppliancePlan`), parts kept enter stock as `SALVAGE` movements at $0 cost (their cost is already in the
appliance), scrap checks are lump `ScrapPayment` income entries and dump fees are ordinary Batch K expenses — the money
still reaches the books for income tax, just not per item. A done plan writes off the remaining book value; a sale
records gain/loss. One Today follow-up after 30 days (owner setting). The CPA confirms lump scrap income and $0
salvaged parts (IN-46).

## 2026-10-07 — PR cards and stall-proof rules for medium-effort implementers

Chris implements mostly with Sol 5.6 at medium effort, which stalls on broad reads, broad searches and commands that
never finish. Decided: (1) AGENTS.md gains "Working without stalling" — read by section, narrow capped searches,
only self-terminating non-interactive commands, capped output, two strikes, a 10-read explore budget, commit per work
unit. (2) A readiness audit of BATCH-T sections 11–15, BATCH-S and BATCH-M found most of their PRs over budget and some
details open, so those sections carry an "Implementation gate" and each PR gets a self-contained card in
`docs/pr-cards/` (template in its README) that fits the budget, names every file/signature/test, lists exactly what to
read, and wins over the design where they differ. Same day, Codex's review of Batch M fixed: one built-in walk-in
customer (no login, never emailed), the delivery-fee record allows shop sales (`invoiceId`, nullable agreement/job),
resale tracked per purchase-order line with a fixed unit-order rule, no cost of goods sold (parts are expensed when
bought), and the retirement-day write-off stays Batch K's only disposal entry (plans post nothing).

## 2026-10-07 — Consultant briefing becomes business documents and proposed Batch BP

Owner request: architect, plan and design the supplied business_planning.docx into Appliance Desk; treat its
specific instructions as consultant suggestions; create a repository folder for business documents and improve them.

Created `docs/business/` with business plan, offer policy, operations, property-manager program, marketing drafts,
financial scenarios, legal/tax brief and source trace. Retained Robinson Appliance Rentals and existing domain
ownership. Added proposed `docs/designs/BATCH-BP.md`: versioned offers, permission/installation evidence, commercial
master documents, settled-rent commissions, narrow partner access and acquisition/cash-recovery reporting.

Rejected the consultant's blanket tax exemption, contractual reset shield, irrevocable entry and pure-profit/90-day
payback claims. Official sources and unresolved professional questions are recorded in the legal/tax brief.
Reuse IN-33/36 for acquisition-tax and continuous-use questions; added IN-48/49/50 for new business release choices.

No runtime change, live policy selection, document publication to customers, payment or provider activation occurred.
BP is proposed after existing K/M/O prerequisites; implementation needs design acceptance and bounded current-code
PR cards. Existing approved batches keep their order. T Amendment D's unpaid-use-tax exemption assumption remains
explicitly unresolved under IN-33 and must not be described as professionally approved by this new documentation.

## 2026-10-07 — Publication approved and configurable templates clarified

Chris explicitly approved publishing this business-document package to the public Appliance Desk repository. He
also clarified that lease terms and other proposed policies should be built as reusable configurable templates,
with editable options, rather than hard-coded contracts. BATCH-BP D-BP11 and the business template guide record
the editor, structured policy/text validation, inheritance, review/versioning and frozen customer-copy behavior.
Example 3/6/12-month terms are presets; an owner-added supported duration must work end to end without a code change.
This approval publishes planning documents; runtime implementation and live-business activation remain separate.

## 2026-10-07 — Expanded researched options with support-aware template controls

Chris invited additional options beyond the consultant briefing and current-source research. Added a 22-option
catalog with transparent existing/BP/later ownership and supported-setting choices. Provider FAQs inform service,
equipment, access, relocation and purchase-path examples; FTC guidance informs cost clarity. D-BP12 requires real
domain support and compatible structured/text policies before a choice can be published or signed. Future flows
are explicit roadmap work, not new unchecked toggles that pretend to function. Research URLs and limits are in
OPTIONS-CATALOG.md. Publication approval from the same turn continues to cover the updated business package.


## 2026-10-07 — Communications subsystem commissioned; COM proposed

Chris supplied a Twilio subsystem brief and asked it be inspiration reconciled with the actual application/roadmap.
BATCH-COM extends E rather than replacing delivery/history, keeps Twilio behind a telecom adapter, adds two-way
SMS/calls/consent/templates and distinct estimate/provider/invoice evidence, and connects METRICS/Today/S and future
K Expense. First corrections cover uncertain SMS replay, state/callback races, matching/suppression and production
activation/isolation. Proposed T → S → COM-L → V → F-part-2 → launch; COM-N after K/O; advanced features later.
New architecture/first three cards are ready for review, not recorded as accepted or activated. IN-03/09 reused;
IN-51/52/53 cover routing/media/budgets. No paid/provider/live changes in this documentation work.

## 2026-10-08 — Targeted publication preflight, without retrospective failure recreation

Owner requested immediate improvements to current implementation speed. Consolidate
selected static/unit/database/browser proof into one command, resolve conflicting
browser instructions, and share disposable role fixtures/setup across selected
checks. Failed commands, setup blockers and skipped browser results cannot claim
passing proof. Full exact-head CI/review/preview and owner activation gates stay.
Do not add workstreams or another report; measure the next three implementation
merges by completed scope and repair rounds before claiming a speed improvement.
Owner clarified that local database testing always uses Vercel Sandbox PostgreSQL;
reuse the existing project sandbox and disposable localhost fixtures. Do not
substitute a production or externally hosted database for this local proof.

## 2026-10-09 — Batch W: the app tells the owner what to do, when, and how much

Chris: the tax screens make no sense and the system doesn't tell him when to do things (example: an untaxed appliance
purchase never produces a step to pay use tax). A read-only audit confirmed five defects in merged T code (business tax
address could never be confirmed on screen, so purchase use tax never calculated; re-saving skipped recalculation; use
tax without a linked account never reached a return; a Today link to a missing page; the intake result discarded) and a
systemic gap: few journeys create a dated next step, Today items lack due dates/amounts/buttons, tax is split across two
areas, 26 menu entries, legal wording. Decided (BATCH-W): Today becomes the single To do list with due date, amount and
one button; every obligation-creating save shows "what happens next"; the app creates the next step at every turning
point (draft visits, IN-58); taxes in one place in plain words; first-time setup checklist; ~14 menu entries (IN-60); a
CI plain-words check. W-0A/W-0B fix the defects first. Also reconciled `docs/pr-cards/validate-index.py`, which already
failed on main because K-CASH units were added to the index without updating the pinned list.

## 2026-10-09 — Documentation reset 2 and an automatic pre-push gate

Chris asked that implementing models load only what still applies, and that local testing stop wasting time. Evidence:
of the last 100 CI runs on PRs, 24 failed and 39 were cancelled by newer pushes; 9 of the 24 failures would have been
caught in under 2 minutes by typecheck, lint or one test file, 4 repeated one broken browser login, 5 were axe or menu-count
failures on new screens, and several came from forgotten registries (backup policy, automation rules, route inventory,
foreign-key cleanup). Decided: (1) `.githooks/pre-push` + `npm run hooks:install` run `npm run check:quick` on every push
(secrets, migrations, shard check, typecheck, lint); `preflight --db/--browser` also runs `vitest related` for changed
source files inside its throwaway database (many importing tests need one, so the hook can't run them); never `--no-verify`. (2) PLAYBOOK Step 4 rewritten around the evidence, with a "registries that break CI"
table and one-push-per-CI-cycle rules. (3) AGENTS.md (510 → ~210 lines) and PLAYBOOK (574 → ~185) rewritten to the rules
that still apply; full snapshots in `docs/archive/reset-2026-10-09/`. (4) Completed batch designs (B, B2, C×3, D, E×2,
E2, G, R×3) and answered prompts moved to `docs/archive/`; T and S stay as references for current behavior; the
post-D reconciliation stays because F-part-2 depends on it. (5) STATUS trimmed to current facts (older entries in
`docs/archive/STATUS-LOG.md`); roadmap's completed T/S tables and the withdrawn delivery forecast removed (snapshot
archived). The rules themselves did not change.

## 2026-10-09 — Reconciliation checklists, Vercel Sandbox steps, retirement method

Chris: the first retirement (#138) worked better than the 2026-10-08 reset; local testing is Vercel Sandbox PostgreSQL
and must be documented; Sol needs a process to handle drift from PR to PR and per batch. Decided:
(1) `DRIFT-PROTOCOL.md` rewritten as checklist A (before each PR), B (after each merge: card, successor card, living
docs, queue) and C (batch close-out: acceptance proved, docs match code, retire, drift-check the next batch), plus the
retirement method modelled on #138 — move don't copy, RETIRED banner, update every reference including code comments,
archive README row, decision entry. (2) The 2026-10-09 retirements got #138-style banners and 20 code comments were
repointed to `docs/archive/designs-completed/`. The `reset-2026-10-09` snapshot copies stay (already bannered); future
rewrites rely on git history instead of copies. (3) PLAYBOOK 4b gives exact Vercel Sandbox steps: reuse the persistent
sandbox named in STATUS (resume, never one per card), worktree per card under `/vercel/`, run via `run_session_command`,
stop when done. STATUS gains an Environment section.

## 2026-10-09 — No more Copilot reviews

Chris cancelled the GitHub plan that provided Copilot code review. Copilot is removed from the review steps (AGENTS,
PLAYBOOK): never request, wait for or require it. Codex remains the automated reviewer; when Codex is out of quota the
existing waiver applies (inspect the diff yourself, write "automated review unavailable — waived").

## 2026-10-09 — Every PR updates the docs as if it had already merged

Chris: documentation drifts because the implementing agent updates docs after (or never), not in the PR whose change
they describe. Decided: checklist B moves inside the PR and is written for the post-merge world (card `MERGED (#n)`,
STATUS "merged / next", living docs). Unmerged, `main` is untouched; merged, the docs are already right. CI enforces the
minimum in the always-required secret-scan job (`scripts/check-docs-updated.mjs`, with tests): app changes (`src/`,
`prisma/`) require `docs/STATUS.md` plus a card or `work-index.json` change, and `docs/DATABASE.md` for schema changes;
a reasoned "Docs-update: not needed — …" line in the PR description is the escape hatch. Cost accepted: concurrent PRs
may conflict on STATUS (kept short; resolve by keeping both facts).


## 2026-10-09 — Tax filing on autopilot (Batch W Amendment A)

Chris asked for filings to be "handled automatically when applicable", using Colorado's GIS API, the SUTS XML upload and
Revenue Online. Decided: the app does everything up to "Submit and pay" (period close → dated To do incl. $0 returns →
reminders → confirmation capture → nightly unfiled check; W-9), a guided Revenue Online hand-off plus filled DR 0252 for
use tax (W-10), the live GIS client once the key and written API contract exist (W-11, IN-61), and an XML return file
once Colorado confirms an in-house filer may use it (W-12, IN-62, IN-44). Robot submission is not built (D-WA2): it would
store logins, sign and pay in Chris's name, and break silently on site changes; IN-63 records Chris's confirmation.
Sources: tax.colorado.gov/GIS-API, tax.colorado.gov/software-developers-sales-tax, DR 0800, DR 0252 instructions.

## 2026-10-09 — Every purchase-tax answer gets one next step (Batch W D-WA6/D-WA7)

Chris: the system must realize whether he paid tax to the seller and choose the next step, following filing deadlines.
The answer model, partial-tax difference and filing calendar already exist; W-2 adds one shared `nextPurchaseTaxStep`
so every screen shows the same dated step, and unanswered purchases escalate before the covering return closes.
Out-of-state seller tax is not calculated until the CPA answers IN-65 (saved as `LATER` + note, no schema change).
Receipt reading (W-13) is optional, gated on IN-64 because it sends receipts to an AI service.

## 2026-10-09 — Sandbox is a test runner; fix-and-retest loop; code before docs

From Sol's W-0A report: finished code was stuck in the Vercel Sandbox (its clone cannot push), a broad preflight with
four failures stopped progress, and documentation cleanup competed with publishing code. Rules added (PLAYBOOK 4b,
Step 5, SESSION-START): write code only in a checkout that can push; push the branch (no PR = no CI) and fetch it in
the sandbox; a rescue recipe (format-patch out of the sandbox); one failing file at a time, then the full check once;
docs-only moves on `main` need only a merge (keep both sides of STATUS conflicts); implementation PRs edit only the
docs checklist B names.

## 2026-10-09 — Sandbox publishing without a key: packed, fingerprinted transfers

Chris: "Solve GitHub publishing and file truncation as one infrastructure problem." Sol works in ChatGPT chat mode
with the Vercel Sandbox (which cannot push) and a GitHub chat tool (large files get cut off). Decided: move git commits,
not files — `scripts/sandbox-transfer.mjs pack` makes one git bundle, base64 in 40,000-character parts with sha256
fingerprints; the model uploads the parts to a `transfer/<id>` branch; `.github/workflows/sandbox-publish.yml` verifies,
rebuilds, pushes fast-forward to the `ai/*` target with the built-in token, dispatches CI and deletes the transfer
branch. No GitHub key needed. Chris made it permanent ("I would like this tool to be permanent"); a narrow sandbox push key installed through Sol remains an optional extra. Runbook: `docs/runbooks/SANDBOX-PUBLISH.md`.

## 2026-10-09 — Faster local checks from Sol's W-0A feedback

Sol reported: browser tests failed without a build, checks repeated between preflight / pre-push / CI, sandbox sessions
expired mid-run, pushes failed with HTTP 502, planning commits caused rebase conflicts, and new pages needed manual
route registration. Decided: (1) pass records per exact code fingerprint (`scripts/check-cache.mjs`) so the push gate
skips what preflight ran and interrupted runs resume; the production build is reused until a source file changes;
(2) `npm run test:db` / `npm run test:browser` one-command entry points, and a direct Playwright run without a build
stops with that instruction; (3) `npm run setup` sets HTTP/1.1, merge-based syncing and the hook; (4) sync with
`main` once at the PR boundary by merging, never rebasing; planning PRs don't edit an in-flight card
(DRIFT-PROTOCOL); (5) `scripts/check-route-inventory.mjs` in the quick gate prints the exact line for a new page.
CI stays the full exact-head gate (deliberately repeated; it is free and is the only merge evidence). The sandbox push
key Chris created has a 1-year expiry (renewal noted in STATUS).

## 2026-10-09 — Chromium in the Vercel Sandbox

W-0B's local browser step was blocked: the sandbox (Ubuntu 26.04) had no browser. Installed Playwright's Chromium and its
system libraries into the persistent sandbox and verified a launch; `npm run sandbox:browser` repeats it if a future
session lacks them. "Never `playwright install`" stays the rule for Claude Code cloud containers, which ship a browser.
Also found: the sandbox push key was on the running session only, not the saved sandbox settings (STATUS Environment).

## 2026-10-09 — Vercel build costs

Billing showed $9–17/day, almost all "Build CPU Minutes" (standard 4-core machine): 84 Vercel builds on Oct 9 (59 PR
previews, 23 production, 2 transfer branches), most for docs/tests/CI-only pushes. GitHub Actions already builds and
tests every PR head for free. Decided: Vercel's ignore step (`scripts/vercel-ignore-build.mjs`) now skips any branch,
PRs included, when nothing the site is built from changed; `transfer/**` never deploys; the ruleset's required
"Preview" deployment is removed (IN-67) so a skipped preview can't block a merge; `ci` remains the merge gate.

## 2026-10-09 — Vercel: new branches compare with main

Live check of the cost fix: docs-only PR #348 still built, because a new branch has no earlier Vercel deployment and
"uncertain" builds. The ignore step now fetches only the tip of `main` (shallow, public) for a new branch and compares
the trees; any site file that differs — including `main` changes the branch lacks — still builds; fetch or git
errors still build.

## 2026-10-09 — Keep Vercel near $20/month

Chris: keep the bill under $20/month, or as close as possible. Beyond skipping non-site builds: (1) `ai/**`,
`transfer/**`, `recovery/**` branches get no Vercel previews (CI builds and tests them free; `preview/<topic>` branches
opt in); (2) the live site is released once a day from a green `main` via `live` (`release.yml`, IN-68), so a day of
merges costs one build; (3) sandbox sessions stop after 30 minutes and heavy checks run in GitHub Actions
(workflow_dispatch). Expected: about one production build per day plus short sandbox sessions.

## 2026-10-09 — Release per batch, not daily

Chris (after seeing the bill: the $20 included credit used up and $64.37 on-demand this cycle, almost all builds):
"every batch if that's not going to be expensive". Per-batch is cheaper than daily, so `release.yml` runs when a
batch finishes (DRIFT-PROTOCOL C step 5), weekly as a safety net, and on demand. Switch to daily at launch.

## 2026-10-09 — Connected business (Batch W Amendment B, draft for IN-69)

Chris asked for the whole system to flow ("anything interconnected in reality should be interconnected in the system"),
for group purchases with each appliance's model and serial and audit-ready tax proof, for washer + dryer sets to be two
separate machines grouped for pricing, and for dollars-only money and ⓘ explanations everywhere. A read-only audit
found the gaps (no purchase record, serials dropped in group intake, "set" as an appliance type, ten flow dead ends,
three cents inputs, no help component) and a confirmed defect: failed automatic charges never reach To do (W-0C,
not gated). Designed: Purchase records, tax proof + audit pack, RentalPackage, connected Related/History pages, flow
rows D-WB4, portal flows, a plain-language kit, plus V and F-part-2 amendments. Restated: Colorado's GIS service only
looks up rates; it cannot file; the owner submits.

## 2026-10-09 — Amendment B approved; sets and out-of-service credits (IN-69, IN-70)

Chris approved the connected-business plan. Set rule: a machine returned early leaves the other at the single-machine
price (from the day after pickup, partial period credited) unless it is an exchange; a machine taken away without a
replacement is credited per day on the next bill until replaced, on any rental line (D-WB8, W-21). Credits reuse the
late-delivery per-day setting; the old "partial-return pricing" setting is dropped (Chris decided).

## 2026-10-09 — Record retention starts at 7 years, owner-configurable (IN-71)

Chris: 7 years after the appliance leaves the fleet, fully configurable, is fine for development and launch; IN-71
stays on the list of questions for the CPA. Not a launch blocker: no record can reach 7 years until 7 years after
launch, so a longer CPA answer only changes the setting.

## 2026-10-09 — W-16A/B and W-21 move ahead, built beside Sol's chain; W-16A/W-16B scope swap

Chris: "Let Sol do W-0C, you take W-16A/B and W-21." These three no longer wait for W-10; they touch packages, rental
lines and billing credits, not the communications or W-0C files, so they run alongside Sol's W-0C → COM-L chain (two
separate implementers, each with at most two unmerged PRs). Mechanical scope swap between W-16A and W-16B: retiring the
old "Washer + Dryer Set" type has to land in the same PR that puts the package on the website and quote form, or `main`
would drop the set from the public site between merges — so W-16A takes website + quote form + leads, and W-16B takes the
split-an-old-set-appliance To do and guided screen along with agreement and estimate package lines. New appliance types
stay owner-added data (Chris asked; confirmed: no types in code), and any type can be part of a set.

## 2026-10-09 — W-21 split into W-21A (repair, any line) and W-21B (a set machine that is done)

D-WB8 case 3 (taken for repair, no replacement) and case 1 (a machine of a set that is done) touch different code:
case 3 is visit completion plus customer credits; case 1 also changes a signed line's price and the Stripe subscription
item. They ship as two PRs so each money change is reviewed on its own. Implementation choices in W-21A: staff record
"taken without a replacement" on the visit (a swap whose new machine is not delivered, or a partial pickup); the owner
resolves it (replacement swap, same machine back, or close) — the credit is worked out only then, exactly as a late
delivery is, so it can never be more than was billed. The pickup day counts as without, the day a machine is back as with.

## 2026-10-09 — W-21B: prepaid-term discount after a set becomes single machines

D-WB8 says the machine that stays is charged "its normal single-machine price" but not what happens to a 6- or 12-month
prepay discount. Chosen (smallest surprise for the customer, never a price rise): the remaining machines keep this
agreement's term discount for that many machines, using the current discount setting (the agreement stored only the set
amount), and the new price is capped at the line's price today. Chris can change this; it is one function
(`singlePriceForRemaining`).

## 2026-10-09 — Known test interference fixed at the root (Chris: "can you also fix the tests known issues?")

Full local runs failed by chance in tax tests (filing reminders, tax overview, tax migration, purchase tax) and the
health-sweep test, each passing alone. Causes: (1) 25 real-database tests wrote records that exist once for the whole
database — the business-settings row or Colorado filing accounts, which reminders, the overview and the sweep read across
all rows — without being in the run-one-at-a-time project, so they saw each other's data; (2) the health sweep counted an
issue as recorded even when the write was skipped (its source row disappeared meanwhile). Fix: those tests joined
`SHARED_SETTINGS_TESTS`, `tests/shared-state-tests-listed.test.ts` keeps new ones from being missed, and
`sweepSystemIssues` counts only issues actually written (also makes the automation run report accurate). No test was
skipped, weakened or retried.

## 2026-10-09 — Plans reconciled after two lanes; remaining order restated

Chris: "update all documentation and plans to account for all the changes … possibly out of order. Then give me a prompt to
start Sol working through the updated plans in the new order." The sets and repair-credit work (W-16A/B, W-21A/B) is done
ahead of its original place; COM-L reached L6B (#364) with L7 in flight. Remaining order (Amendment B section 8): COM-L7 …
COM-L15 → W-1 → W-18 → W-14 → W-2 → W-15 → W-3 … W-10 → W-19 → W-17 → W-20 → V → F-part-2. One implementer resumes the
single chain; the second lane is closed unless Chris opens it again. IN-72 records the one default chosen in W-21B.
Test isolation (#367) also fixed a real robustness bug found by CI: To do crashed when an appliance was removed between
listing purchase-tax attention and explaining it; a removed appliance now counts as nothing pending.

## 2026-10-09 — Metricool public launch analytics

Owner-requested MKT-1 uses the vendor image protocol with a public-path and fixed campaign-value allowlist. Production configuration enables it; private URLs, form data, other query values and referrer paths are excluded. Honor Do Not Track and Global Privacy Control. Only public-layout document CSP permits the tracker image origin, including legal/city pages so client navigation retains it; the runtime still records only the six marketing routes. No roadmap queue or payment/contact-provider gates change. Privacy disclosure receives a new approval version; approval is never inferred or written by this integration.

MKT-1 engineering closed in #371: targeted tests and all exact-head CI/performance checks passed; review findings fixed. Production canonical origin was absent (live JSON-LD defaulted to localhost), now configured to the existing business domain without DNS/hosting changes. Owner authorized moving this to live using the green-main fast-forward release conditions. Metricool receipt and privacy-page review remain open. No COM/W queue change.

## 2026-10-09 — Public discovery without prices
Owner requested all website pricing hidden immediately during discovery. Reuse stored prelaunch mode across all public price surfaces; preserve billing data. Direct old pricing/city links go to the interest list.

## 2026-10-10 — No deposit on ordinary rentals; large orders pay a deposit or down payment (IN-73)

After the Greeley market research (local rental competitors rarely charge a deposit, and the customers most likely to rent have the
least cash), Chris decided: "We'll skip the deposit for typical rentals but we should probably require a deposit or down payment for
larger orders, such as property managers, apartments, etc." This matches today's default (`depositEnabled` off) and the existing
estimate deposit, which is collected when the customer approves online. It replaces the candidate "one month of rent" security in
`docs/business/OFFERS-AND-PRICING.md` for residential offers. Still open in IN-73: the large-order threshold, and whether it is a down
payment or a refundable deposit, and how much. The automatic rule is a ROADMAP item until those are answered. It will not be built on a guess.

## 2026-10-10 — Charges at signing and location contacts added to Batch W (W-22, W-23)

Chris approved adding two cards right after W-18. **W-22** charges at signing: a setup fee once per delivery address
(administrative part + consumables: dryer cord, vent hose, braided washer hoses), or per set when a large order goes to one
location and the customer installs (consumables part only when supplied; admin always), and a down payment (the first month at
signing, applied to the first bill) on orders of 5+ machines or from a business/property-manager customer. No deposit on ordinary
rentals. Starting values (admin $15, consumables $10 single / $25 set) are Claude's suggestion, which Chris accepted. Retail parts for a set cost more
(roughly $80), so the consumables amount assumes bulk buying and is a setting. Reason for the card: the existing fee settings were shown
on /pricing but never collected at signing, and were flat per order. **W-23** location contacts: unit label and tenant/on-site
contacts per delivery address, the client's permission topics, shown on that location's visits, messages only through the COM-L
gates. Contracts are in Amendment B sections 6.2–6.3; acceptance is in PLAN; the validator constant gained W-22/W-23. Open: whether
swaps/re-deliveries pay the setup fee (IN-74; default no).

## 2026-10-10 — Setup fee simplified: one $45 administrative fee per location (IN-74 revised)

Chris: customer installation should be very rare; the setup fee "should just remain an administrative fee and it is applied per
location … it is not attached to the consumables." Standard fee $45, covering in part the hookup items, the cost of running
Appliance Desk and other indirect costs. Every new rental gets new hookup items (hoses, cord, vent) for safety, longevity and
liability; the delivery visit records them. The owner may change the fee per quote/agreement with a recorded reason (bulk,
closing a sale, customer satisfaction). This replaces the admin + consumables split and the per-set customer-install rule in
Amendment B 6.2 (IN-77 superseded). The hookup items stay business equipment, which simplifies the tax question (IN-79: is the
separately stated fee taxable).
