# Open findings from the 2026-10-23 full-code review

Found by six read-only reviews (money, security, tax/scheduling, owner screens, public site/portal, performance).
Each item was read against the code; none is yet reproduced unless marked **fixed**. Work them in the order listed.
Remove a line when its fix merges (and name the PR in STATUS). Nothing here blocks building or merging other work.

## Money / books (needs a short accounting design decision before changing the ledger)
- **Deposit invoices never post** (`books/posting-rules.ts` `invoiceRecognition`): receivable = items + tax, but amount due includes the deposit, so any invoice with a deposit line throws and raises a books failure. The deposit cash also flows `UNAPPLIED` → `DEPOSITS_HELD` *and* gets applied to the invoice. Needs one agreed treatment (deposit excluded from the receivable, payment application limited to the non-deposit part) plus tests with a deposit line.
- **Negative tax lines** (late-return waiver) are rejected by `invoiceRecognition`, so such invoices cannot be posted or voided.
- **Invoice changed after posting** (late fee, waiver, retax): the first journal is never adjusted; void reverses the *mutated* lines. Post delta entries keyed by invoice version.
- **Refund journaled before Stripe confirms** (`books/post.ts` REFUND/DEPOSIT): a failed or unconfirmed refund still posts as paid; clearing-vs-bank account follows a timing-dependent field.
- **Held payment later marked paid after a write-off**: no reversal event for the write-off.
- `handleChargeRefunded` compares a per-charge total with a per-invoice sum (multi-charge invoices); uses `refunds.data[0]`.
- Legacy one-time signing charge rebuilds amounts from current agreement values instead of the PaymentIntent.
- `invoice.paid` webhook overwrites local late-fee totals; PAID with zero cash recorded when no cash event exists.
- Blind refund retry after 24 h can double-refund (idempotency key expiry).
- Late fees are never taxed even if configured taxable.
- Invoice-side refunds on a deposit invoice are not capped by the deposit (the deposit screen now refuses afterwards; **partly fixed**).
- **Fixed in this round:** refund-to-credit no longer posts a bank refund; late payment kept as credit no longer posts as goodwill expense; write-off only for open bills and re-checks the acting staff member; manual payment amounts reject more than two decimals; deposit refund refuses after a refund on its bill.

## Privacy / scheduling / tax
- Privacy deletion now refuses while a rental is in force or a bill is unpaid (fixed). Still open: it leaves phone numbers on texts, launch-list rows and the Stripe customer, and restoring a backup brings deleted details back.
- A FAILED daily job slot is now retried up to twice on later calls (fixed). Still open: exact-day reminder windows (auto-renew notice at 25 days, tax reminders) should be range-based, because the cron only fires once a day.
- Early-ending fee invoice is created OPEN with $0 tax, skipping the engine/CPA gate (the early-return path does it right).
- Launch welcome sequence: one failed send leaves the subscriber blocked forever.
- `closeAgreementInTx` changes appliance status without row locks.
- Retax of waiver/discount lines fails under "pay on acquisition" tax election.
- Today page recomputes up to 12 filing packets and can write inside a page load.
- Upcoming-bill email ignores a rental ending before the bill date and may show the wrong amount.
- Minor: appliance status transition gaps, month-end anniversary anchor drift, STOP matching on unusual phone formats, day-of-visit text doc drift.

## Security / hardening (lower)
- Better Auth's own login rate limit is per-server-instance memory; wire it to the shared database limiter.
- `/sign/[id]` and `/estimate/[id]` use database ids as the only secret; add a random access token with expiry.
- Privacy-request form reveals (by timing) whether an email is a customer; per-email throttle missing.
- `/scan/<asset>` reveals existence of an asset number; cron secret compared with `!==`; CSV guard turns negative numbers into text; confirm `BETTER_AUTH_URL` is set in production.

## Performance / health
- Public pages query Neon on every view (settings, content); cache with tags and revalidate on save.
- 24 read-path indexes added (fixed). Still open: many list queries have no `take`.
- Sentry has no flush in cron/webhook routes and no explicit capture calls; cron routes return 200 on failed passes (`maxDuration` now set — fixed).
- Add `@neondatabase/serverless` explicitly; retry-once on cold-start connection errors.

## Owner screens, public site, portal (wording and flow)
- See the reports summarized in STATUS: plain-English rewrites for Books/Budget/Money, consistent names (Quotes vs Estimates, Rentals vs Agreements, Schedule vs Jobs), a shared confirm dialog instead of browser pop-ups, phone/email help on every portal page, login/reset/sign pages styled like the rest, pre-launch honesty fixes, Spanish for the public site.
