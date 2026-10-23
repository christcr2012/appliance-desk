# Open findings from the 2026-10-23 full-code review

Found by six read-only reviews (money, security, tax/scheduling, owner screens, public site/portal, performance).
Each item was read against the code; none is yet reproduced unless marked **fixed**. Work them in the order listed.
Remove a line when its fix merges (and name the PR in STATUS). Nothing here blocks building or merging other work.

## Money / books (needs a short accounting design decision before changing the ledger)
- **Invoice changed after posting** (late fee, waiver, retax): the first journal is never adjusted; void reverses the *mutated* lines. Post delta entries keyed by invoice version.
- `handleChargeRefunded` compares a per-charge total with a per-invoice sum (multi-charge invoices); uses `refunds.data[0]`.
- Legacy one-time signing charge rebuilds amounts from current agreement values instead of the PaymentIntent.
- `invoice.paid` webhook overwrites local late-fee totals; PAID with zero cash recorded when no cash event exists.
- Blind refund retry after 24 h can double-refund (idempotency key expiry).
- Late fees are never taxed even if configured taxable.
- Invoice-side refunds on a deposit invoice are not capped by the deposit (the deposit screen now refuses afterwards; **partly fixed**).
- **Fixed in this round:** refund-to-credit no longer posts a bank refund; late payment kept as credit no longer posts as goodwill expense; write-off only for open bills and re-checks the acting staff member; manual payment amounts reject more than two decimals; deposit refund refuses after a refund on its bill.

## Privacy / scheduling / tax
- Privacy deletion now refuses while a rental is in force or a bill is unpaid (fixed). Still open: it leaves phone numbers on texts, launch-list rows and the Stripe customer, and restoring a backup brings deleted details back.
- A FAILED daily job slot is now retried up to twice on later calls (fixed). Tax reminders now make up a missed day (3-day look-back; fixed). The auto-renew notice was already a 25-to-40-day window.
- Launch welcome sequence: a definite send failure stops that subscriber on purpose (a hard bounce must not be retried blindly, and a test locks this in). Owner screen should show who is stuck and offer "try again" — not built.
- Retax of waiver/discount lines fails under "pay on acquisition" tax election.
- Today page recomputes up to 12 filing packets and can write inside a page load.
- Upcoming-bill email: no longer sent for a rental ending before the bill date (fixed). Still open: the amount shown is the last invoice, not a computed next bill.
- Minor: appliance status transition gaps, month-end anniversary anchor drift, STOP matching on unusual phone formats, day-of-visit text doc drift.

## Security / hardening (lower)
- Better Auth's own login rate limit is per-server-instance memory; wire it to the shared database limiter.
- `/sign/[id]` and `/estimate/[id]` use database ids as the only secret; add a random access token with expiry.
- Privacy-request form: a per-email limit is in (fixed). Still open: the response time can still hint whether an email is a customer.
- `/scan/<asset>` reveals existence of an asset number; CSV guard turns negative numbers into text; confirm `BETTER_AUTH_URL` is set in production.

## Performance / health
- Public pages query Neon on every view (settings, content); cache with tags and revalidate on save.
- 24 read-path indexes added (fixed). Still open: many list queries have no `take`.
- Sentry has no flush in cron/webhook routes and no explicit capture calls; cron routes return 200 on failed passes (`maxDuration` now set — fixed).
- Add `@neondatabase/serverless` explicitly; retry-once on cold-start connection errors.

## Owner screens, public site, portal (wording and flow)
- See the reports summarized in STATUS: plain-English rewrites for Books/Budget/Money, consistent names (Quotes vs Estimates, Rentals vs Agreements, Schedule vs Jobs), a shared confirm dialog instead of browser pop-ups, phone/email help on every portal page, login/reset/sign pages styled like the rest, pre-launch honesty fixes, Spanish for the public site.
