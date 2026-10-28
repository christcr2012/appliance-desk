# FEETAX-2 — Delivery-area tax readiness (50 miles of Greeley and beyond)

Build spec: `docs/build-specs/engines/FEE-TAXABILITY.md` sections 8–11; place list
`docs/research/2026-10-25-tax-jurisdictions-50mi.md`. Requested by Chris 2026-10-25 ("any place within 50 miles … and
a way to be sure if I decide to deliver outside of that 50 mile limit"). Depends on FEETAX-1 and VAULT-1 (license
records). Risk: **tax compliance** — refuses to schedule where the business isn't set up.

## Acceptance
- [x] Every place in the 50-mile table seeded with readiness, rate source and review state.
- [x] Estimates, portal checkout, desk orders and the schedule refuse a not-ready address with a plain reason; website check says "call us".
- [x] Missing required city license can never be overridden; "rules not decided" override is owner-only, with reason, audited.
- [x] Second-delivery license warning for places that count deliveries; out-of-state refused; beyond 50 miles works the same way.
- [x] Taxes › Delivery area screen with "Check an address"; e2e with axe in a shard.
- [x] `ci` green at the exact head; every review comment read.

## Progress
MERGED via PR #684 on 2026-10-27, squash `8a71a069` on main (chain #666 → #669 → #677 → #678
→ #684; 17 CI runs across the chain; eleven Codex findings, all fixed with regression tests;
delivery suite 24 tests). Built: the readiness catalogue (all 58
incorporated places in the 50-mile table seeded with rent rule, license rule, filing channel,
source and review state — no tax rates seeded, they still come from the rate versions), the
`deliveryTaxReadiness` check (undecided rules, missing/expired license, delivery-count rules,
out-of-state, unconfirmed address), the owner-only audited override for "rules not decided"
only, refusals wired into the estimate quote, estimate approval, estimate conversion, desk
order save, job create and job (re)schedule, the delivery counter written at job completion,
the "Get ready to deliver in {city}" To do item for places a real address needs, and the
Taxes › Delivery area screen with "Check an address". FEETAX-1 is listed as a dependency, but
the check consumes none of FEETAX-1's code (verified — it reads the address lookup, the
taxability rules, VAULT-1's business records and the existing order surfaces), so it landed
first on the heartbeat's sequencing; VAULT-1 merged 2026-10-27 (#659). DQ-FEETAX2-1 (Boulder
rent "likely") and DQ-FEETAX2-2 (presumed licenses) filed as starting values.
