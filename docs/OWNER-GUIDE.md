# Owner's guide (for Chris — plain English, no code)

This explains how to actually run Robinson Appliance Rentals day to day
using Appliance Desk, as it exists right now. It's updated every time a
feature ships or changes — if something here doesn't match what you see
on screen, tell whoever's helping you and check `docs/HANDOFF.md` for
the most current state.

Billing/payments (Stripe) haven't been built yet — this guide covers
everything up through leads, customers, inventory, agreements, jobs, and
maintenance, which are all live today.

## Logging in

Go to `/login` and sign in with your email and password.

- **Forgot your password?** Click "Forgot password?" on the login page,
  enter your email, and a reset link will be emailed to you. It expires
  in an hour and only works once.
- Owner/admin accounts land on the desk dashboard after logging in;
  customer accounts land on their own account page.

## Handling a new lead

1. A new inquiry from the public website shows up under **Leads**, and
   you get an email right away (high-value leads are flagged as such).
2. Open the lead to see everything they submitted — what they need,
   their address, contact info, and why it scored the way it did.
3. Contact them however you normally would, then mark the lead
   **Contacted**, or **Lost** if it doesn't go anywhere.
4. When they're ready to rent, click **Convert to customer**. This
   creates their account and their first service address automatically
   from what they already told you — no retyping. **You never see or
   need to relay a password** — the customer gets an email with a link
   to set their own password and log in themselves.
   - If they say the email never arrived, or the link expired, go to
     their customer page and click **Resend activation email**.

## Setting up a rental agreement

1. From a customer's page, click **New agreement**. Pick the service
   address and the terms — deposit, damage waiver, late fee, tax rate,
   and how long the term is (month-to-month, 6 months, or 12 months).
2. Add the specific physical appliance(s) this agreement covers — for
   example, a washer and a dryer together count as one "set." The
   moment you add a unit, it's reserved so it can't accidentally be
   double-booked onto a different customer's agreement at the same
   time.
3. **Prepaid-term discount and free month:** if the customer is paying
   for their whole 6- or 12-month term in advance, check the box for
   that when you create the agreement — the discount is applied
   automatically per unit/set, using whatever dollar amounts you've set
   in Settings (see below). Paying a full 12-month term in advance can
   also earn a free first month, if you have that turned on.
4. When it's ready, send it for signature. The customer gets a private
   link (no login needed) where they review everything — including
   their discount, if any — and sign by typing their legal name and
   checking a box. That's logged with a timestamp and their IP address.
5. Once signed, the agreement goes **Active** and its appliances move
   from Reserved to Rented. Ending or cancelling an agreement frees its
   appliances back to Available automatically.

## Landlords and property managers with several buildings

A customer isn't limited to one address. If you're signing up a
landlord or property manager who has more than one building, go to
**Customers → Add customer** and add every property they manage right
up front, instead of just one.

Already have that customer on file and they picked up another
building later? Open their customer page and, in the **Properties**
section, click **+ Add property**. Each property shows its own
agreements, jobs, and active monthly total, so you can see at a
glance what's happening at each address instead of hunting through
one long list. (Rental billing still runs per property, one charge
per agreement — there's no combined, single invoice across a
property manager's whole portfolio yet.)

## Scheduling delivery, installation, and other visits

Go to **Jobs** to schedule a delivery, install, swap, removal, or
maintenance visit — optionally tied to a specific agreement, which
pre-fills its customer and appliances for you. Move a job through
Scheduled → In progress → Completed (with notes), or Cancelled. You can
attach a photo by pasting its URL (uploading a photo directly from your
phone/computer isn't built yet).

## Handling a maintenance request

Customers submit maintenance requests themselves from their own
account, and you get an emailed notification right away (urgent/high
priority ones are flagged in the subject line). Go to **Maintenance**
to see the full request — appliance, priority, and what's wrong — and
move it through its status. "Schedule a job for this" pre-fills a new
job with that customer, address, and appliance already selected.

## Inventory and parts

**Inventory** is every individual physical appliance you own — its
asset number, serial number, condition, color, and features (like
front-load vs. top-load), plus its current status (Available, Reserved,
Rented, in Maintenance, or Retired). **Parts** is a separate catalog
keyed by model number — log a part once for a model, and it'll show up
for every unit of that same model automatically, including other model
numbers you say the same part also fits.

## Changing prices, fees, and the prepaid-term discount

Go to **Settings** to change delivery/installation/removal fees, tax
rate, and per-appliance pricing/visibility — all in plain dollars, not
code. The **Prepaid-term discounts** section is where you set your own
dollar amounts for the 6-month and 12-month prepay discounts (separately
for a "set" vs. a single unit), and turn the 12-month free-first-month
bonus on or off. Changing any of these numbers only affects agreements
signed after the change — it never alters an agreement a customer has
already signed.

## Adding a new appliance category

Also in **Settings** — add or retire an appliance type (e.g. a new
category beyond washers/dryers) yourself, with its own photo and
pricing, without needing a developer.

## Reading the dashboard

The dashboard shows real counts: leads by status, customers, draft/
awaiting-signature/active agreements, scheduled jobs, and open
maintenance requests — so you can see what needs your attention at a
glance.

## Resetting test data (once you're done testing)

Once you've had someone put a batch of test leads, customers,
agreements, jobs, etc. into the app to try things out end to end, you
can clear all of that out in one step without losing your own login or
any of your real settings — whoever's helping you just runs:

```
npm run db:reset-test-data -- --yes
```

This deletes every lead, customer, rental agreement, job, maintenance
request, invoice, and payment. It does **not** touch your login (or any
staff login), your pricing/settings, your appliance categories, your
actual physical fleet, or your public site text. Running the same
command without `-- --yes` first shows exactly what it would delete
without changing anything, if you want to see that before it happens.

## What's not built yet

- Taking a real payment (Stripe billing) — everything today is tracked,
  but nobody pays through the app yet.
- Uploading a photo directly (delivery/condition photos are pasted-in
  URLs for now).
- A dedicated dashboard for revenue/collections — that arrives with
  billing.

See `docs/ROADMAP.md` for the fuller list of what's planned next.

## What to do if something breaks

1. Check `docs/HANDOFF.md` — it always says what currently works and
   what's known to be broken.
2. If the site is down or showing errors for customers, that should
   show up automatically in Sentry and you'd be alerted.
3. Otherwise, tell whichever AI is helping you exactly what you clicked
   and what happened — "it broke" is harder to fix than "I clicked
   Save on the pricing page and got a red error message."
