# Owner audit and recommendations — 2026-10-06

Written for Chris in plain English. Reviewed at `main` 23eff64 (after #260, E2-5).
This is a review, not a batch: nothing here is built yet. Items that belong to a
batch say so; new ideas are also listed in `docs/ROADMAP.md`.

## The short version

The foundation is strong. Security basics are done carefully: every automatic
job needs a secret password, every outside message (Stripe, Twilio, Resend) is
checked for a real signature, staff are blocked from money screens at the data
level, and money is stored as whole cents. The test suite is large (289 test
files, 31 browser test files) and runs against a real database.

The biggest gap is **not a bug — it's a missing half of the business.** The app
tracks money *coming in* very well, but almost nothing about money *going out*.
So it cannot yet tell you whether the business is profitable. That is the main
recommendation below.

## Part 1 — Must fix (before real customers)

| # | What | Why it matters | Where |
|---|---|---|---|
| F1 | **Two "high" security advisories in software the app uses** (`sharp`, the image tool, and `source-map-js`). Both have a ready fix (`npm audit fix`). | Known holes in third-party code; free and quick to close. | `package-lock.json` |
| F2 | **Cancelled rentals keep growing on the Reports page.** When an active rental is *cancelled* (not *ended*), its end date is left blank (or in the future). The "estimated earnings" math keeps counting it as earning money every day after cancellation, so the "gap" number grows forever and looks like a customer owes you money they don't. | Wrong number on your main money report. | `src/domains/agreements/index.ts:647` (only ENDED gets an end date) and `src/domains/reports/index.ts` (no status filter) |
| F3 | **Only one sales-tax rate for the whole business.** Colorado taxes rentals by where the appliance is delivered. Greeley, Evans, Windsor, Loveland, etc. each have different city rates, and Greeley collects its own city tax separately from the state. Today every customer gets the same rate. | Under- or over-charging tax for customers outside Greeley, and no clean numbers to file returns. Ask the CPA (this joins IN-17). | `BusinessSettings.taxRateMilliPercent`, `src/domains/billing/tax.ts` |
| F4 | **No two-step login for the owner account.** The owner login can issue refunds, change prices and export every customer's data, protected only by a password. | One leaked password = full access to money and customer data. The login library already supports two-step codes and passkeys. | `src/lib/auth.ts` |
| F5 | **`docs/STATUS.md` is out of date.** It says Batch E2 (the redesign) has "not started", but E2 parts 1–5 merged today (#250–#260). | The status file is the AI's memory; a stale one causes repeated or skipped work. | `docs/STATUS.md` |

Smaller things worth fixing when the area is touched:

- **Reports use "30-day months".** Real billing uses calendar months, so the
  estimate drifts about 1.4% a year from what Stripe actually charges. Harmless
  now, confusing at scale. (`src/domains/reports/earnings.ts`, `src/domains/inventory/analytics.ts`)
- **The accounting export has no date range and no tax column.** It always dumps
  everything since day one. Your bookkeeper will want "this quarter" with
  rent, tax and fees in separate columns. (`src/app/desk/reports/export/route.ts`)
- **Card-processing fees are not recorded.** Stripe takes roughly 3% of every
  payment; the app records the full amount as received. Your real income is
  lower than the screens show.
- **A private file-storage ID is written in the code** of a public repository
  (`src/domains/preview-storage/index.ts`). It is not a password and is preview-only,
  but the project's own rules say not to commit infrastructure IDs. Confirm it is
  on the secret-scan allowlist on purpose.

## Part 2 — Better money tools (P&L and reports)

What exists today: estimated vs. collected per rental, cash received this month,
monthly rate (MRR), per-appliance earnings minus purchase price and repair cost,
fleet utilization, and a payments CSV. What is missing is everything on the cost
side. Recommended, in order of value:

1. **Expenses.** A simple "add expense" screen (phone-friendly, with a receipt
   photo): date, amount, category, vendor, optional link to an appliance, job or
   vehicle. Categories you edit yourself (fuel, vehicle, insurance, storage rent,
   software, marketing, parts, appliance purchases, Stripe fees, other).
2. **A real monthly Profit & Loss page.** Income (rent, fees, late fees) minus
   refunds, minus expenses by category = profit, per month, with this month vs.
   last month and vs. the same month last year. Pick "cash basis" (when money
   moved) as the default — that is what most small businesses file on.
3. **Automatic Stripe fee import.** Read the fee on each Stripe payment so
   "money received" and "money that actually landed in the bank" are both shown.
4. **Appliance payback and depreciation.** For each machine: what it cost, what
   it has earned, repairs, months until it has paid for itself, and a simple
   depreciation figure for taxes. Flag "lemons" (repair cost above X% of earnings).
5. **Sales tax report.** Taxable rent and tax collected per city, per filing
   period, ready to copy into the state and Greeley returns.
6. **Cash-flow forecast.** Next 90 days of expected rent from active rentals,
   minus known renewals ending and scheduled pickups.
7. **Customer and rental health.** Average rental length, how many rentals end
   each month (churn), lifetime value per customer, which lead sources produce
   customers who stay and pay.
8. **Bookkeeping hand-off.** Date-range export in a format QuickBooks / Wave
   accept, or a direct connection later.
9. **Year-end package.** One button: P&L for the year, asset list with
   purchase dates and costs, sales tax totals, 1099 vendor totals.

## Part 3 — More owner controls

The project already does this well (most settings are editable with plain-language
help). Gaps worth adding:

- **Permission switches per staff member**, not just three fixed roles: e.g.
  "this admin can record cash payments but not issue refunds", "refunds over
  $X need owner approval", "can see reports: yes/no".
- **Settings history with undo.** Every settings change is already logged; show
  that log on the Settings page with "who changed what, when" and a one-click
  revert.
- **Approval queue.** Refunds, write-offs and discounts above an amount you set
  wait for your OK on your phone instead of happening immediately.
- **Price changes with an effective date.** "New washer price from Jan 1 for new
  rentals only", with a preview of who is affected.
- **Goals and alerts.** Set monthly targets (new rentals, revenue, utilization)
  and get a notice when you are off track, or when a machine sits idle more than
  N days.
- **Owner "kill switches" page.** One screen with every live switch (customer
  email, SMS, auto-renew, live payments, public site banner) and its current state.
- **Session control.** See where the owner account is logged in and sign out
  other devices.

## Part 4 — Operations ideas (later)

- Route ordering for a day's deliveries and a printable/phone run sheet.
- Customer self-service: update card, pick a delivery window, reschedule.
- Card-expiring reminders before a payment fails.
- Inventory reorder alerts (parts below a minimum).
- Review requests after a successful delivery (already on the roadmap under growth).

## A better version of your request (for future audits)

You asked me to improve your prompt. Here is a version you can paste into a new
session next time:

> Read AGENTS.md, docs/START-HERE.md and docs/STATUS.md. Then audit the code at
> current `main` and give me a plain-English report with three lists:
> (1) **Must fix before launch** — security holes, wrong money or tax math,
> data one customer could see of another's, things that would break with real
> customers; for each, say where it is, how you confirmed it, and how serious it is.
> (2) **Report and tool gaps** — what I cannot learn about my business today
> (profit, costs, taxes, cash flow, per-appliance payback).
> (3) **Owner controls I'm missing** — anything I'd have to ask a developer to
> change. Run `npm audit`, check that every screen and action checks who is
> logged in, and check the reports against the billing code. Don't change code;
> save the report in `docs/reviews/` and add new ideas to `docs/ROADMAP.md`.
> Tell me which items need my decision.

## How this review was done (and its limits)

- Read the project rules, status, plan and roadmap; read the reports, revenue,
  tax, earnings, agreement-closing, settings and webhook code; checked every
  automatic-job and outside-message endpoint for a password/signature check;
  checked every server action file for a login/role check (all have one, some in
  the business-logic layer); ran `npm audit`.
- **Not done:** a line-by-line review of all 468 source files, running the test
  suite, or checking the live site. Finding F2 was confirmed by reading the code,
  not by a test. F3 needs a CPA to confirm the correct rates.
