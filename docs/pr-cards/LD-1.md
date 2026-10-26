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
Built on branch `ai/marley/ld-1` (from `origin/main` af5acc6), 2026-10-25. All six steps are coded; unit tests pass here (30 tests across `lead-keys`, `lead-stage`, `leads`, `lead-merge-schema`, `lead-status-tx`, `leads-contact`); integration, capacity and browser tests run in CI only — no local Postgres in this shell yet (the local install is still being set up; see STATUS).

- Step 1: migration `20261026020000_leads_pipeline` + `leadContactKeys` + grep guard test.
- Step 2: `stage.ts`, `markFirstContactInTx` + callers, `NEW_LEAD_CONTACT` on `leadStageWhere.new`, "Log a contact" (no screen yet — AR-4b wires the button).
- Step 3: assignment (OWNER/PERSON/ROTATE) + "New leads go to" on Settings → Lead response time + owner choice in both create paths. Deviation: `chooseOwnerForNewLeadInTx(tx)` drops the spec's unused `now` parameter.
- Step 4: duplicate flag at create (lead match → `possibleDuplicateOfLeadId`; customer-only match → `lead.matches_customer` audit) + `mergeLeads` (every child moves; consent rows move untouched; approved/converted quotes block; two-way race → one wins) + schema guard test.
- Step 5: `updateLeadStatus` is one transaction (row lock, actor re-check, status + follow-up + first contact + audit); the action calls it once. `setLeadFollowUp` is now versioned: `Lead.version` (migration `20261027040000_lead_followup_version`) is the compare-and-set token; owner/admin/assignee only; refuses unless CONTACTED.
- Step 6: `queue.ts` (Next-up rank in one SQL ORDER BY, counts, search, KIT 5.1 cursors, value sort) + queue integration test + 50,000-lead capacity test (`tests/perf/leads-queue.perf.test.ts`, under 150 ms in the Performance Baselines job). DQ-LD1-1 filed in `docs/OWNER-INPUTS.md` (should staff see and work leads? starting value: no for now).
- Verified locally on throwaway Postgres 16 (installed in this shell for the run): 71 tests pass across 13 files (unit + integration, incl. w5-w6 and lead-conversion which touch the changed functions); capacity medians list 123 ms, counts 73 ms, search 22 ms; typecheck clean; lint clean; migration check clean; `npm run check:quick` green. Counts use one aggregate scan with FILTER predicates identical to `leadStageWhere`, not the spec's five `count` calls — five calls re-scanned and re-ran the per-row open-quote check (the `new` count alone took over 500 ms). The Next-up rank is computed once per row in a nested query (evaluating it per ORDER BY key was the slow part).
- Notes for review: the follow filter uses `nextFollowUpOn <= end of today` (last whole second), not the spec's literal `<= businessDayBounds(now).end`, which would also include tomorrow's midnight-dated follow-ups; "me" must be resolved to a user id by the caller (the desk page); no existing-lead estimate creation exists yet, so that locked check belongs to AR-4b's quote-for-an-existing-lead.
- Staff access (Chris 2026-10-26, answering DQ-LD1-1 **yes**): staff whose job role includes the Leads screen can now see and work leads — the desk pages, the six lead actions and `updateLeadStatus` / `addLeadNote` / `logLeadContact` / `setLeadFollowUp` take OWNER, ADMIN or STAFF (the job-role guard is what narrows staff to the Leads screen; the Office starter role already has it), and `assignableLeadOwners` includes STAFF with the Leads screen, so "One person" and "Take turns" can pick them. Merging leads and reassigning them stay OWNER/ADMIN, and Today lead follow-ups stay OWNER/ADMIN (staff work leads from the Leads screens). Spec sections 0.3 and 7 and the OWNER-GUIDE Leads section say so now.
- Merged up to `origin/main` 0516a31 (FEE-1 #614, BILL-1 #612) on 2026-10-26; conflicts only in STATUS and OWNER-INPUTS (kept both sides' entries).
- Still to do: push (Chris approved branch creation for `ai/marley/ld-1` on 2026-10-26), open the PR, wait for `ci`, fix findings, merge with the expected head SHA.
