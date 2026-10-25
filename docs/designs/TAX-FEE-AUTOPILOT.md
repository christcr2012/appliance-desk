# Design — Tax and fee autopilot

Chris, 2026-10-25: tax and fee rules should run themselves — rates, exemptions and the moment an exemption stops
applying — and, where possible, the app should watch official sources and update itself. Same day: when a change has
a time window and doing it early doesn't help the business, do it 85–95% of the way through the window (if allowed);
things that help the business happen as soon as safely possible (DECISIONS.md, both 2026-10-25).

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md`. Units TFA-1, TFA-2, TFA-3. Research with sources:
`docs/research/2026-10-25-tax-fee-rules.md`.

## What Chris will see
- **Taxes › Rules**: every tax and fee rule the app follows, in plain words — what it is today, since when, the next
  known change ("Retail delivery fees go to $0.31 on July 1, 2026"), where the number came from (official link and the
  date it was checked), and whether it is confirmed by his CPA or a researched starting value.
- **Automatic switches with warning.** When something about the business changes a rule — sales passing $500,000,
  use tax passing $300 in a year, a customer's exemption certificate expiring, a rental renewed past 36 months — the
  app records the date it happened, works out the legal start date, puts it on To do ahead of time ("Retail delivery
  fees start for your delivered sales on Oct 1 — nothing to do, the app will add them"), and switches on that date.
  When a condition stops applying, it switches back the same way.
- **Self-updating where the official source is readable.** Weekly (daily in the weeks before a known change), the
  app reads the official pages. When it can read a new number with certainty (two reads in a row agree, the value is
  plausible, the start date is in the future), it schedules the change itself and tells Chris with an Undo button.
  When it can't read it with certainty, it tells him exactly what changed on the page and offers "Apply" with the
  proposed value.
- **"Pay/file on" dates** for every return: the suggested day is 90% of the way from period end to due date (his
  setting, 85–95%), never after the due date and always a safety margin before it.

## Timing rule (one function everywhere)
Every change is one of: **fixed date** (law sets the day: rates on Jan 1/Jul 1, RDF on Jul 1, "first day of the month
after the 90th day") → applied exactly on that date; **window that costs or doesn't help the business** (pay a
return, file 1099s, renew a license, re-verify a certificate) → at `costlyChangeTimingPercent` (starting 90%) of the
window, clamped to at least `timingSafetyMarginBusinessDays` (starting 3) before it closes; **window that helps the
business** (ask to file less often, claim a credit, an exemption starting) → as soon as allowed. Nothing is ever
applied before it is allowed or after it is due, and nothing rewrites signed or billed history.

## What it fixes (found 2026-10-25)
- Returned shop sales currently give back the retail delivery fee; the law says a fee may not be refunded on a return
  (only on a sale cancelled before it is delivered).
- A new business's RDF start date is computed from the next filing period; the law says the first day of the month
  after the 90th day past $500,000.
- The date the business passes $500,000 is never recorded (the function exists but nothing calls it).
- The customer line must read "Retail delivery fees" (statute wording), not "Colorado retail delivery fee".
- Use tax switches yearly → monthly but never back for a new year.
- The six official-page watches exist but are all off, and only report "the page changed".
- RDF amounts and legal thresholds (1099, use tax, filing frequency, record keeping) are typed in by hand with no
  dates or history.
- Customers don't hear that their exemption certificate expired; nothing asks for a new one.
- The tax setup lets a service fee be entered for the **state** line; Colorado allows no vendor service fee on state
  sales tax from Jan 1, 2026 (state-collected local taxes may still allow one). It becomes a dated rule, 0% for the state.
