# Drift protocol — every card, every changed base

This is an implementation procedure, not a new approval gate. Existing new cards were inspected against `b2a06c2` on October 8; later cards deliberately depend on future contracts. Expect code to move. Never copy an obsolete function or migration just because the card names it.

## Before editing (one bounded pass)

1. Record `git rev-parse HEAD`, current main, prerequisite PR/head and the card revision. Preserve unrelated local work; use an isolated branch if needed.
2. Read STATUS, the immediate predecessor's final PR description and review dispositions, and only relevant dated CHANGES-SINCE-DESIGN entries. If a review exposed an unfixed issue in this area, carry it with a named test.
3. `git diff --name-status b2a06c2..HEAD -- <card's domain paths> prisma/schema.prisma` (use the card's later recorded checked base on repeat). Inspect changed named functions and tests in ≤150-line sections. Map renamed/moved paths using narrow `rg --files <domain>`, not a fresh repository audit.
4. Compare: schema fields/defaults/unique constraints; exported signatures/result unions; caller transaction and lock order; role/capability/storage scope; persisted event and timestamp sources; exact money ownership and rounding; runtime/provider activation fence; test fixtures and current route/shard registry.
5. Fill the following table in the PR. Add a short dated handoff to CHANGES-SINCE-DESIGN only when a downstream contract changed; a match/mechanical-only result needs no duplicate shared-log entry. Update the card's affected paragraphs before implementation; keep the original rationale in the design and decision log.

| Assumption | Actual code/test at head | Disposition | Card correction / proof |
|---|---|---|---|
| Named predecessor contract | path + symbol + evidence | match / mechanical / implemented / semantic | exact edit or test |

## Resolve drift without unnecessary stalls

- **Mechanical** (rename, moved file, equivalent type/helper, changed test fixture): adapt path/import/signature to current code, update card, run the relevant regression. No owner question and no new planning PR.
- **Already delivered**: identify actual domain + persisted behavior + meaningful passing test/merged PR. Remove that duplicate work from this card and keep residual requirements; a symbol or unchecked historical box alone does not prove completion.
- **Compatible extension** (new category or required DTO field with explicit predecessor contract): incorporate it in validators/allowlists/tests. Exhaustive branches must remain exhaustive. Preserve the original financial/authorization behavior.
- **Semantic** (different cash ownership, tax rule, signed snapshot, status transition, lock order, provider replay, data exposure or schema invariant): do not guess at low effort. Write a precise decision question and proposed safe contract patch with affected tests; obtain a reviewed design amendment within the current PR before coding that part. Stop only the affected slice, continue authorized independent work within the ordered two-lane chain. If this model can resolve it within the user's architecture authority, write and review the amendment; no automatic model switch.
- **Owner-only** (new price/promise/paid resource, legal wording, live activation, production destructive write): preserve the existing gate and ID; engineer the default-off/manual/fallback path when it is already designed. Missing owner answers do not justify pretending success.

## During implementation and handoff

A predecessor fix/rebase/retarget invalidates the drift record: freeze successor, sync once to final prerequisite, repeat only checks for changed contracts. Never maintain divergent copies of a shared domain/helper. Don't rewrite merged migrations: use the next unique additive migration and its populated-upgrade drill.

Every implementation PR must hand off unresolved review IDs with dispositions, remaining acceptance, and any necessary successor card updates, even if no contract changed. When a downstream contract changes, also record actual schema/migration ownership, public signatures/result-union changes, guards, locking, settings/defaults and activation gates, and fixture/test changes in the shared contract log. Update those successor pointers in the same PR when known; never mark a future card already re-verified. STATUS points at the next eligible card and exact head. The card registry remains the authoritative coverage list; cardinality may change when a coherent over-budget card is split, but no acceptance unit may disappear.

## Drift is checked, not wished away

A card is usable because it supplies a complete contract and an explicit reconciliation procedure. It is not permanently valid because it was written by a stronger model. No check here guarantees absence of all code defects; exact-head tests, preview and review remain the completion evidence.
