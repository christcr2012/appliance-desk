# FEETAX-2 — Delivery-area tax readiness (50 miles of Greeley and beyond)

Build spec: `docs/build-specs/engines/FEE-TAXABILITY.md` sections 8–11; place list
`docs/research/2026-10-25-tax-jurisdictions-50mi.md`. Requested by Chris 2026-10-25 ("any place within 50 miles … and
a way to be sure if I decide to deliver outside of that 50 mile limit"). Depends on FEETAX-1 and VAULT-1 (license
records). Risk: **tax compliance** — refuses to schedule where the business isn't set up.

## Acceptance
- [ ] Every place in the 50-mile table seeded with readiness, rate source and review state.
- [ ] Estimates, portal checkout, desk orders and the schedule refuse a not-ready address with a plain reason; website check says "call us".
- [ ] Missing required city license can never be overridden; "rules not decided" override is owner-only, with reason, audited.
- [ ] Second-delivery license warning for places that count deliveries; out-of-state refused; beyond 50 miles works the same way.
- [ ] Taxes › Delivery area screen with "Check an address"; e2e with axe in a shard.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
