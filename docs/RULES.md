# Rules

## Relational map rule

Relational map rule: every feature built or changed refreshes
docs/relational-map/ in the same change; a feature is not landed
until the diagram matches the code.

(Adopted fleet-wide by Chris, 2026-11-18. The map lives in
`docs/relational-map/`, pointed to by `docs/MAP.md`.)

Every exact count the map states is listed in
`docs/relational-map/counts.json` and checked against the code by
`scripts/check-map-counts.mjs` in CI (MAP-COUNTS-1): a change that
moves a counted thing updates the map and the counts file in the
same change.
