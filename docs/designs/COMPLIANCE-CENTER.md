# Design — Compliance center (federal and Colorado obligations)

Chris, 2026-10-25: the app should cover federal and state rules, filings and reporting, and "directly handle as many
things as possible" — file directly where it can, fill the forms for him to submit or mail where it can't. Build spec:
`docs/build-specs/engines/COMPLIANCE.md` (CMP-1…5). Facts: `docs/research/2026-10-25-federal-colorado-compliance.md`.

## What Chris sees
**Compliance** (in Money › Taxes area, next to sales tax): every obligation the business has — federal income tax and
quarterly estimates, depreciation forms, 1099s and W-9s, the 1099-K from Stripe, the Weld County business property
declaration, the LLC's yearly report, the Greeley license, the truck — with "do on" and "due" dates, how it will be
handled, and what's checked and not needed (with the reason, e.g. "Beneficial ownership report — U.S. companies are
exempt"). Hiring obligations stay asleep until he hires someone.

## How far the app can go (official channels, 2026-10-25)
- **Files directly:** 1099s through the IRS IRIS A2A interface, once Chris gets the free IRS transmitter code (TCC)
  and the app passes the IRS's test round (checklist row). Until then: an IRIS upload file.
- **Upload files:** IRIS 1099 CSV (≤ 100 per file), Weld assessor spreadsheet, Colorado Revenue Online uploads.
- **Filled official forms:** 1040-ES and DR 0104EP vouchers, 1099 recipient copies, W-9, Weld DS 056/060, Form 8300.
- **Exact values to type:** Secretary of State periodic report, Greeley license.
- **For the accountant:** income tax returns (the IRS doesn't let small-business software file them directly) — a
  Schedule C packet from the books, depreciation and sale worksheets, 1099-K tie-out.
- Payments are never made by the app; it links to IRS Direct Pay and Colorado Revenue Online.

Every filing waits for Chris's **Approve**; timing follows his rule (costs late, benefits early, never past due).
