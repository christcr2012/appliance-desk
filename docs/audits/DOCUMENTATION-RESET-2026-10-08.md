# Documentation reset and remaining-work audit — 2026-10-08

Status: COMPLETE — static reconciliation; publication gates separate. Baseline: `b2a06c2` (main after PR #310). This audit changes documentation, not runtime behavior or provider activation.

## Original process recovered

The first reset was PR #138 (`ai/claude/docs-consolidation`), merge `ae28851`. Commits `c827427` and `1258431` moved the long HANDOFF, repository overview and obsolete execution/model-switch plans into `docs/archive/`; created START-HERE, STATUS, PLAN and PLAYBOOK; added RETIRED banners; redirected current links; preserved requirements and decision history; and checked links. PR #201 later rewrote remaining designs against the then-current code.

This reset repeats those steps while preserving the current approved two-lane workflow and all live-activation, spending, privacy and owner gates. Completed acceptance history remains accessible; active instructions must describe current code and only remaining work.

## Initial verified gaps

- STATUS and MASTER-ROADMAP still describe T-6b2 as active although #310 is merged.
- START-HERE still describes G/T as not built and omits S/COM/M/BP in its working vocabulary.
- PLAN is over 900 lines and repeatedly mixes completed acceptance history with current instructions.
- MASTER-ROADMAP duplicates current state and obsolete PR sizing tables; the paste-ready prompt asks for whole-design reading contrary to current bounded-reading rules.
- Only 12 implementation cards exist (plus the card README). Most remaining work has design paragraphs rather than executable, code-informed cards.
- Tax intake/RDF/screens, S, M, and later COM work explicitly prohibit implementation without missing bounded cards.

## Evidence and coverage

Code paths, tests, contract amendments, coverage and limitations are recorded below. Historical findings in the attached October 1 Package 1 report are evidence inputs; their old statuses are not accepted as current without checking the merged implementation and tests.

## Reconciliation completed

| Finding | Current evidence | Disposition |
|---|---|---|
| Stale completed-work status | Main `b2a06c2`, merged #310; tax finalization domain/tests | STATUS/START-HERE/roadmap corrected; T-6D1 is next |
| Completed and remaining instructions mixed | Old PLAN and roadmap vs current source | Full snapshots retired with banners; concise active acceptance and one owner handoff |
| Missing execution-card gate stalls | Existing design gates and 12 old cards | Implementer writes missing card before code; approved contracts preserved; compact 98-unit coverage index |
| Drift checked only once per batch | AGENTS/PLAYBOOK/design README contradictions | Every card and changed base reconciled; mechanical adaptation inline; semantic amendment reviewed |
| Mandatory model-switch/session stop | PLAYBOOK Step 11 and heavy-model clauses | Selected model owns routine cards; continue eligible work; preserve two-lane limit and exact-head merge gates |
| Acquisition liability mistaken for paid evidence | BATCH-T Amendment D vs T-6D2 | Conservative paid-evidence reconciliation; CPA IN-33 remains; home-rule kept distinct |
| Arbitrary ops note text claimed private by regex | BATCH-S D-S2/S-2 | External API structured only; staff free text private; typed error-code allowlist |
| Planned path mismatches | Actual `billing/provider-ops.ts`, customer tax panel, singular automation domain | Near-term card/registry evidence paths corrected; later references are hypotheses to reconcile at JIT authoring |
| Broad speculative feature expansion | Existing S/F/K/O design and appliance analytics | Four scoped enhancements folded into existing units, no new work lane or launch gate |

## Attached Package 1 audit — current evidence, not historical conclusions

The October 1 report's C1/C2 paths now live in
`src/domains/estimates/index-base.ts`: response writes use `lockEstimateInTx`,
approval checks expiration inside the transaction, and conversion locks the
estimate, creates drafts and marks CONVERTED atomically; a converted replay loads
agreements by `sourceEstimateId`. Related tests include
`agreement-estimate-concurrency-integration.test.ts` and
`remediation-r2-estimate-expiry-integration.test.ts`.
Maintenance transitions use guarded `updateMany` and scheduling rejects an
already SCHEDULED request; `maintenance-chain-integration.test.ts` covers its
lifecycle. Direct customer creation, estimate send/follow-up claims, bounded
customer records, portal isolation/photos and activity role tests exist in the
current suite (`customer-direct-create`, `estimate-follow-up-claim-integration`,
`remediation-r2-estimate-send-integration`, `customer-record-pagination`,
`portal-maintenance-photos`, `activity-role-access`). Test existence or sampled
source is not proof that every old finding is discharged.

F2-D must disposition **all 17** report findings individually (C1–C2, H1–H7,
M1–M8): current path, persisted behavior, named passing regression at exact head,
remaining fix or explicit deferral. Do not reopen already proved work by copying
the consultant's old command list. ENH-F adds inspection of approval's committed
state before activation-email dispatch; sender exception behavior must be proved
before calling this a current defect.

## Handoff and quality limits

MASTER-ROADMAP is the owner-facing handoff. PLAN holds acceptance; approved
designs preserve reasons; work-index is machine-readable coverage, not a second
owner reading assignment. Detailed T/S and initial COM cards exist. Later cards
are deliberately not prewritten: the implementer authors them after dependencies
are real, checking paths, schema, guards and tests. BP remains proposed and
owner/provider/legal activation gates remain explicit.

The chosen workflow aims to cut duplicate reading, stale card generation,
mandatory model handoffs, unnecessary local infrastructure setup and ceremonial
stops. The next three implementation PRs should measure merge time, failed CI,
substantive review defects and rebase work using existing history. No model
capability benchmark or implementation-speed improvement has been measured yet.

Validation: work-index uniqueness, dependency graph, current card existence,
near-term evidence paths, per-card drift instructions, enhancement ownership and
changed active relative links checked by `docs/pr-cards/validate-index.py`;
`git diff --check` passed. No runtime code changed. This was a static code/doc/
contract reconciliation, not a full security review, full-suite execution or
production/provider test. Historical archives intentionally retain original
relative references as evidence; their current landing page links are validated.
