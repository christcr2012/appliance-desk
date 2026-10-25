# Build spec — The things a one-person business needs but rarely thinks of (OPS-1…OPS-8)

Chris, 2026-10-25: "I have no team or specialized departments … I need you to decide and design anything else that
should be built in". Design: `docs/designs/OWNER-OPERATING-SYSTEM.md`. Facts: `docs/research/2026-10-25-operating-risks.md`.
Same house rules as TFA/CMP: Chris approves anything that changes money, customers or filings (To do with Approve);
timing rule; dated rules (`ruleAsOf`) for legal numbers; careful starting values with Decisions questions for every U
item. Read `docs/AI-PR-READ-FIRST.md`.

## OPS-1 — Product recalls (safety first)
- Data: `Appliance.manufacturer`/`model` exist; add `ApplianceType.recallProductTerms String[]` (e.g. washer → ["washer",
  "washing machine"]) and model `RecallMatch { id, recallId, recallNumber, title, url, remedy, publishedAt,
  applianceId, matchReason, state (POSSIBLE | CONFIRMED | NOT_OURS), decidedByUserId, decidedAt }`
  (`@@unique([recallId, applianceId])`).
- Watch: nightly job `recall-watch` (new `AUTOMATION_RULES` entry, daily) calls the CPSC API with
  `LastPublishDateStart = last success − 1 day`, `ProductName` = each term, `format=json`, through the existing safe
  fetch (`safe-official-source-fetch.ts`, allow host `www.saferproducts.gov`, JSON). **First run** (and a "Check my whole
  fleet" button) searches by each distinct fleet manufacturer + type term back 15 years. Matching (pure, tested):
  manufacturer name match (normalized) **and** (model string found in Products/Description, or no model on file) →
  POSSIBLE. Never auto-confirm.
- To do high "Possible recall: {title} — {n} of your appliances" → recall page: CPSC text, remedy, link, the matched
  appliances with model/serial; buttons **It's ours** (CONFIRMED → appliance gets `recallHold = true` (new field) which
  blocks reserve, rent, sale and parts listing — the existing availability and sale checks read it; renters of
  affected units get a To do "Contact {customer}: swap or repair" with a drafted message following the remedy, sent only
  with Chris's approval and the existing switches) and **Not ours** (with reason). Before any used-appliance sale or
  parts listing, the sale path runs a recall check for that model (refuses when CONFIRMED).
- Incident log: on any maintenance request or visit note, Chris can mark "Injury or safety incident" → record + To do
  high "Decide within 24 hours whether to report to CPSC" with the SaferProducts report link (Decisions question
  `OPS-RECALL-RENTAL`, attorney: whether renting makes the business a retailer/distributor; careful starting value: yes).
- Tests: matcher fixtures (real API sample JSON vendored), hold blocks every path, sale refusal, idempotent nightly.

## OPS-2 — Refrigerant and disposal records
- When a retired appliance with a sealed refrigerant system (ApplianceType flag `hasRefrigerant`: refrigerator,
  freezer, mini-fridge; washers/dryers false) is completed as SCRAP, DISPOSE or STRIP-for-scrap, `completeRetiredPlan`
  requires a `RefrigerantRecord`: refrigerant type (from the nameplate, select incl. "Unknown"), outcome (RECOVERED |
  LEAKED_BEFORE — not by cutting lines), recovered by (name, address), technician certification number (optional),
  equipment used, date, and the recycler's receipt photo (private `records/refrigerant/`). Missing → the plan can't be
  marked done ("Scrap yards must get a signed statement that the refrigerant was removed — record it first").
- The app produces the **signed verification statement** PDF (40 CFR 82.155 contents: name and address of who recovered
  it, date; or the leak statement), signed on screen by Chris, to hand to the recycler; stored with the record.
- Repair jobs marked "sealed system" (new checkbox on maintenance visits) need a Type I certification on file
  (business record kind CERTIFICATION, VAULT-1) for the person assigned; otherwise the job can't be assigned to them
  ("Hire a certified technician for this repair").
- Retention: `ruleAsOf("records.refrigerant_keep_years")` seeded 6 (EPA requires 3; 6 matches tax records); Colorado
  rules U → Decisions `OPS-CO-REFRIGERANT` (careful starting value: follow the federal rule plus keep the statement).

## OPS-3 — Vehicle, mileage and driving rules
- Vehicle profile (business record kind VEHICLE, VAULT-1): year/make/model, VIN (masked), **GVWR (required)**, plate,
  registration month, insurance policy link, odometer at purchase. Rules shown from GVWR: ≥ 26,001 CDL; ≥ 16,001 Colorado
  commercial-vehicle rules (USDOT, and medical card — U → Decisions `OPS-MEDCARD`, careful starting value: required);
  otherwise "No special license".
- **Mileage log**: each Schedule route day (AR-5) gets a trip with stops from that day's visits; the driver enters
  start/end odometer from the route screen (prompt at first and last stop); purpose is filled from the visit types
  ("Deliveries and pickups"). Manual trips can be added (supply runs). Per year: business miles, rate
  `ruleAsOf("us.mileage_rate", year)` (seed 72.5¢ for 2026, source IRS Notice 2026-10), deduction by the standard rate,
  and actual vehicle costs from books for comparison; the first-year choice is a Decisions question `OPS-MILEAGE-METHOD`
  (CPA; starting value: standard rate in the first year, which keeps both options open). Feeds CMP-2 Schedule C line 9.
- Reminders: registration, insurance, maintenance (owner-set mileage/months), medical card if applicable.

## OPS-4 — Insurance
- Business records of kind INSURANCE (general liability, commercial auto, equipment/inland marine, workers' comp)
  with insurer, policy number, limits (text), premium (cost → budget), expiry, COI file; reminders 60 and 30 days before.
- Workers' comp status field: "No employees — rejected as LLC member (form sent {date}, certified mail {number})" or
  "Policy {…}"; adding the first employee (CMP-5) or a STAFF user marked employee raises To do high "Workers'
  compensation insurance is required now".
- "Request a certificate of insurance" for property managers: produces an email to the agent with the requester's
  details (existing email path, owner mailbox).
- Coverage amounts: Decisions `OPS-INSURANCE-LIMITS` (insurance agent) with starting values noted as "ask your agent".

## OPS-5 — Card disputes and bank returns
- Webhooks: handle `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` (existing webhook
  pipeline: evidence gathered before the lock, dedupe, global lock). Model `PaymentDispute { id, stripeDisputeId unique,
  paymentId, invoiceId, amountCents, reason, status, dueBy, evidenceSubmittedAt, outcome, createdAt }`.
- To do high "Card dispute: {customer} {amount} — respond by {dueBy}" (BENEFITS → as soon as possible; reminder 3 days
  before `dueBy`). Dispute page builds the **evidence packet** automatically: signed rental agreement PDF, delivery
  completion (time, photos, signature), the bill, payment and customer messages about it, the rental terms on refunds —
  combined into one PDF ≤ 4.5 MB (compress images; drop the oldest photos first if over). Chris reviews and taps
  **Approve and send** → `stripe.disputes.update(id, { evidence, submit: true })` (test mode until live payments are
  turned on — hard limit unchanged). One submission only (the button disappears).
- ACH: a debit dispute (`charge.dispute.created` on `us_bank_account`) is final: mark the bill unpaid again (existing
  failed-payment path), block that mandate, To do "Collect directly — bank disputes can't be contested". Deposit refunds
  for bank payments wait until 60 days after the debit (setting `achDisputeWindowDays`, starting value 60 from NACHA via
  Stripe docs). Before any refund on a disputed payment: warning "A refund doesn't stop the dispute — you could pay twice".
- Changing a recurring debit date sends the customer notice at least 7 days before (existing customer email path +
  switch; blocked if email is off and no other notice is recorded).

## OPS-6 — Collecting from customers who stop paying
- **Past-due ladder** (owner settings, starting values): day 1 reminder (exists), day 10 "second notice", day 20
  "final notice" letter (filled PDF + email), day 30 To do "Decide: pick up the appliance, payment plan, or small claims".
  Messages always in the business's own name (C.R.S. 5-16-103) — a test checks every collection template.
- **Pickup after default**: a pickup visit may be scheduled only after Chris records the customer's consent (date, how)
  — otherwise the button says "If they don't agree, ask the court (replevin)". The driver's route shows "If the customer
  objects, stop and leave" on these visits; "Customer objected" ends the visit and creates the small-claims To do.
- **Small claims packet** (claims ≤ `ruleAsOf("co.small_claims_limit")`, seeded $7,500): ledger, signed agreement,
  notices sent, appliance value, filled court form (vendored from the Colorado Judicial Branch site like other forms;
  verify the current form number when vendoring), venue = defendant's county or where the property is; tracks the 2 per
  month / 18 per year per county limit; filing fee from the rule book. Chris files it himself.
- Write-off stays the existing approval path; bad-debt tax treatment follows DEC-2.
- **Product rule**: the app never offers an ownership option (rent-to-own); a test fails if agreement templates or
  quote text contain ownership/purchase-option wording, because that would bring Colorado's rental-purchase law.

## OPS-7 — Privacy and security duties
- **Security incident** workflow (Settings › Privacy, OWNER): "Something may have leaked" → date discovered → date
  determined → affected people count (Colorado residents) → the 30-day clock, AG notice if ≥ 500, credit bureaus if >
  1,000 (dated rules), filled notice letter with every required item, a vendor-notification checklist; all as To do
  with deadlines (FIXED, never late).
- **Retention schedule** (owner settings with starting values from research 11): agreements and ledgers 7 years after
  the account closes; tax and mileage 7; refrigerant 6; ID images deleted after verification (keep last 4 + note);
  leads with no business 2 years; messages 3 years. Nightly purge (bounded, logged), **legal hold** flag on a customer or
  record stops purging. A public "How we handle your information" page includes the written disposal policy (6-1-713).
- **Vendor list**: each service provider (Vercel, Neon, Stripe, Google, Twilio, Resend…) with "security terms reviewed on
  {date}" yearly reminder (6-1-713.5).
- **Biometric ID**: setting "Use face-match ID checks" starts **off** and stays off unless Chris turns it on (then a
  written biometric policy and consent step are required).
- **Marketing rules**: marketing texts only with written consent (existing ConsentRecord), only 8 am–9 pm Denver
  (setting), Colorado no-call exclusions unless relationship within 18 months or consent; marketing email footer with
  postal address and one-click unsubscribe honored immediately. Transactional messages stay separate.
- Accessibility complaint → To do with a 30-day fix clock.

## OPS-8 — If something happens to Chris; the yearly check-up
- **Continuity page** (OWNER): emergency contact and successor (from VAULT-2 section 7), an always-current "If I'm gone"
  runbook generated from live data (who has which appliance, open balances, next deliveries, how to pause billing, who
  the CPA is, where the records are), and a **"Pause all automatic charges"** switch the successor can use through
  emergency access (stops new charges and reminders; never refunds or cancels). Attorney question `CONT-SUCCESSOR`
  (successor-member clause; the LLC dissolves 91 days after it has no member — C.R.S. 7-80-801).
- **Yearly business check-up** (December To do, walkthrough style): insurance limits and renewals, prices and fees,
  CPA meeting packet, policies and terms, retention purge results, who has access (team, accountant, assistants),
  vendor security terms, whole-fleet recall check, business records expiring next year, last year's tax set-aside vs
  actual.

## Tests (all units)
Each unit: pure rules (matching, ladders, clocks, retention), integration on throwaway Postgres (holds block paths,
refrigerant gate, dispute webhook dedupe and single submission, consented-pickup gate, purge with legal hold), and one
browser spec per new screen with axe.
