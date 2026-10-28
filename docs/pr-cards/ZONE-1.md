# ZONE-1 — Service area map and delivery zones from the address

Build spec: `docs/build-specs/screens/SERVICE-AREA-MAP.md`. Requested by Chris 2026-10-25 (map centered on Greeley;
0–15 free, 15–30, 30–50, none beyond 50; delivery optional with pickup by arrangement; zone found from the address and
put on the estimate). Builds on IN-06. Feeds FEETAX-1's delivery/pickup lines; FEETAX-2 adds tax readiness to the same
address check. Risk: **public prices and money on estimates** — snapshot per estimate; prices hidden on the website
until Chris switches them on.

## Acceptance
- [ ] Zones, center and distance method are owner settings with starting values and explanations; old bands in `mileageBand` read from them.
- [ ] Address → coordinates (Census geocoder, cached, server-only) → zone; lookup failure → "We'll confirm" + To do, never a guess (tests with fixtures, no network in CI).
- [ ] Estimates, portal checkout and desk orders show the zone and price, always offer "I'll pick it up" ($0), and only pickup beyond 50 miles; snapshot frozen (integration test on throwaway Postgres).
- [ ] `/service-area` redesigned: our own SVG map with rings, legend, town list by zone, address checker; prices hidden until switched on; works without JavaScript; axe clean; phone width.
- [ ] `/rent/{city}` pages built from the town list with zone; old URLs keep working.
- [ ] Settings › Delivery zones replaces the city/ZIP lists (columns kept, no longer read).
- [ ] Coordinates never shown to customers or logged; customer A can't reach B's address data; `ci` green at the exact head; every review comment read.

## Progress
2026-10-26, branch `ai/claude/zone-1-service-area-map`: all seven lines coded with tests. Deviations: map positions
live in their own table `ServiceAddressGeocode` (not columns on ServiceAddress) so no address read can leak them; the
estimate snapshot is a list (one entry per delivery address); the delivery price is shown on estimates and frozen in
the snapshot but becomes a billed line in FEETAX-1 (service lines); portal checkout arrives with PORTAL-1 (desk and
phone orders use the estimate page); staff settle an unknown zone by typing the miles (no clickable pin yet).
Live Census lookup not observed from the sandbox (network blocked) — checklist row.
