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
Built and opened as PR #627 (branch `ai/vivienne/cmp-1`). Registry, encrypted
business facts, the prepare/approve/submit flow, screens, To do category and
the filled-form engine are all in, with local verification green (typecheck,
lint, the registry/crypto/forms unit tests and the filings integration tests
against the lane database). First CI run + Codex review produced one fix
patch: secret-scan fingerprints for three obligation keys (the rules-registry
false positive class), the filing state groups moved into the domain for the
owner-wording check, the route inventory gained the three routes, Compliance
links from the Taxes home page instead of a fifth tab (the W-3 four-tab rule
stands), the To do provider synchronizes filings itself, synchronization is
serialized on the settings row, and rejected guided filings can be prepared
again. One file is outstanding: the vendored 1040-ES PDF is a binary and
cannot travel through the text-only GitHub tools here — the PR body carries
the download link and fingerprint for whoever adds it with git access.
Second fix round: the scanner had three more obligation keys of the same
class (fingerprints completed from a full local scan), the owner guide's
Taxes section now names the Compliance screen, and the filing sync runs on
the attention surfaces (Today, Taxes home, Compliance) and on facts save
rather than inside the read-only To do provider, whose contract the
role-access tests guard.

Review round 3 (Codex on the successor PR #639, 2026-10-26): four findings,
all accepted. (1) The 1099-MISC recipient copies are now their own
obligation (fed.1099_misc_recipients, due January 31) instead of hiding
behind the March 31 IRS filing date. (2) Obligations that apply but have
no honest dates (trade name, Greeley license, truck registration, USDOT,
Form 8300) carry an unscheduledReason and are listed on the Compliance
screen under "Needs you — dates not set yet" with what is missing, instead
of disappearing. (3) The USDOT update no longer invents a December 31
date: the FMCSA biennial schedule derives from the USDOT number's last
two digits, so the obligation is unscheduled until the number is recorded
(DQ-CMP-USDOT). (4) The filing sync now reconciles: a still-pending row
whose period is no longer generated (the obligation stopped applying or
its schedule changed) is retired to NOT_APPLICABLE, while rows already in
motion are never touched. Registry and integration tests cover all four.
Also on #639: the secret scan's six registry lines were fingerprinted for
the rebuilt branch's commit (a94257d2), the last item from PR #632's
commit-range scan changeover.
