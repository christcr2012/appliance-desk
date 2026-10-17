## Change your website yourself (V-C4)
Open **More → Website** (owners and admins only).
- **Edit a page.** Pick a page, then a section, then the item. On a phone you move one step at a time and switch between Edit and Preview; on a computer you see the list, the editor and the real page side by side. You can also click words, a button or the home photo inside the preview to jump straight to it, or use the search box.
- **Nothing is live until you publish.** *Save draft* keeps your work private. Visitors keep seeing the live website. The bar at the bottom always says whether you have unsaved changes.
- **Business facts stay in Settings.** Type `{phone}`, `{email}` and similar and the website fills in your real details. Prices come from your price list.
- **Photos and promotions.** Upload a picture, say what it shows (or mark it decoration only), pick the part that must stay visible, and check the wide / square / phone crops. A promotion has an on/off switch and optional start and end times in Colorado time; the screen tells you whether it is visible now.
- **Review & publish.** You see each change before and after, where every link goes, which business facts are used and which pages are affected. If someone else changed the live website while you were reviewing, nothing is published and you are asked to review again.
- **History.** *Put in draft* copies an older version into your draft so you can look at it first; it never goes live by itself. *Discard the draft* throws away unpublished changes without touching the live website.
- **Pictures** need the private picture store to be switched on for the real website; until then uploads are refused with a plain message.

## The new home page and "Do we deliver to you?" (V-1, V-2)
- **A new look for the home page** (the other public pages follow next). The wording is still yours: open **More → Website → Home**.
- **Highlighted words.** Type a word or phrase from your heading into *Highlight in the heading* and it gets the fresh-green band. Leave it empty for none. If the phrase is not in the heading, nothing is highlighted.
- **Address check.** When your service area lists ZIP codes, visitors can type a street address and ZIP and get an instant yes or not-yet. It **stores nothing and sends nothing**; "yes" takes them to the quote form with the address filled in, "not yet" invites them to the launch list. Every answer's wording is a Website item (`Home → Address check`), and the ZIP list stays in Settings.
- **Price ticket.** The small card on the photo shows the first set price from your price list; only the label ("Starting at") is yours to change.
- **Nothing is live until you publish and the daily release runs.** Header, footer and banner words cannot yet be previewed before publishing.

## Every public page now reads from your website content (V-C3)
- **Nothing looks different yet.** Every word, button, link and the home photo on the public site is now a website item with today's words as the starting text. The screens to change them (the website editor) come next (V-C4); until then the site looks and reads exactly as before.
- **Facts stay where they live.** Your phone, email, address, hours, prices, fees and cities come from Settings and the price list. In a sentence you will write them as `{phone}`, `{email}`, `{businessName}`, `{city}` and so on, so a sentence can never disagree with the real number or price.
- **Links inside sentences** are written `[words to click](/pricing)` or `[words](https://example.com)`. Only pages on the site and `https://` addresses are accepted; a broken link is refused with a plain message when you save and again when you publish.
- **Buttons** have their words and where they go chosen separately. A button can go to a page, an `https://` address, or call/email using your business profile. The menu and footer links keep their pages; you can change their words.
- **Promotions.** A banner across the top of every page and a highlighted box on the home page can each carry a title, text, optional picture and button, with an optional start and end in Colorado time. Both are off until you set them up, appear and disappear on their own at the times you set, and never hide anything else. A promotion cannot yet be tied to a priced offer.
- **Legal pages** (privacy, terms, accessibility) keep their approved wording; only the menu and footer around them can be edited.
- The launch page now says your configured business name instead of a name typed into the code.

## Website pictures and richer website content (V-C1, V-C2)
- **Nothing looks different on the website yet.** This release adds the foundation: the website can now hold pictures, links, lists and promotions, with checks so a broken link or a picture without a description cannot go live. The screens to use them come next (the website editor, V-C4).
- **Pictures.** Owners and admins can upload a JPEG, PNG or WebP (up to 10 MB). The system re-saves it, removes location and camera information, and keeps it private until you publish a website version that uses it. A picture needs a short description for people who can't see it, or must be marked decorative.
- **Catalog photos** (Settings → appliance prices) now accept an uploaded picture, an `https://` address, or blank. Anything else is refused with a message.
- **If pictures can't be uploaded** you'll see "Picture storage is not set up in this environment yet." The live website keeps its current pictures.
- **Phone and email links** on the website will always use the phone and email in your business profile, so they can't drift.

## Connected records, cleaning, and what customers now see (W-17, W-20)
- **Related and History.** Every main record page (appliance, customer, rental agreement, purchase, seller, visit, invoice) has a "Related" box with links to the connected pages and a "History" box saying who did what and when, newest first, in plain words. Staff do not see these boxes.
- **Search** now also finds purchases (by the seller's name or the receipt number) and sellers (by name). Staff never see purchases or sellers in search. Serial and model numbers still find appliances.
- **Cleaning step.** A machine that passes inspection is now "Being cleaned", not Available. Today shows "Clean (machine)"; open it and press **Cleaning done** and it becomes Available. A machine that fails inspection goes to repair and a draft repair visit with no date appears on Today as "Schedule the repair" (only one per machine; nothing is sent to anyone).
- **Customer account.** Customers see "Your next bill" (rent for the machines now on the rental, and the date; tax and credits are on the bill itself), a short Requested / Scheduled / Done list for each open visit, a "what happens next" note after a pickup request, problem report or ending a rental (English and Spanish), washer + dryer sets shown as one set with each machine's number, and a **Pay now** button on a past-due bill that opens that bill's Stripe payment page. Pay now needs your Stripe keys, so until they are set up it shows a polite "try again" message.

## Filing use tax from the File now panel, and the connected steps (W-10, W-19)
- **Use tax return page → File now.** Press "Open Revenue Online", then copy each number into the matching line, in the order shown (it follows Colorado's DR 0252 form). Submit and pay on the website yourself, then press "I filed and paid it" and enter the date and confirmation number. "Print the filled-in official form" gives the real DR 0252 with the State column filled in; sign it yourself and attach the purchase list from the audit pack if you file on paper.
- **Next year's form.** From December, System health says if next year's DR 0252 isn't loaded. Send the new official PDF (named like DR0252_2027.pdf) and it is added; until then the page shows the numbers to type.
- **Leads and quotes.** After you convert a lead, "Create quote" and "Start agreement" are on the lead page. Converting a quote opens the new draft agreement.
- **Unsigned agreements.** If an agreement has waited for a signature longer than the number of days in Settings → Notifications → Unsigned agreement reminder (starts at 3), Today shows "Follow up: (name) hasn't signed". It clears when they sign or you cancel.
- **Repair and pickup requests.** A customer's repair request shows on Today at once. A pickup request from the customer's account becomes a draft pickup visit, shown as "Schedule (name)'s pickup". A rental that ends with appliances still out gets the same; if it somehow didn't, open the agreement and press "Schedule the pickup".
- **Agreement progress card.** Each unfinished step (signature, deposit, equipment, delivery, billing) has a button that opens the page where you do it.

## Taxes in one place and rental turning points (W-3, W-4)

**Taxes** is now one menu entry (Money → Taxes) with four tabs: **To file** (returns), **Use tax**, **Rates & areas**, and **Setup**. Setup holds "Customers who don't pay tax", "What gets taxed", the use-tax settings, the audit pack and record keeping. Old bookmarks to the earlier tax pages still work and forward you here.

Every return page now starts with one plain line: **"File and pay $X on Colorado's sales tax website (SUTS) by <date>"** with an Open SUTS button. Below it are the numbers to copy into the website, then the button **"I filed and paid it"** once you have. Appliance Desk never files or pays for you. State and Greeley use tax are listed separately.

**Signing a rental** creates a draft delivery visit and a To do, "Schedule <name>'s delivery", due the next day. Nothing is sent or charged.

**Unpaid bill** — open the invoice and use **Send payment link** (you see the exact message first and can add a note) or **Copy link** to text it yourself. Sending needs customer email turned on; copying always works. **Take payment by phone** opens Stripe's own page for that one bill so you can type the card the customer reads out; the payment shows up only after Stripe confirms it. Change the wording in Settings → Payment link wording.

**New leads** add a To do "Contact (name)" (change how soon in Settings → Lead response time). When you mark a lead contacted you pick the next follow-up date, and that day it returns to your list. A quote the customer approves adds "Turn (name)'s approved quote into a rental".

**A rental ending soon** (30 days before by default; change it in Settings → Pickups and deliveries → "Rental ending reminder") adds one To do. Open it to choose **Renew**, **Month-to-month** or **Pickup**. Renew and Month-to-month only start a draft for you to review.

**Deciding an ending** (choosing Pickup, or setting a month-to-month or early ending) creates one draft pickup visit and a To do, "Schedule <name>'s pickup". Doing it twice never makes a second visit. A visit due within 2 days with nobody assigned, or a pickup needed within 2 days with no time, gets a To do, "Assign / set a time".

## Recording purchases, tax steps and the audit pack (W-14, W-2, W-15)

**Record a purchase** (Equipment → Purchases → Record a purchase, or the button on Inventory) replaces adding appliances one at a time. Enter the receipt once: who you bought from (a supplier, or type a private seller), the date, the receipt number, photos or PDFs of every page, then one row per machine with its model, serial number and price. A washer and dryer bought together are two rows. If the seller charged tax, type the total printed on the receipt; the app splits it across the machines by price, down to the cent, and shows you the split before you save. Add delivery or other charges separately; they are kept on the purchase and are not added to a machine's cost.

**The tax question has no default.** Only the owner can answer it. If you are not sure, choose "I'll check the receipt later" and a To do appears three days later, turning urgent a week before the return it belongs on is due. Another state's tax is saved with a note and a To do to ask your CPA; nothing is guessed. Every screen shows the same next step for a purchase.

**Tax proof and audit pack.** Each appliance page shows how it was acquired, what you paid, its single tax outcome and its receipt. Purchases → Audit pack lists everything you bought in any date range (printable, or as a spreadsheet) with the return and confirmation number once filed. Parts you receive on purchase orders are included and ask the same tax question when you record the delivery.

**How long to keep records** is under Purchases → Record keeping. It starts at 7 years, which is a cautious general choice; ask your CPA what applies to you. A receipt that a filed tax return relies on can never be removed, whatever the number says.

## Customer language and Spanish review (W-26)

After the checked W-26 release, customers can save English or Español in their account and use the same choice through quotes and signing. English remains the governing signed agreement. Historical documents keep their recorded content.

In Desk → Settings → Languages, edit Spanish counterparts beside their English sources, including separate communication subjects and bodies. Preserve every template variable. Complete all current drafts, have your chosen fluent reviewer and separate legal reviewer approve the exact displayed version, then explicitly publish. Editing either language invalidates that approval. Missing or outdated content keeps the customer journey in English. These steps do not send a message, grant SMS consent or enable live payments. Engineering is complete in PR #478; final CI/merge and actual release/reviews are still pending.

# Owner's guide (for Chris — plain English, no code)

This explains how to actually run Robinson Appliance Rentals day to day
using Appliance Desk, as it exists right now. It's updated every time a
feature ships or changes — if something here doesn't match what you see
on screen, tell whoever's helping you and check `docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md` for
the most current state.

(Corrected 2026-09-29 — this line had gone stale: billing/payments are
fully built and running today, in Stripe's test mode — see "Billing,
statements, and late fees" below.)

## Evergreen desk, portal, and public-site navigation (2026-10-06)

On a desktop, the owner desk uses the dark Evergreen side navigation. On a
phone, the main work areas are in the bottom bar and **More** opens the rest of
the desk navigation. The current page is visibly selected. Search, theme
switching, and sign-out remain available without changing business permissions.

Customer records still have Overview, Properties, Rentals, Service, Billing,
and Activity sections. Choose a property, then **New rental here** or **Schedule
visit here** to carry that address into the next form. **Activity** keeps notes
and recorded changes together; use **Older entries** for more history.

The customer portal now uses the same visual system. On phones its bottom bar is
**Home, Rentals, Maintenance, Billing, Account**. The home page answers, in
order: what the customer rents, what happens next, whether anything is owed,
and how to get help. **Report a problem** is the main action. **Request pickup**
still submits a request for business review; it does not cancel an agreement or
change billing.

The public site follows the visitor's light/dark preference. Its live home page
uses **Check your address** as the main action and **See prices** as a secondary
text link. The existing prelaunch mode remains a real business setting and
keeps its launch-interest workflow when enabled.

Settings remains divided into sections with the same save/actions and approval
gates. Billing still separates invoices, deposits, fees, tax, payments, and
rental revenue. A signature or required deposit amount does not prove payment.
Live customer email, SMS, and marketing activation remain off until their
existing owner approval/go-live gates are satisfied.

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

## Sending a quote (estimate) before an agreement

When someone needs a formal price quote before they're ready to sign —
a property manager comparing options, a bulk deal, anything you want
to put in writing first — go to **Estimates** instead of jumping
straight to an agreement.

1. **New estimate**, either from a lead ("Start an estimate" on the
   lead page, which pre-fills their info) or from scratch. Add the
   line items — appliances, quantities, monthly price — and, if you
   want one, a deposit amount.
2. Send it. The customer gets a private link (same idea as signing an
   agreement — no login needed) where they can approve or decline it.
   If you set a deposit, approving prompts them to pay it right there
   on their own link — you don't have to collect it separately.
   - **If they don't respond for a few days**, the system automatically
     emails them a friendly "still interested?" follow-up on its own —
     you don't need to chase it yourself. It only ever sends the one
     follow-up per estimate.
3. Once approved (and the deposit paid, if there was one), click
   **Convert to agreement(s)**. For a single property this rolls the
   deposit straight onto the new agreement — they're never charged for
   it twice. For a property manager with several properties on one
   estimate, converting splits it into one agreement per property; in
   that case the app will flag that the one deposit already collected
   needs to be sorted out by hand across those agreements, since it
   doesn't know which property it belongs to.

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

### Review draft signing charges before sending a contract

On a **Draft** rental agreement (owner or admin account), the private
**Prepare this order for signing** panel lets you save or refresh a draft
calculation. It shows one administrative setup fee per new delivery address
and any large-order down payment separately for each agreement. If one quote
has several locations, review all its prepared records together. The
button never charges a customer, books a delivery, sends a contract or
applies a first-bill credit. If you change a draft, refresh its calculation.

**These are planning amounts, not a final all-in customer price.** Setup-fee
tax treatment is still awaiting CPA review. The later W-22 signing/payment
steps must be completed before these records can be used to collect the
setup fee at signing or credit rent on delivery.

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
one long list.

Rental billing still runs per property, one charge per agreement —
there's no combined, single Stripe charge across a property manager's
whole portfolio. But you can see and settle everything they owe, across
every property, in one place: click **View statement** on their
customer page (or **Billing → Statements**). See "Billing, statements,
and late fees" below.

## Scheduling delivery, installation, and other visits

**Staff and unassigned jobs.** In Settings → Visits and scheduling you can choose
whether staff may work jobs nobody is assigned to. On (the starting value) means
any staff member can open and finish an unassigned job. Off means they can only
work jobs assigned to them. Either way staff can only work jobs that are scheduled
or in progress, and only the appliances on that job.

**Recording an inspection.** On a returned appliance, check each item that is
fine. If everything is checked it goes back to Available. If anything is
unchecked it goes to Maintenance. If you are sure it is fine anyway, type a
reason in "Pass it anyway" and it is saved with your name. A saved inspection
cannot be edited; if something was wrong, add a correction note and the
original stays as it was.

Go to **Jobs** to schedule a delivery, install, swap, removal, or
maintenance visit — optionally tied to a specific agreement, which
pre-fills its customer and appliances for you. Move a job through
Scheduled → In progress → Completed (with notes), or Cancelled. You can
attach a photo by taking one with your phone's camera or choosing one
from your device — no more pasting in a URL.

**Who, when and how long.** When you schedule a visit you can pick **who is
doing it** and **how long it takes** (leave the length blank to use your usual
visit length, set under **Settings → Visits and scheduling**, starting at 2
hours). If that person already has another visit that overlaps, you are shown
exactly which visits and can choose "Book it anyway"; nothing is booked twice
by accident. A visit that ends exactly when the next one starts is fine. You can
change the time, length or person later from the job's **Schedule** box. If
nobody was there, press **Nobody was there (no-show)**: the visit is cancelled
and frees that person's time, and nothing else changes (no appliance, charge or
credit). The times you type are Colorado time.

New appliances get their asset numbers (like WASH-0001) from a counter that only
moves forward, so a number is never used twice, even after you delete a unit.

## Dispatch board and the driver view

**Dispatch** shows every scheduled job on one board for the day/week,
so you can see who's doing what and catch a double-booking or a gap
before it happens, instead of scrolling the full Jobs list.

If you've given someone a **staff** login (see "Adding a staff
account" under Settings), they see a simplified **Driver view**
instead of the full desk — just their own assigned jobs for the day,
with the details they need on site (address, appliance, notes) and a
way to mark a job in-progress/completed with a photo. Staff accounts
can't see pricing, billing, reports, or Settings at all — only
day-to-day work.

## Handling a maintenance request

Customers submit maintenance requests themselves from their own
account, and you get an emailed notification right away (urgent/high
priority ones are flagged in the subject line). Go to **Maintenance**
to see the full request — appliance, priority, and what's wrong — and
move it through its status. Mark it **Reviewing**, then "Schedule a job
for this" pre-fills a new visit with that customer and appliance; saving
it moves the request to **Scheduled** at the same moment. Starting the
visit moves the request to **In progress**. When the visit is completed
with every item repaired, the request becomes **Resolved**; if a repair
was not finished or nobody was home, it goes back to **Reviewing** with
a task for you, and the same happens if the visit is cancelled or
marked a no-show. The request now remembers which property the visit is
for.

## Inventory and parts

**Inventory** is every individual physical appliance you own — its
asset number, serial number, condition, color, and features (like
front-load vs. top-load), plus its current status (Available, Reserved,
Rented, in Maintenance, or Retired). **Parts** is a separate catalog
keyed by model number — log a part once for a model, and it'll show up
for every unit of that same model automatically, including other model
numbers you say the same part also fits. Each part also shows how many
you currently have on hand.

## Ordering parts: suppliers and purchase orders

When you need to restock parts, go to **Suppliers** to keep a simple
contact list (name, phone, email, notes) for who you buy from — no
approval process, just contact info and a record of what you've
ordered from each one.

To place an order, go to **Purchase orders → New purchase order**,
pick the supplier, and add line items — either linked to a part you
already track, or just a free-text item for a one-off buy. A purchase
order moves **Draft → Ordered → Received** (or you can cancel it any
time before it's received). When a shipment arrives, open the order and
type how many of each line came in — you can receive an order in
several shipments, and the order shows Received once everything has
arrived. **Each arrival adds to your parts' on-hand counts
automatically.** If you leave a price blank, the app records the cost
as "unknown" rather than $0; type 0 only for something that really was
free.

Every change to a part's count (arrivals, parts used on a repair,
recounts, corrections) is written to a permanent history; nothing is
ever overwritten. If you try to use more than the count
shows, the app says so instead of quietly dropping to zero — recount
the shelf first. Logged parts on a job by mistake? Use **Undo** next to that entry on the
job page; it adds a correction and the original stays visible. A part with history
can't be deleted; **Archive** it to hide it (and **Restore** it any
time). Suppliers can be archived the same way. When you log parts used
from a job's page, the job's parts cost is added up from those entries
and the hand-typed "parts cost" box is switched off for that job so
nothing is counted twice.

## Changing prices, fees, and the prepaid-term discount

Go to **Settings → Rental policies** to change delivery/installation/removal fees, tax
rate. Use **Products and pricing** for per-appliance pricing/visibility — all
in plain dollars. The **Prepaid-term discounts** section is where you set your own
dollar amounts for the 6-month and 12-month prepay discounts (separately
for a "set" vs. a single unit), and turn the 12-month free-first-month
bonus on or off. Changing any of these numbers only affects agreements
signed after the change — it never alters an agreement a customer has
already signed.

## Setting the rules for ending and renewing rentals

Go to **Settings → Ending and renewing rentals**. Everything here is typed in
the screen. None of it is built into the software, so you can change it any
time. **A change only applies to rental agreements sent for signing after you
save.** Every agreement already sent keeps the terms it was sent with, so
changing these never changes a customer's current 6- or 12-month rental.

- **Ending early:** a flat fee, a percent of the rent still owed (or both; the
  customer pays whichever is larger), an optional highest fee, how many days of
  notice the customer must give, and what happens to months a customer prepaid
  but did not use (refund, account credit, or keep). Enter **0** if there should
  be no fee; leaving a box empty means "not decided yet".
- **Automatic renewal:** how many days before the term ends the customer is
  told, and the wording they agree to.
- The box at the top of the screen tells you in plain words whether each rule is
  switched on yet and exactly what is still missing. A rule stays off until
  everything it needs is filled in.
- Ending early also needs the wording customers will see; without it that rule
  stays off.
- Changing the wording of the renewal terms starts a new version. Customers who
  already agreed keep the wording they agreed to.
- Month-to-month changes are versioned. The system creates a tracked notice and the new version does not apply to that customer until the configured notice period has passed after the notice is delivered.
- A 6- or 12-month term starts when the appliances are delivered (when billing starts), not when the agreement is signed.
- Customer and owner ending/renewal screens are built. Live customer email and automatic-renewal execution still follow the separate go-live approval switches.

### When equipment comes back early

If a customer returns **everything** before the rental's agreed ending, Today shows "Returned early — choose what to do"
(you can also reach it from the agreement page). Choose what happens to the monthly bill (keep billing to the agreed
ending, or stop now), whether days already paid for after pickup are kept, credited or refunded, and, for fixed terms, the
early-ending fee (the one in the customer's signed terms, none, or another amount with a written reason). Press "Show the
numbers", check them, then "Confirm these choices". A fee becomes an open bill; it is never charged to a card by itself. In
Settings → Ending and renewing rentals → "When equipment comes back early" you set your standard choices and whether the
system asks you each time or applies them automatically (you can still change an automatic choice until a refund or credit
is given or the fee is paid). A rental paid in full in advance is always settled by you from the agreement page.

Also new: ending a month-to-month rental for a customer (agreement page), recording that a late pickup was our delay (job
page, waives the late days), and Desk → Notices for reminders that could not be delivered.

## Changing the wording on your website

Settings → Website → **Edit website text**. The page lists the text you may change, grouped by page: the home page
headline and sub-heading, the "before opening" version of them, short paragraphs for households and for property
managers, up to eight common questions with answers, the "How it works" steps, the sentence above the quote form,
descriptions of the pictures (read aloud to people who cannot see them), and the title and summary Google shows for
each page. Each box says what it is for, shows a character count, and has a "Restore the starting text" link.

1. Change the text and press **Save draft**. Visitors still see the old text.
2. Use the **Preview** links to see your draft on the real page (only you and other owners or admins can see it).
3. Press **Publish…**, read the list of what will change, then **Publish now**.
4. Made a mistake? **History** lists every version that was live, with who published it and when. **Restore this
   version** puts it back (as a new version, so nothing is ever erased).

Prices, phone, email, address and service area are never in these boxes; they come from your price list and Settings.
Boxes marked "Needs your decision" (opening-date wording, who you rent to) stay as they are until you decide. If two
people edit at once, the second one is told to reload instead of overwriting the first.

Settings → Business profile now also holds your **opening hours** (each day: not shown, closed, or open with times),
**holiday closures** (one per line, like `2026-12-25 Christmas Day`; past dates stop showing by themselves), links to
your **Facebook, Instagram, Google and Nextdoor** pages, and your **logo** (printed on invoices and work orders).
Hours, closures and links appear in the website footer; hours and closures also appear on the contact page.

## Deposits, refunds and credits (Billing)

Billing now has two more tabs. **Deposits** lists every deposit you are holding and have not yet decided on, grouped by
how long ago the rental ended (still renting, 0–30, 31–90, over 90 days). Over-90-day deposits are highlighted. Press
**Decide** to give a deposit back (all of it, or part with a written reason). **Waiting for Stripe** shows requests sent
to Stripe that are not finished, each in plain words. There is nothing to press there: the system retries every night.

On any invoice (Billing → a customer → the invoice) the **Money decisions** section lets you refund money the customer
paid on it, or pay it with the customer's account credit. Every decision asks you to tick a box that repeats the amount in
dollars and in words before it goes through. Only you and admins can see or use these screens. If a refund is paid back
through Stripe, the page tells you whether Stripe has confirmed it yet.

Reports, Revenue, Fleet and Growth: every number now has a **How this is counted** note (what dates it uses, how it is
worked out, whether it is a recorded fact or an estimate, and a link to the records behind it). A cost you never entered
shows as "unknown", never as zero and never as profit.

## Adding a new appliance category

Also in **Settings** — add or retire an appliance type (e.g. a new
category beyond washers/dryers) yourself, with its own photo and
pricing, without needing a developer.

## Sets (washer + dryer and any others you make)

A set is two or more machines rented together for one lower monthly price. It is not an appliance: each washer and
dryer is still its own machine in your inventory, so you can also rent them separately to different customers.
**Settings → Products and pricing → Sets and packages** lists your sets. For each one you choose which machines it
contains (any appliance type you have, including ones you add later), the set price, and whether it shows on the
website. The screen works out the saving for you ("Renting these separately would be $70 a month; the set is $60 — the
customer saves $10 a month"). The website and the quote form show sets first, then single machines. Retiring a set
hides it; signed agreements keep their prices. Your old "Washer + Dryer Set" appliance type was turned into the
"Washer + Dryer Set" set automatically, at the same price. When you build a rental or a quote, **Rent as** lets you pick a set: its name and price
fill in (you can still change the price for a special deal), and for a rental you tick one washer and one dryer — any
two you have. If an older record shows a whole set as one appliance, To do shows **Split … into separate machines**;
the guided screen keeps that record's history on the washer and adds the dryer to the same rental.

## A machine taken for repair with no replacement

If a visit takes a machine away and you have no replacement yet, mark the swap's new machine as **not delivered** (or
pick up just that machine). The customer keeps paying the normal price and their portal says the machine is out for
repair. To do shows **Return or replace …** (urgent after 3 days — change that in Settings → Pickups and deliveries).
When a replacement swap is delivered, or you record that the same machine went back (or close it), the customer gets a
credit on the next bill for every day without it — for example, a dryer from a $60 set out for 6 days is $6.00.

If the machine was part of a set and the customer doesn't want it back, choose **The customer is done with it** on the
same screen. The machine that stays goes to its normal single price (for example the washer at $35 instead of the $60
set) from the day after the pickup, and the next bill gets a credit for the part of the month already charged at the
set price. The screen shows both numbers before you save.

## Billing, statements, and late fees

Rent is charged and collected automatically through Stripe, agreement
by agreement — but Stripe is currently running in **test mode**, which
behaves exactly like the real thing (checkout, recurring billing,
invoices, webhooks) except no real money moves; it only accepts Stripe's
fake test cards. Switching it to take real payments is a single
deliberate step (real API keys instead of test ones) that's intentionally
left for you to decide when to flip — see `docs/ROADMAP.md`. This
section covers the tools around billing either way — for a customer with
several properties, for money that comes in outside Stripe, and for
invoices that go unpaid too long.

**Viewing everything a customer owes.** Go to a customer's page and
click **View statement** (or **Billing → Statements** to see every
customer with an open balance, worst first). The statement groups every
invoice by property, so a property manager's whole portfolio is on one
screen instead of scattered across separate agreements — with a
downloadable CSV you can email them or hand to a bookkeeper.

**Recording a payment that didn't come through Stripe.** A check, cash,
or a bank transfer someone confirmed with you directly — click
**+ Record payment** on the statement page, enter the amount and method.
Leave "Apply to" on "All open invoices, oldest first" and it spreads the
payment across everything owed, oldest invoice first — the "one check
covers three properties" case. Pick a specific invoice instead if the
payment is only for that one. If someone pays more than they currently
owe, the extra is kept as a credit on their account rather than lost.

**Writing off an invoice.** If an invoice is uncollectible — a tenant
skipped out, a dispute you're settling some other way — open the
statement page and click **Write off** next to that invoice, with a
short reason. It's marked written off (not paid, not deleted) so your
records stay honest.

**Late fees.** Once a day, the system checks every open invoice against
that agreement's own late-fee terms (set when the agreement was signed —
a flat dollar amount, a percentage, or both, after however many grace
days you agreed to). If a bill has genuinely gone past its grace period,
it adds the fee automatically and emails you a same-day summary of what
was added and to whom. It never charges anyone's card by itself — it
only adds the fee to what they owe, the same as any other automatic
step in this app never takes payment on its own decision.

## Reading the dashboard (Money → Business overview)

The dashboard shows real counts: leads by status, customers, draft/
awaiting-signature/active agreements, scheduled jobs, and open
maintenance requests — so you can see what needs your attention at a
glance.

## The rest of the desk, briefly

A few more pages worth knowing exist, each answering one specific
question:

- **The menu** has 14 entries. **Schedule** holds the dispatch board, Jobs and the Driver view as three tabs; **Equipment** holds Inventory, Parts, Purchases and Purchase orders; **Money** holds Billing, Revenue, Fleet, Reports and the Business overview. **More** lists the rarely used screens (Suppliers, Growth signals, Launch list, System health, Privacy requests, Activity).
- **Filing a tax return** — Today shows "File and pay $X on SUTS by <date>" (or "File a $0 return…") the day a period closes, and reminds you every business day once it is overdue. Open it, file and pay on the official website yourself, then press **I filed and paid it** and enter the date you paid and the confirmation number. If the website charged a different amount, open the optional section and say why.
- **Get set up (owner only, top of Today)** — until the business is ready, a card lists six steps in order: business details, service area, prices, tax setup, payments and email. Each says "Done ✓" or the one thing still missing, and the button opens the screen that fixes it. It only looks; it never turns anything on. Payments and email become Done only after the Stripe and email keys are added in your hosting settings (see the go-live checklist). The card disappears when all six are done.
- **Today** — everything that actually needs your attention right
  now (overdue rentals, appliances due for maintenance, and today's
  scheduled jobs) in one place, so you don't have to go check several
  pages separately. A failed automatic card charge appears here immediately
  even if its invoice has no due date. The item shows the unpaid dollars and
  opens that specific invoice; partial payments and overdue open invoices show too.
- **Tasks** — your own follow-up to-dos (overdue, due today, and
  everything else), including ones created automatically from things
  like a lost lead or a lead you marked to call back later.
- **Activity** — a combined "what actually happened" feed across
  leads, estimates, jobs, and billing, with quick "today"/"this week"
  filters — useful when you want to see everything that happened
  without checking each section separately.
- **Search** — one search box (in the desk header on every page) that
  looks across customers, appliances, and leads at once.
- **Revenue** (owner/admin only) — your agreed monthly rate (MRR) and
  yearly rate (ARR), which are *estimates from agreed prices*, next to
  money actually received and refunded, past-due and failed payments.
  Every number has its definition printed next to it (what it counts,
  which dates, actual or estimate).
- **Reports** (owner/admin only) — estimated earnings versus money
  actually collected per rental (the "gap" shows rentals falling
  behind), repairs missing a logged cost, where leads come from, and the
  accounting CSV download (every payment, refund and deposit movement).
  Profit and loss with expenses is not built yet — see
  `docs/plans/TAX-AND-BOOKS-OVERVIEW.md` (Batch K).
- **Growth** (owner/admin only) — customers worth a proactive call:
  active rentals showing a churn signal (a past-due invoice, a
  cancellation-risk pattern), plus leads worth a win-back attempt.
- **Fleet** (owner/admin only) — which appliances are getting the most
  and least use, and which have cost you the most in repairs.
- **Growth signals** (owner/admin only) — same as "Growth" above.
- **Notices** (reached from the "Needs your attention" items on Today) — the formal
  letters the system writes for you (renewal reminders, month-to-month
  change notices). Each is saved, held until it is delivered, and can be
  marked delivered by hand while customer email is switched off.
- **Automations** (owner/admin only) — every scheduled job's last runs,
  what it did, and any failures; you can pause a rule here.
- **Privacy requests** (owner only) — customer requests to see or delete
  their data, with identity check, what must be kept by law, and a
  downloadable export. Step-by-step: `docs/runbooks/PRIVACY-REQUESTS.md`.
- **Launch list** (owner/admin only) — people who asked to hear when you
  open; see "Launch list (preparing to open)" below.

## When changes reach your live site (and keeping hosting costs low)

To keep the hosting bill near $20 a month, your live site updates **when the agent finishes a batch of work** (and at
least once a week, Monday at about 3 a.m.), with every change that passed all its checks. If you need a change live
sooner: on github.com open the project → **Actions** → **release to live site** → **Run workflow**, or ask
the agent to do it. Agents' work-in-progress no longer gets its own preview website; if you want to look at a screen
before it is finished, ask for a preview and the agent will make one.

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

## What's still deferred or not live

(Corrected 2026-09-29 — this section had gone stale; photo uploads and
the revenue dashboard were both built a while back but this list never
caught up. See `docs/ROADMAP.md` for the always-current, fuller list.)

- **Taking a real payment.** Stripe billing itself is fully built and
  running today — just in test mode (see "Billing, statements, and late
  fees" above). No real money moves until you decide to switch it on.
- **Text preferences and STOP/START/HELP.** In Account → Settings, customers
  can independently agree to rental-related transactional texts. The form now
  shows the exact terms, a privacy-policy link and a terms link; it does not
  enroll them in marketing. The owner must still enable an approved sender,
  obtain proper phone verification, and meet separate safety gates before any
  texts can be sent. STOP blocks a number, START is not marketing consent, and
  changing phone numbers does not carry permission over.
- **Texting (SMS) notifications.** Fully built and ready, dormant until
  your business's required texting registration with Twilio (A2P 10DLC)
  is complete — a carrier requirement, not something in the app to fix.
- **Combining a property manager's several properties into one Stripe
  charge.** Each property still bills separately today; a combined
  statement across all of them already exists (see above), but the
  actual charge isn't consolidated yet. Not urgent until you have a real
  property-manager customer.

## What to do if something breaks

1. Check `docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md` — it always says what currently works and
   what's known to be broken.
2. If the site is down or showing errors for customers, that should
   show up automatically in Sentry and you'd be alerted.
3. Otherwise, tell whichever AI is helping you exactly what you clicked
   and what happened — "it broke" is harder to fix than "I clicked
   Save on the pricing page and got a red error message."


## Launch list (preparing to open)

After this feature is merged, open **Launch list** in the owner menu.
The public signup page is `/launch`; this is an interest list, not a booking.
Use `/launch?utm_source=instagram` for your Instagram website link and
`/launch?utm_source=facebook` on Facebook to see which link brings signups.
The website accepts signups while emails are paused.

Before enabling emails, enter the valid business mailing address you want
shown in email footers and a business inbox you actually monitor for replies.
Read the three emails shown on that page, check Enable, and save. The first
email goes on the next daily run (10 a.m. Mountain daylight / 9 a.m. standard),
with the next two at least 3 and 4 days later. This is a finite welcome series,
not an automatic announcement of an opening date you have not set.

Uncheck Enable to pause. Turn off Prelaunch mode when ready to replace the
launch homepage with the normal rental homepage; that also closes signup
and pauses this prelaunch series. Use Stop emails if someone asks you to
unsubscribe them. They can also use any email's unsubscribe link themselves.

An email marked Needs review / sending may be in progress. If still there
after the daily run, check Resend's sending activity before resending anything;
uncertain/failed attempts intentionally stop to avoid duplicates. Ask your
technical helper to reconcile that attempt with the provider record; do not
reset the sequence or import the address again. SENT is provider acceptance,
not proof the email reached the inbox. No tracking pixels are added.

### Returning to an unfinished rental

After saving the customer and terms, the builder shows a **Resume saved builder**
link. Bookmark it to return to the same draft. Refresh restores saved appliances
and their actual monthly prices, including any term discount. Saved customer and
terms appear read-only; review them before adding equipment. If a save response
is lost, refresh the current builder link to check the saved result before trying
again. An agreement already sent for signature opens its agreement page instead.

### Reading Revenue and recorded payments

Estimated monthly and annual rates come from agreed rental prices; they are not
a forecast of cash or profit. Cash received lists each payment once (card
payments and payments you recorded yourself), even when one check paid several
invoices; any part not applied to an invoice shows as account credit. It may
include deposits, fees and tax. Refunds are shown separately, and a refund you
kept as account credit is marked because no cash left the business. Choose Cash
received or Invoice refunds, then This month (Colorado) or All recorded dates.
"This month" is the Colorado calendar month. Totals include every matching
record; the list shows 25 per page. Each row links to the customer's statement
and to the exact invoices it paid. No costs are deducted, so this report does not
establish profit. (The six-month rate trend still groups by UTC month.)

### Reading a customer statement

Open a customer's statement from Billing. Under the totals, "How this balance adds
up" shows: carried forward + billed − payments applied − account credit applied −
written off = balance owed. Draft and voided invoices are left out, and a
written-off invoice no longer counts as owed. Refunds are listed beside the
balance because they do not reopen an invoice. If the numbers cannot add up (for
example, an old payment with no record), a yellow warning tells you to review the
invoices. The statement's CSV ends with the same summary lines.

### Deposit amounts in the accounting CSV

The CSV counts cash from each payment (receipt) once, with its record ID and where
it came from (card/Stripe or recorded by you), using the Colorado date. A refund
you kept as account credit is labeled "Refund to account credit".
The CSV counts cash from successful invoice payments once. Those payments
already include any signing or estimate deposit. A deposit record on an
agreement is a liability record, so it does not add another positive cash row.
Invoice refunds and returned deposits appear as separate negative amounts.
Keep using the agreement's deposit details to review the remaining liability.


### Assigning and tracking follow-ups

Open Tasks to add a note, optional date, priority and team member. Team shows
shared work; Mine shows work assigned to you; Unassigned shows work needing an
owner. Use Edit task to change the note, date, priority or assignee. If someone
else saved first, your draft stays on screen: copy it before reloading, then
apply it to the latest task. Done moves a task to Completed, where Reopen brings
it back. Tasks created on a customer or lead stay linked to that record. The
Make this a task button turns the current note text into a linked follow-up;
it does not send a message or save a separate contact-history note.

## Finishing a visit (completing a job)

Open the job and press **Complete job**. For every appliance on the visit, pick what happened (the usual result is already chosen). Set the **date the work was done** if you are recording it a day or two late; billing counts from that date. If something did not go as planned (an item not delivered, not picked up), a follow-up task is created for each one. The appliance page now has a **Who has it** panel showing which customer has the appliance and since when; a unit whose location we cannot work out from history shows up on Today as "Custody unknown" so you can fix it by hand. The driver screen's "Mark complete" takes the driver to the job page, since every item needs a result.

**An item that did not arrive.** On the job page, "Items not delivered on this
visit" lists what is still missing. The customer keeps being billed for the whole
set and gets a credit for the missing days when it arrives. If you have another
unit of the same type, "Send a different unit of the same type instead" sets it
aside for a later delivery visit. If the item will never arrive, "Never delivered
— take it off the agreement and refund it" refunds what the customer paid for it
(its share of the monthly price plus its tax) and lowers the customer's monthly
price from the next billing period, so it is not billed again. Payments made
through Stripe go back to the same card or bank. If the customer paid by cash or
check, or paid in advance, the line says how much you need to pay back by hand.
A refund Stripe could not finish shows as unfinished on the Billing check screen. Stripe is
updated right after; if Stripe cannot be reached the line says "Cancelled —
Stripe update pending" and the system keeps trying. Taking off the last item
cancels the agreement.

## Automations and recorded messages

Open **Desk → Automations** to see whether each scheduled business pass is healthy, failing, unknown, never run, paused, or unconfigured. “Never run” and “unknown” do not mean success. Pausing a rule is an owner action and is audited; do not use pause/resume as a substitute for checking why a provider failed.

Owner/admin Customer and Lead records include a **Messages** panel. It shows the business template, email/text recipient, request time and the durable delivery state. “Accepted by provider” is not the same as “Delivered.” “Not sent,” “Failed,” “Outcome unknown,” “Bounced,” “Spam complaint,” and “Suppressed” mean exactly that; do not tell a customer a message was sent unless the recorded state supports it.

For provider trouble, follow `docs/runbooks/PROVIDER-OUTAGE.md`. In particular, never resend an unknown-outcome message just because the provider dashboard is temporarily unavailable.

### Money → Sales tax — overview (T-7D)

Start on Overview to review missing setup decisions, the next return and
due dates. Use Returns for the guided worksheet, copy values and recorded
official confirmation; Areas to review failed/unknown lookup evidence;
Exemptions for customer certificates; What's taxed for CPA taxability
decisions; and Setup for filing accounts, license data and policies.
Administrators may review; only the owner records filing/payment and edits
tax policy. Appliance Desk does not file government returns or send tax
payments. Confirm all legal/CPA settings and real production evidence
separately before activating billing.


### Purchase tax on appliances (W-0A)

Open **Tax → Setup → Your business address (for tax on things you buy)**.
Enter the private address, save the settings, choose **Look up tax areas**, and
review and confirm the tax areas. A lookup by itself does not approve the result.
After changing the address, look up and confirm again. You must also record
your short-term rental purchase-tax election and review each applicable area
rate before the system can calculate use tax on appliances you purchased.

In **Inventory**, open each appliance's **Tax when this appliance was purchased**
panel. When the purchase-tax status is unknown, the panel explains what's
missing and links to the relevant fix. The system retries saved answers after
setup corrections and in its daily catch-up without assuming any tax exemption.
If Today says **Use tax owed with nowhere to file it**, open **Tax → Setup →
Filing accounts** and link the area to a use-tax account. An open return for
the applicable period can then include the unpaid tax. This is preparation,
not government filing or a payment authorization.


### SMS templates and day-of reminders (COM-L6A)
Open Owner Desk → Settings → Notifications for current SMS template and
standard visit reminder previews. It shows examples, conservative variable
lengths and segment counts. Carrier pricing remains unknown. These previews
do not send messages. The old automated day-of reminder sender is safely
held until COM-L6B supports authenticated owner review, verified customer
contact, specific job context and sender-scoped consent. No job is marked
texted until a real message is successfully accepted by a provider.


### Communications inbox (COM-L6B)
Open Owner Desk → Communications to review signed-provider SMS inbox
threads. Filter by status, verified/ambiguous/unresolved identity and
assignment. Open a thread to read only that private conversation, mark
reviewed through the last displayed message, assign a staff member or
move the case to WAITING/CLOSED. Staff see only their assigned threads;
another employee's read action does not clear your unread marker.
Changing a workflow status never confirms a provider send or legal notice.
The reply/send button is intentionally absent: provider activation and
verified sender, contact identity, purpose-specific consent and job
context must be approved separately. Ambiguous numbers have no automatic
link to customer records.


### Future calling and voicemail (COM-L7)
A private database foundation now exists for business calls, forwarding
legs, and voicemail metadata, but **calls, recordings and transcription
are not enabled**. No call button or media download is available from
this slice. Storage paths and provider recording IDs are never shown to
customers. Owner/admin can later review retention deadlines and holds
when the approved voice workflow is implemented. Media removal requires
the provider copy, private stored copy and backup copies to be handled
and confirmed; an expired date alone does not delete anything.

## Website campaign statistics
Metricool can show public website visits alongside social activity after MKT-1 is
released and its production tracking identifier is configured. Campaign links use
source/campaign/post labels. Visits and clicks are not confirmed inquiries or rentals.
Review the updated privacy page through the existing legal-page approval control.
Removing METRICOOL_TRACKING_HASH in Vercel and redeploying disables visit tracking.

### Draft signing tax review (W-22C3)

On an unsent rental agreement, the owner-only preparation section can show
private setup-fee tax candidates for each related property. This does **not**
mean the charge is approved, due, collected, sent or locked into a contract.
If the tax rule or jurisdiction lacks CPA-confirmed evidence, resolve that
outside the draft workflow before a final, tax-inclusive agreement can be
implemented. The CPA question IN-79 remains open.

### Order-wide draft signing review (W-22C4)

The owner can view a private, all-location signing-cost candidate after all prepared charges and tax evidence reconcile. This includes setup fees, separately calculated setup tax, and first-month down payments. It is NOT a customer bill, signed contract or payment authorization. CPA gate IN-79 and final freeze/send/checkout remain open.

## Recording a signing payment by check or bank transfer (W-22D13)

On Desk > Agreements > a signed agreement, OWNER or ADMIN reviews the
exact frozen signing amount and may enter a check, bank transfer or cash
payment ONLY once that money was actually received. Record the business
date and reference, confirm receipt explicitly, then record. If a
Stripe payment is pending, investigate instead of recording another
payment. A matching retry returns the original receipt; a changed
reference or conflicting attempt is denied. The down payment belongs to
this agreement's first invoice, not other properties. STAFF and
customers have no access to this owner-only action. LIVE charges and
refunds have separate approvals.

### Review a complete signing order

On the agreement, review every location and the combined frozen amount. For a
complete V2 order, **Signing business clearance** lets only the owner record CPA
and attorney advice actually received, the exact terms reviewed, confirmation
and effective dates, and a reason. Keep **Review required** selected until advice
exists. A new review revision preserves history; changing the order requires new
review. Approval does not enable Stripe LIVE, public pricing, customer messages,
or a refund. Administrative setup tax still needs its independent Settings
classification and jurisdiction evidence.

If settings, tax evidence or unsigned terms change, the owner can **Reopen
unsigned order for review** with a reason. This applies only to complete draft
orders with no signature, payment, invoice, deposit or delivery job and an
editable source estimate. The prior frozen evidence stays in the audit history.
Prepare, review and freeze the new version, then record fresh clearance; an old
clearance cannot authorize the new amount. Signed orders cannot be reopened.

A negotiated refundable commercial reserve is part of the signing amount; do
not collect a separate estimate deposit for it. Receipt readback distinguishes
unpaid from received and shows the additional categories. For before-delivery
cancellation, review the complete original receipt and refund terms. The reserve
stays held until the actual approved return is separately recorded and verified;
use that cancellation return, rather than the standalone deposit-refund button.
