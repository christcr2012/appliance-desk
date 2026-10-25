# Build spec — Service area map, delivery zones from the address, pickup always allowed (ZONE-1)

Chris, 2026-10-25: "re-design anything on the website relating to service area … it currently lists several
towns/cities, and a single zip code. I want it to instead use a service area map, centered over the center of the city
of Greeley, showing our service area, 0-15 miles local with guaranteed free delivery, 15-30 miles … competitive
delivery fees, and 30-50 with heftier delivery fees, and beyond 50 miles no delivery available, and delivery should be
optional, I will allow an arrangement to pick up their appliances instead … The system needs to be able to detect what
delivery zone applies based on address and that info should be applied to the estimate."

Earlier answer IN-06 (2026-10-13): free to 15 miles, $75 over 15–30, $125 over 30–50, over 50 off; fees adjustable;
no paid mapping provider. The $45 per-new-location setup fee (IN-74) stays separate. This spec replaces the city/ZIP
lists as the source of truth for "do we deliver there". Builds on `src/domains/orders/delivery.ts` (`mileageBand`),
`src/domains/site-content/service-area-check.ts`, `src/app/(public)/service-area/page.tsx`, the estimate builder
(`src/domains/estimates/all-in-preview.ts`) and FEETAX-1/2 (`docs/build-specs/engines/FEE-TAXABILITY.md`).

## 1. Zones are settings (owner, "restore recommended")
`deliveryZones Json` replaces the hard-coded bands in `mileageBand` (same numbers as starting values):
| Zone | Starting name (customer-facing) | Miles | Starting delivery price | Why |
|---|---|---|---|---|
| 1 | **Local — free delivery** | 0–15 | $0 (guaranteed) | IN-06 |
| 2 | **Nearby** | over 15–30 | $75 | IN-06; "competitive" fee |
| 3 | **Extended** | over 30–50 | $125 | IN-06; "heftier" fee |
| — | **Outside our delivery area — pickup only** | over 50 | not offered | IN-06 |
Names are starting values (Chris wasn't sure what to call zone 2; Decisions question ZONE-NAMES). Each zone has: name,
outer miles, delivery price, pickup-at-end price (starting: same as delivery; Decisions ZONE-PICKUP-PRICE), color
(design tokens). Validation: zones increase, last ≤ `deliveryMaxMiles` (starting 50), prices ≥ 0. Changing zones
applies to new estimates only; sent estimates and signed agreements keep their snapshot.

- `zoneCenter` setting: **40.4233 N, 104.7091 W** (central Greeley; starting value, owner-editable with a "Use my
  shop address instead" button). Replaces the "UNVERIFIED" `drivingOriginAddress` placeholder as the zone center;
  driving-route evidence (`route-evidence.ts`) stays for owner-recorded exceptions.
- `zoneDistanceMethod`: starting **STRAIGHT_LINE** — "as the crow flies" from the center, the same circles the map
  shows, automatic and free. IN-06 said driving distance; driving distance needs a routing service (a paid or
  rate-limited provider), and straight-line matches the map Chris asked for. Decisions question ZONE-DISTANCE explains
  the difference (a 50-mile circle can be ~60+ road miles) and offers DRIVING later. The method is stored on every
  estimate.

## 2. Address → zone (`src/domains/delivery/zone.ts`, pure + one lookup)
- `geocodeAddress(address)` (`src/domains/delivery/geocode.ts`): U.S. Census Bureau geocoder, one-line address,
  current benchmark, server-side only, 5-second timeout, no key (official; no cost). Results cached on the address row
  (`ServiceAddress.latitude/longitude/geocodedAt/geocodeSource`, additive migration) and reused; re-geocode only when
  the street changes. Coordinates are internal: never shown to customers, never in logs.
- `zoneForPoint(point, settings)` (pure): great-circle miles (round to 0.1) → zone or `OUTSIDE`. A point exactly on a
  boundary belongs to the cheaper (inner) zone.
- No match / lookup down → `ZONE_UNKNOWN`: the estimate shows "We'll confirm your delivery price" and creates a To do
  "Confirm the delivery zone for {address}" where staff can drop a pin on the map or type the miles with a reason
  (audited). Never guess a zone.
- Out of Colorado → treated as `OUTSIDE` for delivery; FEETAX-2 also refuses tax-wise unless set up.

## 3. Estimates, portal checkout and desk orders
- When an address is entered, the zone is detected and shown: "Your address is in our Nearby zone (22 miles):
  delivery $75." The delivery line, pickup-at-end line and their prices come from the zone (FEETAX-1 service lines).
- **Delivery is always optional.** Every estimate shows the choice: "Deliver it ({price})" or "I'll pick it up —
  we'll arrange a time and place" ($0). Outside 50 miles only the pickup choice shows. Pickup by arrangement creates a
  To do "Arrange pickup with {name}" (date, time, where) instead of a delivery job; the customer must still give the
  address where the appliance will be kept (needed for tax — FEETAX-2 checks that address either way).
- Customer pickup means the customer moves it: the estimate says plainly they need a suitable vehicle and help, and
  that installation is offered separately (or self-install where allowed, FEETAX-1; never for gas appliances).
- The zone, miles, method and prices are frozen into the estimate snapshot (`deliveryZoneSnapshot` JSON:
  `{ zone, name, miles, method, center, priceCents, pickupPriceCents }`) and carried to the agreement.
- Owner may waive or change a delivery price on one estimate with a reason (existing waiver pattern, audited).

## 4. Website (public)
- `/service-area` page redesigned: a map centered on Greeley with three rings (Local, Nearby, Extended), a legend with
  each zone's name and price ("Free", "$75", "$125" — published only when Chris turns on "Show delivery prices on the
  website"; IN-06 says don't auto-publish the outer fee; until then the legend says "Delivery price shown on your
  estimate"), the line "Beyond 50 miles: pickup only", and the address checker ("Check your address" → "You're in
  our Nearby zone — delivery $75, or pick it up free" / "Outside our delivery area — you can still rent and pick up").
  Zone 1 shows the promise "Guaranteed free delivery".
- **The map is our own drawing, not a paid map service:** an SVG built from settings — rings to scale, the center,
  and labels for the towns in `docs/research/2026-10-25-tax-jurisdictions-50mi.md` (coordinates stored in
  `src/domains/delivery/towns.ts`, a static list), main highways as simple lines, north arrow and a "miles" scale.
  It works without JavaScript, scales on phones, is keyboard reachable, and has a text alternative: a list of towns
  grouped by zone ("Local: Evans, Garden City, Windsor (part), …") so screen readers and search engines get the same
  information. Town names in the list link to the existing `/rent/{city}` pages.
- The address checker (`check-address-actions.ts`) uses `geocodeAddress` + `zoneForPoint` instead of the ZIP/city
  lists; rate-limited like the existing public form (reuse its limiter); never reveals coordinates or tax details;
  "We don't deliver there yet — call us" when FEETAX-2 says the address's places aren't set up. (that part arrives with FEETAX-2; until then
  the checker answers by zone only). The privacy page gets one line: "To check an address we send it to the U.S. Census
  Bureau's address lookup; we don't keep addresses typed into the checker." Public checks are not stored.
- `/rent/{city}` pages: built from the town list (zone shown: "Delivery to Loveland: Nearby zone"), replacing the
  owner's city list. Old city-list URLs keep working (same slugs).
- Settings › Where you work: panel "Delivery zones" (zone table, center, method, "Show delivery prices on the
  website" switch, live map preview) replaces "Service area" cities/ZIPs. The old `serviceAreaCities/Zips` columns stay
  (additive) but are no longer read; a one-time note on the panel says they were replaced.
- Words checked by the plain-words lint; Spanish versions through the existing site-content keys
  (`area.*`, new `area.zone.*`).

## 5. Tests
- Unit `tests/delivery-zone.test.ts`: distances for known points (Evans ≈ 3.4 → Local; Loveland ≈ 19.3 → Nearby;
  Boulder ≈ 40.9 → Extended; Golden ≈ 51 → Outside); exactly 15.0 → Local; settings validation; method stored.
- `tests/geocode.test.ts`: parses a saved Census response fixture; timeout → `ZONE_UNKNOWN`; no network in CI.
- Integration (throwaway Postgres) `tests/estimate-zone-integration.test.ts`: address saved → zone and price on the
  estimate; pickup choice → $0 and "Arrange pickup" To do; outside 50 → delivery not offered; snapshot frozen when
  zones change later; customer A can't read B's address coordinates.
- e2e `e2e/service-area-map.spec.ts` (add to a shard): map renders with legend and town list, address check with a
  stubbed geocoder, prices hidden until the switch is on, axe clean, phone width.
