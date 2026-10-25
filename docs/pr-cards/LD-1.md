# LD-1 — Leads pipeline engine: stages, owner, first contact, duplicates, scale

Build spec: `docs/build-specs/engines/LEADS-PIPELINE.md` (decided there, including the corrections to the design).
Approved by Chris 2026-10-25. No screens (AR-4b builds them). Risk: **lead writes and an additive migration with
backfill SQL**; consent rows move on merge (never rewritten).

## Steps
1. Migration + `leadContactKeys` + the grep test (spec 1).
2. Stages (`stage.ts`) + `markFirstContactInTx` + its callers + `NEW_LEAD_CONTACT` where change (spec 2).
3. Assignment + settings + `chooseOwnerForNewLeadInTx` in both create paths (spec 3).
4. Duplicate flag at create + `mergeLeads` (spec 4).
5. `updateLeadStatus` one transaction; action calls it once; fakes updated (spec 5).
6. Queue/counts/search + capacity test (spec 6). Owner question row → Decisions (spec 7, a DQ entry, not a checklist row).

## Acceptance
- [ ] Every test in spec section 8 passes on throwaway Postgres; capacity under 150 ms in CI.
- [ ] A website lead lands in "New" and leaves it only on a real outbound contact.
- [ ] Merge moves every lead-linked table (schema test) and keeps consent history.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
