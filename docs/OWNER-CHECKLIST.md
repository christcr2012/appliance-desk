# Chris's checklist — everything only you can do

Created 2026-10-23 as the **one** place for owner-only work. Go top to bottom; tick a box only after you see the
"you'll know it worked" result yourself. **Nothing here blocks the building, reviewing or merging of the app** — the
software keeps getting finished while these wait. Agents add rows here instead of stopping to ask you, and agents
**never tick a box for you** or write "passed" without a real observation.

How to read a row: **What** · **Steps** · **Ready when** · **You'll know it worked**.
More detail for some rows: [GO-LIVE-CHECKLIST.md](GO-LIVE-CHECKLIST.md) (long reference, same facts) and the decision
IDs (IN-xx) in [OWNER-INPUTS.md](OWNER-INPUTS.md). The agents' machine-readable list of 22 post-release checks stays in
[STATUS.md](STATUS.md) (between the `release-acceptance` markers); section C below is its plain-English version.

## A. Quick things only you can do (minutes each)

- [ ] **Vercel: make the website follow the `live` branch (IN-68).** Steps: Vercel → project *appliance-desk* → Settings →
  Environments → Production → Branch Tracking → choose `live` → Save; also turn automatic Preview deployments off.
  Ready when: now (`live` exists). You'll know it worked: Branch Tracking shows `live`.
- [ ] **Colorado tax-rate key (IN-61, about 10 minutes).** Steps: sign in to SUTS → "Sales Tax Rates" menu → "GIS API Key" →
  pick the business → copy the API documentation text shown at the bottom of that page and give it to the agent (not the key).
  Save the key itself in Vercel as `COLORADO_GIS_API_KEY` (Production and Preview) — never in a chat, email or GitHub.
  Ready when: your LLC, federal EIN and Colorado sales-tax license exist and you can sign in to SUTS (not before). You'll
  know it worked: new customer addresses get a tax rate automatically instead of "review this address". Until then the
  app keeps asking you to review each address, which is safe.
- [ ] **Ask Colorado to approve your tax-return upload (IN-62).** Both the XML upload and the Excel upload need Colorado's
  approval first. Steps: send the one email text in OWNER-INPUTS IN-62 to DOR_LocationFilers@state.co.us (they answer in
  about 5–7 business days; the Excel template has 48 columns). Ready when: you have a sales-tax license. You'll know it
  worked: you have their written answer; tell the agent. Until then you file by typing the numbers into SUTS from the
  return packet the app prepares.
- [ ] **Receipt scanning (W-13) is OFF.** Reading photographed receipts needs an outside service that costs money per
  receipt, so the app doesn't turn it on by itself. Tell the agent if you want it, and which price you're comfortable with.
- [ ] **Enter your SUTS details in the app (IN-43).** Steps: Desk → Money → Sales tax → Filing accounts → SUTS setup (tax
  areas and codes in your return's order, license number, filing frequency, expiry, deduction names). Ready when: you
  have registered on SUTS. You'll know it worked: the return packet matches your SUTS return.
- [ ] **Two-step login on every owner/admin account.** Steps: sign in, enroll, store backup codes away from your phone.
  Ready when: now. You'll know it worked: next sign-in asks for the code.
- [ ] **Look at the rollback button once (do not use it).** Steps: Vercel → find Instant Rollback and the previous production
  deployment ([runbooks/ROLLBACK.md](runbooks/ROLLBACK.md)). You'll know it worked: you can point to both.

## B. Before real customers (money, email, texts, legal, accounts)

Order matters: tax answers → money → email/text → the rest. "Live" switches never happen unless you say so in writing.

- [ ] **Start your business paperwork list (5 minutes, then as things happen).** Steps: Desk → More → Business paperwork →
  "Set up my starter checklist". As you form the LLC, get your federal EIN and the Colorado sales-tax license, open each item,
  type the number and the next renewal date from your own papers, and set where you are with it. Worked: each dated item
  shows on your Today list before it needs renewing. (The app doesn't know your dates or fees; they come from your papers
  and the agency websites linked on each item.)
- [ ] **Stripe account verified for live payments** (business details, bank). Stripe dashboard. Worked: "Live payments enabled".
- [ ] **Stripe branding** (name Robinson Appliance Rentals, logo, colors, support phone/email, card-statement name).
  Stripe → Settings → Business → Branding. Worked: a test checkout page shows your brand.
- [ ] **Stripe confirms phone (card-not-present) payments are allowed on the live account** (IN-82, W-5). Stripe dashboard/support.
  Worked: Stripe says yes; a test-mode "Take payment by phone" marks the bill paid.
- [ ] **Live Stripe key and webhook in production** (IN-08). Vercel `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, webhook URL
  `<site>/api/webhooks/stripe`. Ready when: you decide to go live. Worked: a real $1 payment shows paid within a minute; refund it.
- [ ] **Sales-tax answers from your CPA** (IN-17, IN-33–IN-38, IN-44, IN-65, IN-79; early-ending fee IN-25): enter them in
  Desk → Money → Sales tax until every rule shows "CPA confirmed". Until then **do not bill real customers.**
  (What to ask is written in each IN row in OWNER-INPUTS.)
- [ ] **Tell the app whether shop sales are taxable** (IN-46, IN-79). Desk → Taxes → "What gets taxed": for "Items sold" and
  "Used appliance sale", choose taxable or not for each tax area and enter the date your CPA confirmed it. Until you do,
  every shop sale is refused with that reason (rentals are not affected). Worked: Desk → Money → Shop sales → New sale saves.
- [ ] **CPA, not a launch blocker:** IN-39 (bad debt, 60-month depreciation, 1099 threshold), IN-46 (shop sales, resale
  certificate, scrap), IN-56 (retired-appliance tax basis), IN-71 (record retention — starts at 7 years).
- [ ] **Attorney: rental terms, early-ending/auto-renew wording, month-to-month notices** (IN-07, IN-21, IN-31); privacy
  policy, terms of use, accessibility statement approved; customer text-consent wording; 3-day cancellation rule only if
  you ever sign people up at their home. Worked: written approval saved before automatic renewals or live notices turn on.
- [ ] **Email going live:** Resend domain verified (DNS), `RESEND_API_KEY`/`RESEND_FROM_EMAIL` in Vercel Production, staff alert
  addresses set, webhook `/api/webhooks/resend` + `RESEND_WEBHOOK_SECRET`, then read every customer message wording; only
  then turn on Desk → Settings → Notifications → "Send emails to customers". Worked: a test email arrives from your address.
- [ ] **Text messages going live (IN-03, IN-09, IN-51–IN-53):** pick and buy the local Twilio number (you approve the
  purchase), finish carrier/campaign registration, set the Twilio keys in Vercel, register `/api/webhooks/twilio`, set
  the real forwarding phone and hours. Voicemail/recording stay OFF until you approve wording and retention (IN-52).
  Worked: a test text from the app reaches your own phone; STOP is respected.
- [ ] **Real business details** (name, phone, email, address, hours, service area) in Desk → Settings; choose a lawful public
  mailing address that is not your home (IN-01); confirm `support@` reply-to works end to end (IN-02);
  `BETTER_AUTH_URL` set to the real domain and emailed links checked.
- [ ] **Accounts and platform:** your real owner login works and test/seed accounts are removed from production (with your OK);
  `BETTER_AUTH_SECRET`/`CRON_SECRET` are long unique values; nightly jobs show green history in Vercel Cron; private photo
  storage tokens set; a daily backup restore was rehearsed (agent does it, you read the proof).
- [ ] **Spanish (IN-83):** a fluent reviewer you trust checks translations; attorney approves the controlling agreement text.
- [ ] **Launch day, in this order:** every box above ticked or marked "skip for now"; automated checks green on the exact
  version; one real $1 payment, a refund, a renewal reminder and a customer login tested; then you say "launch" in writing.

## C. Real-account checks after a release (the agents' 22 acceptance rows, plain English)

Ready when: the version has been promoted to `live` by the daily job (check `live` contains the PR in question) **and**
you can sign in as owner. Use your own account; do not touch real customers' data beyond looking.
Agents will do the parts they safely can and record what they saw; the rest needs your sign-in, a customer, or Stripe TEST.

- [ ] **W-22 / order-and-signing money flow** (STATUS ids `DESK-W22`, `W22FIN-*`): with an existing customer and your owner
  login, confirm the signing amount matches in Rentals and Desk; a signed unscheduled delivery shows "being arranged";
  delivery start needs the signed proof and customer receipt; a two-location order reads correctly; failed/pending
  signing payments show a clear response; mandatory-charge policy and estimate readback look right; a complete order
  works from quote through cancellation. Worked: each screen shows what the row says, in plain words.
- [ ] **Communications** (`DESK-COMMS`): reconcile what actually works in the deployed text/email/phone features before
  switching anything on. Worked: nothing sends to customers unless you switched it on.
- [ ] **Customer portal receipt** (`APPLIANCE-W22-PORTAL-RECEIPT`): a signed customer sees only their own receipt; someone
  else's receipt is refused.
- [ ] **Tenant/privacy and imports** (`W23-*`): retention defaults OFF, holds work, other customers' contacts are refused,
  a spreadsheet import dry-run and replay behave.
- [ ] **After any "delete my data" request, also remove the customer in Stripe by hand.** The app clears the customer's
  name, email, phone, address and launch-list entry, but does not call Stripe for you (that would be a live action on
  your real account). Steps: Stripe dashboard → Customers → find the person → delete. Ready when: you fulfil a real
  deletion request. You'll know it worked: the customer no longer appears in Stripe (past payments stay for your tax records).
- [ ] **One-link order and phone orders** (`W24-*`, `W25-*`): the customer one-link quote→signature→Stripe TEST payment→portal
  works; driving-distance pricing for 15/30/50 miles; phone-draft prefill; the support@ inbox receives and an
  authorized reply goes out; phone routing and the $20 notice thresholds.
- [ ] **Books and cash budgeting** (K, K-CASH-1…7): with your CPA/bookkeeper, compare the app's reports and exports with
  your real bank statements, Stripe and a trial accounting company (QuickBooks free edition preferred — IN-54); pick the
  real bank and record opening balances (IN-55); only then, separately, decide the date to turn on budget funding
  (it stays OFF). Compare one real month of published plan vs actual (K-CASH-7).

## D. Other people's systems (trial companies, provider reviews)

- [ ] **QuickBooks trial company import** of a month of DETAIL CSV journals: counts and debits/credits balance, bank
  matches (K-5, K-CASH-6). Ready when: you have a trial company and a released export.
- [ ] **Xero** (only if you choose it): organization tax-rate names and holding accounts mapped.
- [ ] **Twilio / carrier registration** and **Resend / Stripe account reviews** as described in section B.
- [ ] **Metricool:** confirm a real visit shows up; review the updated privacy-page version; compare to interest-list signups.
- [ ] **Stripe balance import (K-3):** approve `BOOKS_STRIPE_SYNC_ENABLED=true` for production only after you have checked
  the opening date and balances.

## E. Optional / later (no action until you want it)

IN-10 real photos you are comfortable publishing · IN-11 genuine reviews with permission · IN-13 staff roles when you hire ·
IN-14 first portfolio account requirements · IN-45 AI morning check-up key · IN-48/49/50 partner, offer and permission
programs (proposed, not built) · IN-64 receipt-photo scanning (deferred) · IN-05 launch date (hoped for November, depends
on readiness).

## Log of rows added by agents

| Date | Row added | Why |
|---|---|---|
| 2026-10-23 | Business paperwork list | Chris asked for one place for LLC/EIN/licenses with renewal reminders (built in the app). |
| 2026-10-23 | Whole file created | Consolidated from GO-LIVE-CHECKLIST, OWNER-INPUTS and the STATUS acceptance list. |
| 2026-10-23 | Shop-sale taxability answers | Shop sales are refused until the owner records taxability for items sold and used appliance sales. |
