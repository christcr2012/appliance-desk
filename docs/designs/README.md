# Designs — approved contracts and current-code reconciliation

Each batch in `docs/PLAN.md` has a design document here. The plan says
**what** a batch must achieve and how it is accepted; the design says
**how**: the decisions already made (with the reasoning, so edge cases can be
resolved in the same spirit), the exact schema text, the function signatures,
which existing pattern to copy, the work units in order, the named tests, and
the points where the implementer must stop and ask instead of guessing.

| Batch | Design | Status |
|---|---|---|
| COM — Business communications, calls and telecom costs | `BATCH-COM.md` | Approved by Chris 2026-10-08. Architecture and L1a/L1b/L2 cards ready; runtime not started. Launch phase after T/S before V/F-part-2, near-term after K/O. |
| BP — Business offers, permission/installation evidence and partnerships | `BATCH-BP.md` | Proposed 2026-10-07 at owner request; documentation only. Reuses T/K/M/O and existing billing/renewals. Implementation requires accepted design and bounded cards after prerequisites. |
| B — Billing, provider reconciliation & financial ledger | `BATCH-B.md` | Built and merged; its renewal/pickup leftovers were completed by B2. |
| C — Rental-to-service operations, custody, inventory & purchasing | `BATCH-C.md` + `BATCH-C-UPDATE-2026-10-03.md` + `BATCH-C-LITERAL-SPEC-2026-10-03.md` | Built and merged; its shared billing-end leftover was completed by B2. |
| R — Remediation Batch R | `REMEDIATION-BATCH-R-2026-10-04.md` (+ amendment, recovery) | Built and merged. |
| B2 — Renewal lifecycle, month-to-month rentals, pickup billing end | `BATCH-B2.md` | Built before Batch D; D's implementation uses these contracts. |
| D — Owner/customer control plane, website, evidence & privacy | `BATCH-D.md` | Built and merged; final PR #214. |
| E — Communications, automation history, search, brand tokens & accessibility | `BATCH-E.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | Built and merged; final PR #222. |
| E2 — Visual redesign (owner desk, portal, public site; phone, desktop, dark) | `BATCH-E2.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | Built and merged through #263. Public-site visual quality is explicitly deferred for a stronger later pass. |
| F — Integrated verification, recovery, owner handoff & launch ledger | `BATCH-F.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | Approved. **Split 2026-10-06 (IN-41):** F-part-1 (WU-F1, F2, F4, F5) built; F-part-2 (WU-F3, F6–F9) after G, T and V — see the design's Amendments. Starts after E2; recovery must respect D privacy deletion and must never resurrect intentionally deleted private media. |
| G — Audit fixes and owner-account security | `BATCH-G.md` | **Approved 2026-10-06** (Chris). Built and merged. |
| T — Colorado sales and use tax | `BATCH-T.md` | **Approved 2026-10-06** (Chris). Before F (launch blocker). Policy answers come from Chris's CPA (IN-33 … IN-38). |
| V — "Evergreen Signature" visual redesign | `BATCH-V.md` | **Approved 2026-10-06** (Chris). After S/COM-L, before F-part-2; includes V-C1…C5 full content controls and redesign compatibility. Concept in `docs/design-mockups/signature-2026-10-06/`. |
| S — System issues inbox and the AI check-up | `BATCH-S.md` | **Approved 2026-10-07** (Chris). Four bounded capabilities after T, before COM-L/V. |
| M — Shop sales (merchandise) and retired appliances (sell, strip for parts, scrap, throw away) | `BATCH-M.md` | **Approved 2026-10-07** (Chris). After K (Chris will not sell before launch, IN-47). Retired appliances: "what's next" plan, revised 2026-10-07. |
| K — Books, expenses, P&L, accounting exports | `BATCH-K.md` | **Approved 2026-10-06** (Chris). After T; may run after launch. |
| O — Owner controls | `BATCH-O.md` | **Approved 2026-10-06** (Chris). After K; includes O-6/O-7 control center and saved workspace. |

**2026-10-05 post-D reconciliation.** D, E and F had been designed/reworked against code that predated the actual
Batch D implementation. Before any E code is written, read
`POST-BATCH-D-RECONCILIATION-2026-10-05.md`. It records the implemented D contracts and the exact E/E2/F amendments:
D's new privacy-verification sender joins E's message ledger migration; E updates D's existing `METRICS` registry
instead of creating competing definitions; B08 lead scoring becomes a versioned BusinessSettings policy in E's
already-planned Lead/BusinessSettings migration; E's distributed limiter preserves D's public-privacy semantics;
E2 keeps D's draft website preview and versioned legal gate; and F's second private-media copy may never survive a
verified privacy deletion or be restored later. Where the older E/E2/F text conflicts with that reconciliation, the
reconciliation wins.

The older 2026-10-02 designs remain under `docs/archive/designs-2026-10-02/` for history; they are not instructions.

**Order and coverage:** `docs/MASTER-ROADMAP.md` is the single handoff; its
work-index lists existing cards and just-in-time units. Current STATUS overrides
historical scheduling language in designs. Keep the original work acceptance.

## Design and card authority

Approved designs define semantic behavior. Execution cards organize the next
coherent capability against actual code; they cannot silently override money,
privacy, permissions, signed facts or provider recovery. A dated reviewed
amendment wins over the older paragraph. Mechanical drift is adapted in the same
PR without asking the owner or switching models.

The selected implementing model writes routine execution cards as needed using
`docs/pr-cards/README.md`. Read only the relevant decision/schema/work-unit/test
headings. A DRAFT business design still needs acceptance; a missing execution
card simply needs authoring. A false historical assumption triggers reconciliation,
not an automatic stop. Check current code and evidence before duplicating work.

## Drift on every implementation

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md` before each card and
whenever its prerequisite changes. Record actual heads and contract differences.
A renamed path or equivalent helper needs a card correction and targeted proof.
An unresolved semantic conflict needs a dated reviewed amendment before that
slice; the selected model may write it under existing authority. Owner-only gates
remain explicit. Continue eligible work and update CHANGES-SINCE-DESIGN in the
same PR. Do not produce separate per-session handoff documents.
