# CMP-1 — Compliance list, business facts and the Compliance screen

Build spec: `docs/build-specs/engines/COMPLIANCE.md` sections 1–5. Design: `docs/designs/COMPLIANCE-CENTER.md`.
Requested by Chris 2026-10-25. Depends on TFA-1, DEC-1a. Risk: **stored tax ids (encrypted)**, official forms.

## Acceptance
- [ ] Every obligation in the research file is in the registry with source, applies-rule and periods (tests 2026–2028).
- [ ] "Not needed" items show the reason and source (BOI, Form 2290, rent-to-own license).
- [ ] Business facts screen; EIN encrypted (AES-256-GCM), only last 4 shown, never in logs (tests).
- [ ] To do at the timing rule's date; approval binds the prepared numbers; "numbers changed" re-review.
- [ ] Filled-form engine with vendored official PDFs, hash manifest and field-map tests.
- [ ] Compliance screen tabs and filing page pass axe, phone/desktop; `ci` green; every review comment read.

## Progress
Not started.
