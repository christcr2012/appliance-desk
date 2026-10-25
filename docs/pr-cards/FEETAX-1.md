# FEETAX-1 — Optional, separately stated service lines and per-place fee rules

Build spec: `docs/build-specs/engines/FEE-TAXABILITY.md` sections 1–7. Requested by Chris 2026-10-25 ("fees that
offset my delivery and installation costs … the least amount of tax collection requirements"). Depends on TFA-1 (dated
rule versions). Risk: **tax and money** — conservative starting rules; Chris confirms on Taxes › Rules.

## Acceptance
- [ ] Delivery, installation, pickup at the end and haul-away are separate optional choices with prices shown at ordering, including the free "do it myself" alternative; gas appliances never offer self-install.
- [ ] `OrderServiceChoice` saved with the order under the row lock; agreement and bill lines match it (integration test on throwaway Postgres).
- [ ] The engine uses the place's optional-and-separate answer only when the order proves the alternative was shown; old orders are treated as not optional (unit tests).
- [ ] Starting rules seeded as "Researched — not confirmed" with sources; Greeley rent and fees taxed until Greeley confirms.
- [ ] The $45 setup fee (IN-74) unchanged, with an on-screen note that home-rule cities likely tax it; price-vs-cost warning in Settings.
- [ ] Decisions questions FEETAX-* filed; checklist row "Ask Greeley Sales Tax in writing" with a drafted email.
- [ ] Customer A cannot read customer B's choices; `ci` green at the exact head; every review comment read.

## Progress
Not started.
