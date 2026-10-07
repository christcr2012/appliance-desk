# Sales tax, bookkeeping and owner controls — the plan in plain English

Written 2026-10-06 for Chris. The detailed build instructions (for the AI that does the building) are in
`docs/designs/BATCH-G.md`, `BATCH-T.md`, `BATCH-K.md` and `BATCH-O.md`. Nothing here is built yet, and nothing here is
tax advice — your CPA confirms every tax answer before customers are charged.

## What gets built, in order

| Batch | What it gives you | When |
|---|---|---|
| **G** — Quick fixes and login security | Closes the 2 known security holes, fixes the cancelled-rental report bug and the dark-mode contrast bug, adds a phone code to your login (and your admins'), lets you sign people out of every device. | Small; as soon as you approve it. |
| **T** — Colorado sales and use tax | Correct tax for every customer's exact address, the right rules for rentals, the right numbers for your state and Greeley returns, use tax on appliances you buy without tax. | Before your first real customer. **Required for launch.** |
| **K** — Books | Expenses (with receipt photos from your phone), Stripe fees and payouts, real profit-and-loss, appliance payback, cash forecast, and files that load into QuickBooks Online, Xero, Wave, Zoho and others. | Can be after launch — it builds your books automatically from any start date you choose (launch day is the natural one). |
| **O** — Owner controls | Undo for settings changes, per-person permissions, "refunds over $X need my OK", price changes with a start date, goals and idle-appliance alerts, one page showing every on/off switch. | After K. |

Suggested order (updated later on 2026-10-06; the full list is `docs/MASTER-ROADMAP.md`): **F part 1 (backups and
runbooks) → G → T → V (the premium redesign) → F part 2 (final launch proof) → launch → K → O.** You can move K before
launch if you want the profit numbers sooner.

## The three big tax facts I found

1. **Colorado's state rule for rentals could mean you charge less tax than you think.** Under Colorado law (C.R.S.
   39-26-713), a rental of 3 years or less is exempt from *state* sales tax if you paid sales or use tax when you
   bought the appliance. The other option is to buy appliances tax-free (with the state's permission) and charge tax on
   every rent payment. You must pick one. This is the most important question for your CPA.
2. **Greeley plays by its own rules.** Greeley is a "home-rule" city. It collects its own 4.11% city tax, taxes rentals
   no matter which state option you choose, and isn't part of the state's SUTS filing website, so you file Greeley
   separately. Customers in Evans, Windsor or unincorporated Weld County get different rates — sometimes very different.
3. **The 7.375% example in your notes (IN-17) doesn't match what I can find.** Public sources say Greeley is 7.01% (2.9% state +
   4.11% city). Under option 1 above, a Greeley customer might pay only the 4.11% city tax on rent. Your CPA should
   check this, and the app will stop guessing either way.

## Should we use Stripe's tax tool? My recommendation: **no — Stripe collects, the app calculates**

You have three choices:

| Choice | Cost | Problem |
|---|---|---|
| Stripe Tax (automatic, through the code) | About 0.5% of every taxed payment, on top of Stripe's normal fees | Stripe can't know whether you paid tax when you bought each appliance, so it can't apply the state rental rule without manual overrides for every area. Your app's own bills (late returns, early returns) would be calculated by a different system than Stripe's monthly bills, and the two would disagree. |
| Turn tax on in Stripe's dashboard | Same product, same 0.5% | Same problems. |
| **The app calculates, using Colorado's free address lookup, and tells Stripe the exact rates (recommended)** | Free | The app has to keep rates current. The design handles that with reminders before the January 1 and July 1 rate-change dates, automatic re-checks, and updating Stripe the day before a change starts. |

Revisit this if you ever sell appliances outright, expand outside Colorado, or end up serving lots of different tax areas.

## How the tax system works (Batch T)

- **Every customer address gets looked up** in Colorado's own tax-rate database (free, from the Department of Revenue)
  for the exact list of tax areas — state, county, city and special districts. ZIP codes are never used to guess.
- **You decide, once, what's taxable** in a simple grid: rent, delivery, installation, removal, damage waiver,
  early-ending fee, late fees — for "all state-run areas" and separately for each home-rule city like Greeley. Every box
  starts as "Not decided yet", and the app **won't bill anyone** until the boxes it needs are filled in. There's a button
  that fills in common Colorado answers for you to take to your CPA, and a "CPA confirmed" date for each box.
- **Stripe charges exactly what the app calculated.** If Stripe's number ever differs by even a cent, you get a warning.
- **Tax-exempt customers** (resale, government, charities) keep a photo of their certificate on file, with an expiry
  reminder.
- **Returns (updated 2026-10-07):** Greeley, Evans and Windsor take returns through **SUTS**, so one SUTS session
  covers the state, Weld County and those cities. For each return the app shows an **entry packet**: every number to
  type, area by area in the same order as the SUTS screens, each with a copy button, plus a short "In SUTS, do this"
  checklist and the total to pay (or "file a zero return" when nothing was sold). It keeps a **filing calendar**
  (monthly, quarterly or yearly, license renewals too), reminds you on Today and by email from the day a period ends
  until you press "I filed it", and gives you a calendar file for your phone. An unfiled return sits on **Today** as a task you cannot dismiss; tap it
  and a step-by-step "File this return" page walks you through check → open SUTS → type these in → pay → confirmation. Once a period is marked filed its numbers
  never change; if something in a filed month changes later, the app prepares an **amended return** for that month and
  puts "Amend your September return" on Today. The app never logs in to SUTS or moves money — SUTS has
  no filing connection for small businesses — so the last step (typing, paying) stays yours.
- **Use tax:** when you buy an appliance from a private seller or an out-of-state store without tax, the app works out
  the use tax you owe the state and Greeley and puts it on the right return.

### What you need to do for Batch T

1. Register on Colorado's **SUTS** website (if you haven't) and get the free **GIS API key**. I'll give you click-by-click
   steps when we start. Copy the key into Vercel yourself — never paste it into a chat.
2. Take the questions below to your CPA.
3. Enter your Colorado sales tax license number (and a City of Greeley number only if Greeley gave you a separate one)
   in the app, then tell me what your SUTS return screen lists (IN-43).

## Questions for your CPA (copy this list)

These are tracked as IN-33 to IN-39 in `docs/OWNER-INPUTS.md`.

1. **(IN-33) Rental option:** Should I (a) pay sales or use tax when I buy each appliance, so rent is exempt from state
   and state-run local tax, or (b) buy tax-free with the state's permission and charge tax on every rent payment? (C.R.S.
   39-26-713; also, does the Department's draft "Special Rule 47" from February 2026 change anything?)
2. **(IN-34) What's taxable** — in state-run areas and in Greeley (and any other home-rule city I serve): rent, late-return
   rent, delivery fee, installation fee, removal fee, damage waiver, early-ending fee, late-payment fee? And when I give a customer a credit (for example, an item delivered late), should that lower the taxable rent, or is it just money credited to their account?
3. **(IN-35) Cash or accrual** reporting for my state and Greeley returns? Monthly, quarterly or annual filing?
4. **(IN-36)** If one customer keeps the same appliance more than 3 years through renewals, does the rental rule change?
5. **(IN-37) Retail delivery fee:** does Colorado's per-delivery fee apply to me (given the small-business exemption under
   $500,000 a year and that rentals may not count as taxable deliveries)?
6. **(IN-38)** My rental agreement will say "sales tax for your address, currently X%" instead of a fixed rate — is that
   fine? (Also ask your attorney.)
7. **(IN-39)** When I write off a bill a customer never paid, can I take back the sales tax I already reported on it?
8. **(IN-17, still open)** Is the Greeley combined rate 7.01% (2.9% + 4.11%)? (Some 2026 rate sites show a higher
   combined rate with a special district; the app uses the state's address lookup, but please confirm.)
9. **(IN-44) Reporting non-taxed amounts on SUTS:** rent that is exempt under the short-term lease rule, sales to exempt
   customers, and charges that are not taxable — do I include them in gross sales and deduct them (under which
   deduction name), or leave them out of gross sales?
10. **(For Batch K)** Are 60-month straight-line depreciation and "expense parts when bought" fine for my own profit
   reports? And is $2,000 the right 1099 threshold for 2026?

## How the books work (Batch K)

- The app keeps **proper double-entry books** behind the scenes, built automatically from things it already records
  (bills, payments, refunds, deposits, credits) plus new things: **expenses** (snap a receipt photo; your staff can submit
  fuel and supply receipts for you to approve), **Stripe fees and payouts** (pulled from Stripe every night), and
  **depreciation** on your appliances.
- **Profit & loss** by month, in either "cash" view (when money moved) or "accrual" view (when it was billed), compared
  with last month or last year. You can click any number to see where it came from.
- **Appliance payback:** what each machine cost, what it has earned, its repairs, and when it pays for itself. Machines
  whose repairs eat too much of their rent get flagged.
- **Cash forecast** for the next 90 days, and a **year-end package** for your CPA (profit by month, appliance list with
  depreciation, tax filed, 1099 vendor totals).
- **Accounting exports:** files for **QuickBooks Online**, **Xero**, a general format for **Zoho Books, FreshBooks and
  others**, and a bank-style file for **Wave**. By default it's one tidy summary entry per day, so your accounting
  software doesn't need every customer copied into it — the app stays the place for customer details. You tell the app
  what each account is called in your QuickBooks once, and every export after that just works. Each file can be
  downloaded again exactly as it was.
- **Later (needs your OK then):** connecting directly to QuickBooks Online so you don't download anything. Sending data
  to QuickBooks is free under Intuit's current developer program; reading data back is metered. It's better to use the
  files for a few months first.

## How the cheaper model builds this

Each design is written so a cheaper model (for example Sol 5.6) can follow it literally. Every decision is already made.
It lists the exact database changes, function names, files, the order of the work, the named tests that prove each rule,
and "stop and ask" points where the model must come back to you instead of guessing. Tax answers are never written into
the code — they're settings you fill in. When a design is approved, paste this into a new session with the model you
choose:

> Read AGENTS.md, docs/START-HERE.md, docs/STATUS.md, then docs/designs/BATCH-<letter>.md in full. Do the design drift
> check (section 0 of the design and docs/designs/README.md). Then build the work units in order as a stack of PRs, one
> PR per group the design names, following docs/PLAYBOOK.md. Do not re-decide anything in the design's Decisions
> section, do not add anything it does not name, and stop and ask me at every stop-and-ask point. Never enter a tax rate
> or tax answer yourself. Report to me in plain English after each PR.

## What I need from you now

1. ~~Approve the designs~~ — **done 2026-10-06** ("I love all of this! Update the repo!").
2. **Book a CPA conversation** with the question list above. Batch T can be *built* before the answers arrive (everything
   starts as "Not decided yet"), but no customer can be billed until they're entered.
3. **Register on SUTS** and get the free GIS API key when you're ready (Batch T step T0).
