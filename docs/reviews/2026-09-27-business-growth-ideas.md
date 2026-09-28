# Business-growth ideas — for Chris to pick from, none built yet

Chris asked (2026-09-27, after seeing the fleet/revenue/QR-code/
profitability features get built): "use these [the friend's proposal] as
inspiration to come up with ways to really build out my business part of
this system. We are doing great, but it is so basic."

This is a brainstorm, not a build plan — every idea below is grounded in
what the app already has (the real data model, the real workflows), not
generic SaaS features bolted on. Nothing here gets built without Chris
picking it, same as every other `docs/ROADMAP.md` suggestion.

## Ideas that build directly on what was just added (lowest effort)

1. **A driver/technician "today's jobs" view.** A single, big-button,
   phone-friendly page listing today's scheduled deliveries/pickups/
   repairs in order, each with a one-tap status update and the same QR
   scan-to-open flow just built for appliances. Today, running a route
   means opening the regular `/desk/jobs` list on a phone — this would be
   a dedicated, stripped-down page for actually being on the road.
2. **A driver route grouped by area.** Group today's/this week's jobs by
   ZIP code or neighborhood so deliveries/pickups on the same day can be
   sequenced efficiently instead of criss-crossing town. No mapping
   service needed to start — just grouping and sorting what's already
   scheduled.
3. **Inventory-shortage alerts.** Now that fleet utilization is tracked,
   flag an appliance type sitting at or near 100% utilization for a
   sustained period as a "you're probably losing rentals to no
   availability" signal — a concrete buy-more-washers trigger, not a
   guess.
4. **Pricing-opportunity flags.** The flip side of #3: a type that's
   consistently under-utilized may be overpriced (or overstocked) —
   surfaced from the same fleet numbers, as a prompt to reconsider that
   type's price in `/desk/settings`, not an automatic change.

## Customer relationship / retention

5. **A churn-risk view.** Combine what already exists — late/failed
   payments, an agreement nearing its end date with no renewal signal,
   a string of maintenance requests — into a short list of customers
   worth a proactive call, instead of Chris noticing only when someone
   already cancels.
6. **Review/referral requests at the right moment.** An automatic email
   a set number of months into a rental (or at a successful pickup)
   asking for a Google review or a referral — tied to the
   `CustomerCredit` model already in the schema to actually reward a
   referral, not just ask for one.
7. **A lead win-back nudge.** A `Lead` that's sat in `NEW` or
   `CONTACTED` with no update for a while (or was marked `LOST`) could
   surface as a "follow up again" reminder on the dashboard — cheap to
   build since lead status/aging already exists, and it's free revenue
   sitting in data that's currently just... sitting there.

## Money

8. **Formal annual price-review reminders.** Flag any `ACTIVE`
   agreement that's crossed a year (or whatever interval Chris picks)
   without its price changing, as a prompt to revisit the rate — never
   automatic, since a price change on an existing customer is
   relationship-sensitive.
9. **The automated late-fee/dunning escalation already noted in
   `docs/ROADMAP.md`** ("Deliberately deferred within Phase 6B") — worth
   revisiting now that there's a real revenue dashboard to show the
   impact of past-due accounts.
10. **A formal referral program**, not just the one-off ask in #6 — a
    small schema addition to track who referred whom and automatically
    apply a `CustomerCredit` when the referral converts.

## Growth / marketing

11. **Simple, real local-search landing pages** ("Appliance rental in
    [City]") for every city/ZIP actually served — cheap SEO built from
    data that already exists (`BusinessSettings`' service area), aimed
    at bringing in leads rather than running the existing business.
12. **SMS notifications**, already flagged as optional/later in
    `docs/ROADMAP.md` — email-only notifications are working, but SMS
    has a meaningfully higher open rate for time-sensitive things like
    "your delivery window is today."

## From a second review (ChatGPT "Astra," same day)

Chris also shared a more architectural review from a different AI tool
(saved at `docs/reviews/2026-09-27-astra-operations-review.md`, assessed
in `docs/DECISIONS.md`). It's more accurate than the friend's rebuild
proposal — it correctly says it only looked at screens, not the backend,
and most of what it calls for turns out to already be true underneath
those screens (a real relational schema with enforced status transitions
and audit logs, an already-fairly-rigorous billing subsystem, automated
backups, CI, preview environments). Three ideas from it are genuinely
worth adding to this list:

13. **A separate "Contacts" concept**, distinct from the billing
    `Customer` — so a property manager's tenant, the property owner, and
    the person who actually pays can be three different people on the
    same account, not squeezed into one. Real gap; would need its own
    schema addition.
14. **An accounting export** (CSV or a real QuickBooks-style
    integration) — right now the financial data is real and correct in
    the database, but getting it into whatever Chris (or a future
    bookkeeper) uses for taxes/accounting means someone hand-copying
    numbers today.
15. **A closer audit of duplicate-payment protection on the sending
    side**, not just the receiving side — the app already de-duplicates
    incoming Stripe webhook events (`WebhookEvent`), but the review's
    point about idempotency *keys on outgoing requests* (so a retried
    checkout/billing-portal request can't ever double-charge) is worth
    specifically verifying, not assuming.

Everything else in that review — granular employee roles beyond
OWNER/ADMIN, a purchasing/supplier/parts-stock subsystem, dispatch
optimization by driver capacity/skills — describes a multi-employee
operation. Chris runs this alone today; building that layer now would be
solving a problem he doesn't have yet, at the cost of time that could go
toward the ideas above or the ones already listed. Worth revisiting once
he's actually hiring.

## Not included here on purpose

Big, speculative rebuilds (a full CRM replacement, AI-based anything, a
generalized multi-industry platform) are left out — they don't fit
`AGENTS.md`'s "purpose-built for appliance rental" scope or the
incremental approach that's worked well so far. If Chris wants to go
bigger than this list, that's a conversation to have explicitly, not
something to infer from "make it less basic."

## What to do with this

Nothing, until Chris picks one or more. When he does, each becomes its
own normal PR-sized piece of work, the same way QR codes/profitability/
revenue/fleet just were.
