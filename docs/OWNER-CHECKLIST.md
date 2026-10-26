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
  Ready when: now. You'll know it worked: next sign-in asks for the code. (Chris said on 2026-10-23 he already uses the
  authenticator app; tick it yourself if every admin has it too.) Once ACC-1 is built: Desk → My account → Two-step →
  add a **second** method and make fresh backup codes kept off your phone, so a lost phone never locks you out.
- [x] **Decision: may you and your admins use email sign-in codes? (IN-85)** Answered 2026-10-23 in chat: **no** (text
  codes or the app; staff may use any method). It's a setting you can change later.
- [x] **Decision: when should accounts and sign-in (ACC-1…ACC-5) be built?** Answered 2026-10-23 in chat: **right after
  O-2B** (the admin-limits piece now in review).
- [ ] **Look at the rollback button once (do not use it).** Steps: Vercel → find Instant Rollback and the previous production
  deployment ([runbooks/ROLLBACK.md](runbooks/ROLLBACK.md)). You'll know it worked: you can point to both.

- [ ] **IRS filing code for 1099s (IRIS TCC, about 20 minutes, free).** Needed before your first 1099s (due Jan 31
  after a year you pay a contractor $2,000+). Steps: irs.gov/iris → "Apply for an IRIS TCC" → sign in with ID.me → choose
  "Taxpayer Portal" for the business. Ready when the app's Compliance screen shows the 1099 upload file (CMP-3). Worked
  when IRS shows the TCC as active. Later, for filing straight from the app: apply for an **A2A** TCC the same way.
- [ ] **Encryption key for tax ids (about 5 minutes).** When CMP-1 ships, add `COMPLIANCE_ENCRYPTION_KEY` (the app's
  setup page shows how to make one; 32 random bytes) in Vercel → Settings → Environment Variables (Production and
  Preview). Never paste it in a chat or GitHub. Worked when Compliance › Business facts lets you enter your EIN.

- [ ] **Vault encryption key (about 5 minutes).** When VAULT-2 ships, add `VAULT_ENCRYPTION_KEY` (a different key from
  the compliance key; the Set up your business guide shows how to make one) in Vercel → Settings → Environment
  Variables (Production and Preview). Never paste it in a chat or GitHub. Worked when Business › Logins lets you save
  one login.
- [ ] **If you have no employees: send the workers' comp rejection form (Colorado).** As an LLC member you may reject
  coverage by sending the state's form by certified mail (C.R.S. 8-41-202). The Insurance screen (OPS-4) will hold the
  date and the certified-mail number. Worked when the Division or your insurer confirms.

- [ ] **Before your first 6- or 12-month household rental: Colorado consumer-lease notification (UCCC).** Colorado
  asks businesses that make consumer leases (household rentals over 4 months) to file a notification with the UCCC
  administrator (Attorney General) within 30 days and every July 1 (C.R.S. 5-6-202; fee set by the state). Ask your
  attorney first (Decisions question FEE-UCCC-FILING). Then enter the day it was filed in Settings › Colorado consumer lease filing; the rental wizard warns until you do.
- [ ] **Ask Greeley Sales Tax in writing how it taxes rentals and fees.** The app drafts the email (Settings › Taxes →
  "Email Greeley"): does Greeley tax rentals of 36 months or less when you paid tax buying the appliance, and are
  optional, separately listed delivery, installation, pickup and haul-away charges taxed? Send it from your own email to
  Greeley.SalesTax@greeleygov.com (or call 970-350-9733). Ready: you have their written reply. Worked: you record the
  answer on Taxes › Rules and the questions FEETAX-GREELEY-* show "Confirmed". Until then the app taxes them (safe side).

- [ ] **Install the desk app on your phone (AR-11).** Steps: after the full AR-11 card is merged and the nightly testing release runs, open the testing app's `/desk/today` in Chrome (Android: Install app) or Safari (iPhone: Share → Add to Home Screen). Worked when the round green R opens Today without browser bars, navigation never flashes blank, and Android icon long-press shows New quote, Take a payment, Today's route and Add an expense. Not ready until all AR-11 work is merged.

## B. Before real customers (money, email, texts, legal, accounts)

Order matters: tax answers → money → email/text → the rest. "Live" switches never happen unless you say so in writing.

- [ ] **Start your business paperwork list (5 minutes, then as things happen).** Steps: Desk → More → Business paperwork →
  "Set up my starter checklist". As you form the LLC, get your federal EIN and the Colorado sales-tax license, open each item,
  type the number and the next renewal date from your own papers, and set where you are with it. Worked: each dated item
  shows on your Today list before it needs renewing. (The app doesn't know your dates or fees; they come from your papers
  and the agency websites linked on each item.)
- [ ] **Fix the testing app's owner password so agents can sign in (about 5 minutes).** On 2026-10-24 your
  saved settings made the testing build fail at the "create test owner" step, so no test login exists yet (the
  testing site still runs the earlier build). Steps: Vercel → project **appliance-desk-testing** → Settings →
  Environment Variables → delete `TEST_OWNER_PASSWORD` → Add New → name `TEST_OWNER_PASSWORD`, a **new** password of
  **at least 16 characters** used nowhere else, environments Production, **leave "Sensitive" switched off** (agents
  must be able to read it to sign in; it only opens the fictional testing app) → Save. Then Deployments → the newest
  one → ⋯ → Redeploy. Never paste it in chat. Also confirm `STRIPE_SECRET_KEY` there was copied from the Stripe
  dashboard while **Robinson Appliance Rentals LLC** and **Test mode** were selected (it starts with `sk_test_`).
  Ready when: now. You'll know it worked: the redeploy shows "Ready". The agent can sign in as
  `owner@example.test` after that night's 10 pm testing update (10 pm Denver), which turns the testing-only phone
  step off.
- [ ] **Try the shop-sale card page in Stripe TEST mode (M-3).** Agent-run once the row above is done: the agent
  signs in to the testing app, makes a $1 test sale, pays it on Stripe's test checkout, checks it shows Paid once,
  refunds it and checks both systems. Nothing for you to do but read the result. Worked only when all of that is
  observed. **Leave unchecked until actually observed.**
  *Status 2026-10-24 (night):* an agent tried and could not run it: that session had no connected browser and its
  shell cannot reach the testing site, so nothing was signed in, paid or refunded (not tested, not failed). The
  password variable now exists in the testing project. To let an agent finish this, open the task in the Claude
  desktop app on your computer with Chrome open and the Claude extension signed in (or choose "Link to this
  computer"), then ask it to "run the M-3 hosted card test".
- [ ] **Lock the two "release" branches on GitHub so they can't be deleted or rewritten (about 3 minutes).** This is
  NOT the "automatically delete head branches" setting (that one is about old work branches and is already on). Your
  code has two special copies: `testing` (what the testing site runs) and `live` (what your real website runs). Today
  nothing stops someone with access from deleting or overwriting them, which would change the real website directly.
  Steps: github.com/christcr2012/appliance-desk → **Settings** tab → left menu **Rules** → **Rulesets** → green
  **New ruleset** button → **New branch ruleset** → Ruleset name `Release branches` → Enforcement status **Active** →
  in "Target branches" click **Add target** → **Include by pattern** → type `live` → Add; repeat with `testing` →
  further down tick only **Restrict deletions** and **Block force pushes** (leave the rest unticked so the automatic
  nightly releases keep working) → **Create**. You'll know it worked: Rulesets shows "Release branches" next to the
  existing "Ci and deploy" one.

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
- [ ] **Enter your answer that shop sales are taxable** (IN-46, IN-79). You told us everything you sell is taxable. Desk →
  Taxes → "What gets taxed": for "Items sold" and "Used appliance sale", choose **Taxable** for each tax area. The screen
  asks for the date your CPA confirmed it; the app cannot make that date up. Until it is entered, every shop sale is
  refused with a plain reason (rentals are not affected). Worked: Desk → Money → Shop sales → New sale saves with tax added.
- [ ] **CPA, not a launch blocker:** IN-39 (bad debt, 60-month depreciation, 1099 threshold), IN-46 (shop sales, resale
  certificate, scrap), IN-56 (retired-appliance tax basis: the used-appliance sale screen shows a tax estimate only from numbers recorded on Desk → Books → Assets; until your CPA confirms them it says "CPA review needed" and adds a To do), IN-71 (record retention — starts at 7 years).
- [ ] **Attorney: rental terms, early-ending/auto-renew wording, month-to-month notices** (IN-07, IN-21, IN-31); privacy
  policy, terms of use, accessibility statement approved; customer text-consent wording; 3-day cancellation rule only if
  you ever sign people up at their home. Worked: written approval saved before automatic renewals or live notices turn on.
- [ ] **Email going live:** Resend domain verified (DNS), `RESEND_API_KEY`/`RESEND_FROM_EMAIL` in Vercel Production, staff alert
  addresses set, webhook `/api/webhooks/resend` + `RESEND_WEBHOOK_SECRET`, then read every customer message wording; only
  then turn on Desk → Settings → Notifications → "Send emails to customers". Worked: a test email arrives from your address.
- [ ] **Text messages going live (IN-03, IN-09, IN-51–IN-53):** pick and buy the local Twilio number (you approve the
  purchase), finish carrier/campaign registration, set the Twilio keys in Vercel, register `/api/webhooks/twilio`, set
  the real forwarding phone and hours. Voicemail/recording stay OFF until you approve wording and retention (IN-52).
  Then, per kind of text (lead, estimate, signature): Settings → Phone, texts and provider costs → read and approve the wording
  and switch it on (all start OFF; COM-N1A). Worked: a test text from the app reaches your own phone; STOP is respected. **Calls from the desk (COM-N2, off):** after call routing works, each staff member confirms their own mobile in My account, then Settings → Phone, texts and provider costs → "Calls from the desk" → Switch on. Worked: pressing Call on a visit rings your own phone first; pressing 1 connects you to a test customer number. **When registering the campaign, include
  "one-time sign-in / security codes" as a use case** so sign-in texts are allowed. ACC-3 is built (text codes
  are off). Once texting is live: Settings → Security → tick "Send sign-in codes by text" and save (the Switches page then
  shows it), save your mobile phone on My account → check it with the text code → My account → "Second step" → switch
  to text codes. Keep your backup codes. Worked: your next sign-in texts you a code.
- [ ] **Have the three sensitive text wordings read by a lawyer (COM-N1C, optional until you want them on):** Settings → Phone, texts
  and provider costs → "Customer text messages": the friendly invoice reminder, the refund-issued text and the rental-ending
  text each stay locked until you click "Confirm a professional has read this wording". Worked: the switch-on button unlocks for that
  text only. (The other billing texts are not locked.) Changing the wording removes the confirmation.
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

- [ ] **Removed receipt files really leave storage** (older review findings): after the version is live, remove one wrong
  receipt page on a purchase that is allowed to lose a page, then 30 days later open Desk → Automations → "Stored file
  clean-up" and confirm its last run shows one file deleted. Agents tested the waiting list and the rules against a stand-in
  for the storage company; the real private store was not touched. Worked: the run shows "deleted" and nothing else is missing.

- [ ] **Add three payment events to your Stripe webhook** (test mode now, live later). Steps: Stripe dashboard → Developers →
  Webhooks → your appliance-desk endpoint → Update details → Select events → add `payment_intent.processing`,
  `payment_intent.payment_failed`, `payment_intent.canceled` → Update endpoint. Ready when: BILL-1 is merged. Worked if: a
  test bank payment (Stripe's test bank account) shows **Being confirmed** on the bill within a minute, and **Paid** after
  Stripe settles it. Until you do this, bank payments are only noticed from events already sent.

- [ ] **Check the recall list answers the way the app expects.** The build machine could not reach the government's recall
  site, so the reader was tested on sample data shaped from the published field names. Steps: ask your agent to open
  **Equipment › Recalls** after the first night, and look at "Recall check": it should say the last check worked and show
  how many appliances were checked. Then press **Check my whole fleet**. Ready when: OPS-1 is merged and deployed. Worked if:
  the page shows a recent good check with no error, and any listed recall opens its government page.

- [ ] **Turn on late fees for real card customers (only when you are ready).** Late fees are recorded and shown, and customers are
  warned first, but a fee only goes onto a customer's real automatic charge when you switch it on. In Stripe test mode it
  already works. Steps: ask your agent to set `LATE_FEE_CUSTOMER_CHARGING_ENABLED` to `true` for the live site, after you have
  read the late-fee wording on a signed agreement and confirmed the Decisions questions (warning days, fee tax). Ready when:
  FEE-1 is merged and live customer email is on (a fee needs a delivered warning). Worked if: a test customer who ignores a
  warning gets a "Late fee" line on the next bill and nothing on the overdue bill.

## D. Other people's systems (trial companies, provider reviews)

- [ ] **QuickBooks trial company import** of a month of DETAIL CSV journals: counts and debits/credits balance, bank
  matches (K-5, K-CASH-6). Ready when: you have a trial company and a released export.
- [ ] **Xero** (only if you choose it): organization tax-rate names and holding accounts mapped.
- [ ] **Twilio / carrier registration** and **Resend / Stripe account reviews** as described in section B.
- [ ] **Metricool:** confirm a real visit shows up; review the updated privacy-page version; compare to interest-list signups.
- [ ] **Stripe balance import (K-3):** approve `BOOKS_STRIPE_SYNC_ENABLED=true` for production only after you have checked
  the opening date and balances.

- [ ] **Phone usage sync (COM-N wiring):** **Switch saved 2026-10-24:** at Chris's request, Vercel Production
  now has `TELECOM_SYNC_ENABLED=true` (confirmed by a second read). It only reads phone usage and costs; no texts or
  calls are sent. **Still to verify:** the app has a production Twilio account, a normal scheduled release picks up
  the changed environment variable (no manual release), and Desk → Automations shows a successful nightly
  "Phone usage sync" run. Leave this box unchecked until the run is observed.

- [x] **Answered by Chris 2026-10-25 (in conversation): yes — rebuild the desk as an application (AR-0…AR-10).** Building may start as soon as each
  build plan is merged (docs/DECISIONS.md, 2026-10-25).

- [ ] **Look at the new Today, Bills and Customer screens on the testing app (10 minutes).** Steps: sign in to the
  testing app on your phone (owner@example.test), open Today, then Money › Bills, then any customer. Ready when: AR-0b
  is merged and the 10 pm testing release has run. Worked if: the screens look like the samples you approved; tell the
  agent anything you want changed. This never blocks building.
- [x] **Answered by Chris 2026-10-25 (in conversation): yes — build "Books on autopilot" (BA-1…BA-6).** Building may start as soon as each
  build plan is merged (docs/DECISIONS.md, 2026-10-25).

- [x] **Answered by Chris 2026-10-25 (in conversation): yes — build the Leads workspace (LD-1…LD-4).** Building may start as soon as each
  build plan is merged (docs/DECISIONS.md, 2026-10-25).

- [x] **Answered by Chris 2026-10-25 (in conversation): yes — build the Customers workspace (CU-1…CU-3).** Building may start as soon as each
  build plan is merged (docs/DECISIONS.md, 2026-10-25).

## E. Optional / later (no action until you want it)

IN-10 real photos you are comfortable publishing · IN-11 genuine reviews with permission · IN-13 staff roles when you hire ·
IN-14 first portfolio account requirements · IN-45 AI morning check-up key · IN-48/49/50 partner, offer and permission
programs (proposed, not built) · IN-64 receipt-photo scanning (deferred) · IN-05 launch date (hoped for November, depends
on readiness).

- [ ] **Decision, only when you hire: should any staff member ever see reports or post expenses?** Today staff see only the
  driver view and can do none of the money actions. The new "What each admin may do" page can only take things away from an
  admin; it never gives staff more. Giving a staff member reports or expenses means opening desk screens to staff, which
  widens access, so it waits for your yes. Steps: tell the agent which person and which of the two (reports, expenses).
  Ready when: you have staff who need it. You'll know it worked: that person sees only what you chose.

- [x] **Security tidy-up in Vercel: make two stored passwords "Sensitive."** Done: Chris said he did it on 2026-10-23 and a read-only check the same day showed `DATABASE_URL` and `BETTER_AUTH_SECRET` marked Sensitive with no warning. Optional extra: production `DIRECT_URL` is the direct database connection and is not marked Sensitive either; the same steps (Vercel → appliance-desk → Settings → Environment Variables → edit → Sensitive) fix it.

## Log of rows added by agents

| Date | Row added | Why |
|---|---|---|
| 2026-10-23 | Business paperwork list | Chris asked for one place for LLC/EIN/licenses with renewal reminders (built in the app). |
| 2026-10-23 | Whole file created | Consolidated from GO-LIVE-CHECKLIST, OWNER-INPUTS and the STATUS acceptance list. |
| 2026-10-23 | Shop-sale taxability answers | Shop sales are refused until the owner records taxability for items sold and used appliance sales. |
| 2026-10-23 | Staff-permission decision (section E) | Granting staff reports/expenses would widen access, so it needs the owner's approval. |
| 2026-10-25 | App-wide redesign go-ahead and reference-screen review | Chris: every page is category pages, not an application. |
| 2026-10-25 | Customers workspace go-ahead decision | Chris found the Customers list too basic for a real customer system. |
| 2026-10-25 | Leads workspace go-ahead decision | Chris asked for a robust, scalable leads page without screens full of explanations. |
| 2026-10-25 | Books on autopilot go-ahead decision | Chris asked for a Books redesign a first-time owner can run; build needs his go-ahead. |
| 2026-10-24 | Testing owner password fix, agent-run M-3 check, GitHub release-branch protection | Audit of the testing setup: the testing build failed at the owner step; `live`/`testing` had no GitHub protection and the connector correctly refuses to change protection without you. |
| 2026-10-23 | ACC rows: email-code decision (IN-85), build-order decision, second sign-in method, Twilio sign-in-code use case | Chris asked for invitations, account self-service, recovery and text/email codes (design: designs/ACCOUNTS-AND-SIGN-IN.md). |
| 2026-10-24 | Shop-sale card page in Stripe test mode | M-3 was proved only against a pretend Stripe; a real test-mode payment needs Chris's Stripe test keys. |
| 2026-10-25 | Removed receipt files really leave storage | The clean-up of removed files was proved against a stand-in, not the real private store. |
| 2026-10-23 | Vercel "Sensitive" tidy-up | Read-only check of Vercel found two production settings readable by project members. |
| 2026-10-25 | IRS IRIS TCC, compliance encryption key | Chris asked the app to file and fill federal and state forms (CMP-1, CMP-3). |
| 2026-10-25 | Vault encryption key, workers' comp rejection form | Records vault (VAULT-2) and insurance (OPS-4). |
| 2026-10-25 | UCCC consumer-lease notification | Late-fee law research: Colorado's UCCC covers household rentals over 4 months. |
| 2026-10-26 | Turn on late fees for real card customers | FEE-1: fees only reach a customer's real automatic charge when you switch it on. |
| 2026-10-26 | Add three payment events to your Stripe webhook | BILL-1: the app can only show "Being confirmed" for bank payments if Stripe sends those events. |
| 2026-10-25 | Ask Greeley Sales Tax about rentals and fees | Fee taxability research (FEETAX-1): Greeley's code couldn't be read; a written answer can remove tax from optional service fees. |
| 2026-10-26 | Check the recall list answers as expected | OPS-1: the live government recall answer could not be fetched while building. |
