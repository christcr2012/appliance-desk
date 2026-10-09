# Prompt for a stronger model: design the "billing stops at pickup" rule (IN-24)

Copy everything below the line into a new chat with a heavy-reasoning model that can read the
repository `christcr2012/appliance-desk` (branch `main` plus the open stack of pull requests). Ask it to
**write a design amendment only, not code**. The owner is not a developer: end with a plain-English summary and
the questions only he can answer.

---

Read `AGENTS.md`, `docs/BUSINESS-RULES.md`, `docs/PLAN.md` (Batch C, item 14) and
`docs/OWNER-INPUTS.md` (IN-24). Do not read `docs/DECISIONS.md` end to end: search it for "IN-24", "pickup" and "billing" and open only those entries, and `docs/designs/BATCH-C.md` (including the drift check at the top).

## The owner's rule (2026-10-03, in his words)
"I would also like billing to end upon appliance pick up or return by customer, but if pick up is later than
agreed upon end date at fault of the company, then billing is waived."

## What the code does today (verify it, do not trust this summary)
- `closeAgreement` in `src/domains/agreements/index.ts` is the one path that ends or cancels a rental. It cancels the
  Stripe subscription (`SUBSCRIPTION_CANCEL` provider operation), sets the end date, releases the appliance assignments, and
  moves each rented appliance to AWAITING_PICKUP. That all happens when the agreement is *ended*, before the pickup job is done.
- Fixed-term rentals send Stripe a `cancel_at` for the agreed end date (`src/domains/billing/subscription-term.ts`).
  The nightly job (`src/app/api/cron/start-renewals`) ends early-ending rentals on the agreed date
  (`src/domains/agreements/termination-execution.ts`).
- A REMOVAL job completing moves appliances AWAITING_PICKUP to the next state (`applyJobCompletionToAppliances` in
  `src/domains/jobs/index.ts`). It does not touch billing or the agreement.
- Money is whole cents; invoices, receipts, credits and the lock order are described in
  `docs/designs/CHANGES-SINCE-DESIGN.md`. Times are stored in UTC and shown in America/Denver.

## What to decide and write down
1. How the agreement and billing states should work so that billing really ends at pickup (for example: does the agreement
   stay ACTIVE, or get a new "ending, waiting for pickup" state, between the agreed end date and the pickup; what happens to
   the Stripe subscription in that time; what if the customer returns the appliance early; what about several appliances
   picked up on different days).
2. The waiver: a pickup after the agreed end date caused by the company means the extra days are not billed. How the job
   records who caused the delay (company or customer), who may record it (owner/admin only?), the audit record, and the
   plain-English line on the customer's statement. Whether a waived period shows as a credit, a zero-dollar line, or
   simply no invoice.
3. A customer-caused late return: the owner has NOT decided whether the extra time is billed by the day or as a whole
   extra month. Give a recommendation with reasons, and design it so the choice is a stored setting the owner can change
   in the app, explained in plain words on the screen (starting value, what each choice means for a customer, who can change
   it, and a restore-the-recommended-value button).
4. The exact changes to `docs/designs/BATCH-C.md`: new or changed work units, schema (additive only), function signatures,
   named tests (company-late waives, customer-late bills per the setting, early return stops billing, DST day
   boundaries, concurrency with the nightly job), and any stop-and-ask points.
5. Interactions: auto-renew and renewal reminders (`docs/designs/CHANGES-SINCE-DESIGN.md`), early-ending fees, prepaid
   rentals, held payments, the reconciliation checks in `src/domains/billing/reconciliation.ts`.

## Output
A drop-in amendment for `docs/designs/BATCH-C.md`, a list of what is risky or unclear, the owner's questions in plain
words, and a short plain-English summary. Do not change code and do not run anything against production.
