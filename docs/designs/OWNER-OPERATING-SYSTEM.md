# Design — The app is the whole back office

Chris, 2026-10-25: he has no team or departments; the app must walk him through setting everything up, remember every
date, account, number, login and document, handle the books, taxes, write-offs and filings, and cover the things a
one-person business doesn't know it needs. A CPA does his taxes and checks the books; everything else is the app's job.
This page lists what was added to the plan for that, in plain words. Every part follows his rules: nothing that
changes money, customers or filings happens without his **Approve**; costs are done late in their window and benefits
early; open questions run on a careful starting value and wait in Decisions & reviews.

| Part | What it does for Chris | Spec / cards |
|---|---|---|
| Guided setup | Walks him through every account (LLC, EIN, bank, Stripe, Colorado tax, Greeley, county assessor, IRS filing code, insurance, truck, email, texting, encryption keys, CPA) and checks it worked | `engines/RECORDS-VAULT.md` · SETUP-1 |
| Business records | Articles, EIN letter, licenses, permits, TCC, policies, registrations — files, numbers (encrypted), dates, renewal reminders, costs, export packs | VAULT-1 |
| Logins vault | Usernames, passwords, PINs, recovery codes — encrypted, owner only, fresh sign-in code to reveal, every reveal logged, never shown to AI | VAULT-2 |
| Tax and fee autopilot | Dated rules with sources, exemptions switching on/off, official-page watching, late changes absorbed by the business or credited to customers | `engines/TAX-FEE-AUTOPILOT.md` · TFA-1…3 |
| Compliance center | Every federal and Colorado filing: filed directly where allowed (IRS IRIS), upload files, filled official forms, exact values to type, accountant packets | `engines/COMPLIANCE.md` · CMP-1…5 |
| Tax benefits | Finds write-offs and small/new-business benefits from the books, tracks elections and deadlines, hands the CPA a ready list | `engines/TAX-BENEFITS.md` · TAXBEN-1, TAXBEN-2 |
| Accountant sign-in | A link for his CPA with access to the books and taxes only; remove or reset any time | `engines/ACCOUNTANT-ACCESS.md` · ACCT-1 |
| Recalls | Watches the federal recall list for his appliances; holds recalled units; helps contact renters | `engines/OWNER-OPERATIONS.md` · OPS-1 |
| Refrigerant records | The EPA statement scrap yards must get when a fridge is scrapped | OPS-2 |
| Truck | Driving-rule check from the truck's weight rating, automatic mileage log from routes, reminders | OPS-3 |
| Insurance | Policies, renewals, certificates, workers' comp status | OPS-4 |
| Disputes | Card and bank disputes with deadlines and a ready evidence packet | OPS-5 |
| Collections | Past-due ladder, lawful pickup after default, small claims packet | OPS-6 |
| Privacy and security | Data-leak response clock, retention and safe deletion, vendor reviews, marketing-message rules | OPS-7 |
| Continuity | "If something happens to me" plan, successor access, pause-all-charges switch, yearly check-up | OPS-8 |

Also already planned: system health and backups, the AI-assistant connection and feedback box (MCP), the decisions
center (DEC), the redesign (AR), books autopilot (BA), bank payments (BILL-1), notifications (AR-13), portal (PORTAL-1).

**Ideas still worth Chris's go-ahead (ROADMAP, not built):** in-app payroll (instead of a payroll service), customer
credit/identity checks before renting (FCRA rules would apply), online appointment booking for customers, automatic
supplier price comparisons, and a lender/loan tracker if he finances fleet purchases.
