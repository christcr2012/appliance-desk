# CMP-4 — Colorado and local business filings

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-4. Depends on CMP-1. Risk: **property values reported to the
county** (rental-fleet exemption off until confirmed).

## Acceptance
- [x] Jan 1 asset snapshot; items over $350 listed; total vs the dated $56,000 threshold; under → "No declaration needed".
- [x] Filled Weld DS 056/060 and spreadsheet when over; extension shown near the date.
- [x] SOS periodic report, trade name and Greeley license as exact values to type, with confirmation capture.
- [ ] Vehicle registration and USDOT (only at GVWR ≥ 16,001 lb); `ci` green; every review comment read.

## Progress
Built on branch `ai/vivienne/cmp-4` (baseline dd5f7ff1). The January 1 snapshot reads the book assets owned that day with the rental in force on that date (a set's rent stays the line's price, never split; a line's rent is stated only for its single unit). The threshold verdict compares total original cost against the dated rule (research note: the assessor's actual value derives from cost and year, so under-on-cost is safely under; the filing page says which basis was used). Under → preparing closes the filing as not needed with the numbers kept; over → approval unlocks the filled DS 056 / DS 060 PDFs (vendored from weld.gov, hash-pinned; FEIN and signature never filled) and the full spreadsheet. Confirmed during the build: an LLC's statement of trade name never renews (C.R.S. § 7-71-104) — it is a recorded fact, not a filing; the Greeley license is free and renews every two years on the license date; the USDOT biennial month/year derive from the number's last two digits. Local verification: typecheck clean; unit suites (snapshot, schedules, forms, both registries) and the CMP-4 integration suite green on a disposable cluster, plus the CMP-1/2/3 compliance suites re-run green. The vehicle/USDOT acceptance line and the CI/review boxes tick when the PR completes.
