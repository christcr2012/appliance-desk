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
| F — Integrated verification, recovery, owner handoff & launch ledger | `BATCH-F.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | Approved. **Split 2026-10-06 (IN-41):** F-part-1 (WU-F1, F2, F4, F5) built; F-part-2 (WU-F3, F6–F9) after G, T and V — see the design's Amendments. Starts after E2; recovery must respect D privacy deletion and must never resurrect intentionally deleted private media. |
| T — Colorado sales and use tax | `BATCH-T.md` | **Built** (through T-7D #328). Stays here as the reference for current tax behavior; W-0/W-2/W-3 change parts of it. CPA answers IN-33 … IN-38 still gate live billing. |
| V — "Evergreen Signature" visual redesign | `BATCH-V.md` | **Approved 2026-10-06** (Chris). After S/COM-L, before F-part-2; includes V-C1…C5 full content controls and redesign compatibility. Concept in `docs/design-mockups/signature-2026-10-06/`. |
| W — Workflows that tell the owner what to do (To do list, guided intake/tax/rentals, setup checklist, simpler menu) | `BATCH-W.md` | **Approved 2026-10-09** (Chris). W-0A/W-0B now; W-1…W-8 after COM-L, before V. |
| S — System issues inbox and the AI check-up | `BATCH-S.md` | **Built** (S-1A #330 … S-2 #334). Reference for current behavior. |
| M — Shop sales (merchandise) and retired appliances (sell, strip for parts, scrap, throw away) | `BATCH-M.md` | **Approved 2026-10-07** (Chris). After K (Chris will not sell before launch, IN-47). Retired appliances: "what's next" plan, revised 2026-10-07. |
| K-CASH — Cash envelopes, planned costs, bank checks, reports and QBO handoff | `BATCH-K-CASH.md` | Owner-requested 2026-10-08; documentation review pending. Proposed after K-8 before M; launch unchanged. No accounts/provider activation. |
| K — Books, expenses, P&L, accounting exports | `BATCH-K.md` | **Approved 2026-10-06** (Chris). After T; may run after launch. |
| O — Owner controls | `BATCH-O.md` | **Approved 2026-10-06** (Chris). After K; includes O-6/O-7 control center and saved workspace. |

**Completed batches** (B, B2, C, D, E, E2, G, R) are retired to `docs/archive/designs-completed/` (2026-10-09). Their
behavior is in the code and tests; open them only to look up the reasoning behind a specific shipped rule. Code comments
that cite `docs/designs/BATCH-B2.md` or `docs/designs/BATCH-D.md` mean the same file in that folder. `POST-BATCH-D-RECONCILIATION-2026-10-05.md`
stays here because F-part-2 still depends on it.

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
