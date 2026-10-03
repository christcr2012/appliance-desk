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
