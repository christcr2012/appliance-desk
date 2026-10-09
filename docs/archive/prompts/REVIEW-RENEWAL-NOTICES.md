# Prompt for a stronger model: review the renewal-reminder and auto-renew rules (PR #161)

Copy everything below the line into a new chat with a heavy-reasoning model that can read
the repository `christcr2012/appliance-desk` (branch `ai/claude/batch-b-renewal-notices`, PR #161, and the code
already on `main`). Ask it to **review and write findings only, not to change code**.

---

You are reviewing a part of a small-business app, Appliance Desk, for an appliance rental
company in Colorado. The owner is not a developer, so write your final summary in plain
English. Read `AGENTS.md`, `docs/BUSINESS-RULES.md` (renewal and notice sections), `docs/DECISIONS.md`
(entries IN-19 to IN-25), and `docs/GO-LIVE-CHECKLIST.md` first.

## What was built (written without an approved design, so it has not had a design review)

1. **Auto-renew.** A customer on a 6- or 12-month term can agree to renew automatically. About
   N days before the term ends (the owner's setting, which must be 25 to 40), the nightly job
   queues a month-to-month renewal (`src/domains/agreements/auto-renew.ts`).
2. **Renewal reminder.** Colorado law (C.R.S. 6-1-732) wants a reminder 25 to 40 days before
   an automatic renewal and an easy way to cancel. The reminder is saved as a `CustomerNotice`
   (`src/domains/notices/`). The renewal is **held** (it will not start, and billing is not
   extended) until the reminder is delivered inside that window
   (`checkReminderDelivered`, `renewal-start.ts`, `billing/subscription-term.ts`).
3. **Delivery paths.** Email (only when the owner's "send emails to customers" switch is on,
   `src/lib/customer-email.ts`), or the owner marks it delivered by hand with a date
   (`/desk/notices`).
4. **Customer cancel.** The customer can turn auto-renew off from their account
   (`src/app/account/rentals`), which withdraws the queued renewal and the waiting reminder.

## What to look for

Money, statuses, permissions, timing, and two things happening at once. Specifically:

- Can a customer ever be billed for a renewal they were not properly told about, or lose the
  ability to cancel? Trace every path that starts a renewal or moves the billing end date.
- Can billing stop early or run past the old term by mistake (the provider's end date vs. our
  records)? Think about retries, a crash between "claim" and "send", and the nightly job
  running twice or at the same moment as an owner action.
- Calendar-day counting in `America/Denver`, including the daylight-saving changes in March
  and November, and a term that ends on the last day of a month.
- Who is allowed to do what (customer, staff, admin, owner), and whether customer A can ever
  reach customer B's notice or agreement.
- Every state a notice can be in (PENDING, SENDING, SENT, NOT_NEEDED) and every move between
  them. Is any state a dead end? Can anything be sent twice or never?
- Switching customer email on later: do old waiting notices go out in a sensible way, or
  could a customer get a stale or out-of-window reminder?
- Gaps against the Colorado statute, as far as you can tell. State clearly what you are not
  sure about so a lawyer can check it.

## Output

1. A list of problems, most serious first. For each: where it is (file and function), what
   goes wrong in plain words with a concrete example, and a suggested fix.
2. A list of things that are fine and why, so we know what you actually checked.
3. Any rule that needs the owner's decision, written as a plain question.
4. Do not change code. Do not run anything against production.
