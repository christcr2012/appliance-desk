# Archive — retired documents, kept for reference only

Nothing in this folder is an instruction. These files were the working
documents before the 2026-10-02 consolidation, or were later retired when they
became too large for routine working context. They are kept so history,
reasoning and evidence can be looked up. If anything here disagrees with
`AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md`, `docs/PLAYBOOK.md`, or the
current `docs/DECISIONS.md`, the working file wins.

| File | What it was | Why you might open it |
|---|---|---|
| `DECISIONS-before-2026-10-03.md` | Retired index for the original decisions log, with the same warning convention as the other retired documents. The unchanged historical payload is linked from that file. | Look up a specific pre-2026-10-03 decision, dated citation, feature rationale, or old code comment that says “see docs/DECISIONS.md”. Do not read the historical payload end to end during normal work. |
| `HANDOFF-2026-09-26-to-2026-10-02.md` | The session-by-session handoff log from the first build through Batch A (3,500 lines, newest first). | Evidence for a specific PR; the reasoning behind a test convention; what a given day's session verified. Code comments that cite "HANDOFF" point here. |
| `STATUS-LOG.md` | Entries trimmed from `docs/STATUS.md` after they aged out. | Status of batches older than the last two. (Created when the first entry is trimmed.) |
| `REPOSITORY_OVERVIEW-2026-09.md` | An early third-party overview of the repo. Describes the app as a maintenance ticketing system; out of date. | Historical curiosity only. |
| `plans-overhaul/README.md` | Index of the original overhaul plan, with the Sol/Luna model-switch schedule. | Understanding why old PRs are shaped the way they are. |
| `plans-overhaul/TASKS.md` | The 32 original implementation cards (O00–O32) with their model assignments and the "gate G" definition. | The card text is quoted in `docs/PLAN.md`; open this only to see the original wording or the 2026-09-30 status table. |
| `plans-overhaul/REMAINING-BATCHES.md` | The 2026-10-01 five-batch roadmap plan. Replaced by the A–F batches in `docs/PLAN.md`. | Why Batch 1 (#134) was scoped the way it was. |
| `plans-overhaul/COMPLETION-PLAN.md` | The 2026-09-30/10-01 completion plan with its evidence ledger (CI run IDs, test counts per PR). | Exact CI run / head SHA evidence for PRs #96–#133. |
| `plans-overhaul/EXECUTION-STATE.md` | The resume checkpoint used before `docs/STATUS.md` existed. | Same as above. |
| `plans-overhaul/MODEL-BATCHES.md`, `IMPLEMENTER.md`, `PR-STACK.md` | Model-switch schedule, paste-ready prompts, stacked-PR rules from the first plan. All superseded (single model, larger PRs, agent merges). | Historical only. |
| `designs-2026-10-02/BATCH-{D,E,F}.md` | The first D, E and F designs (written 2026-10-02, before B was built). Replaced 2026-10-05 by drift-checked rewrites in `docs/designs/`. | Seeing what changed in a decision and why (the rewrites mark changes "(changed 2026-10-05)"). |
| `prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md`, `prompts/DESIGN-BATCH-E2-REDESIGN.md` | Prompts asking a stronger model for the renewal-lifecycle design and the E2 design. Both answered 2026-10-05 (`docs/designs/BATCH-B2.md`, `BATCH-E2.md`). | History only. |
| `plans-overhaul/BASELINE.md`, `WORKSPACE-IMPLEMENTATION.md`, `ROLE-AUDIT.md` | O00 baseline reconciliation, workspace implementation notes, role audit. | Evidence behind early decisions. |

| `reset-2026-10-09/AGENTS.md`, `PLAYBOOK.md`, `MASTER-ROADMAP.md` | Full rules, procedure and roadmap before the 2026-10-09 reset (510, 574 and 290 lines). The current files keep every rule in about 40% of the length. | The original wording or date of a specific rule. |
| `designs-completed/` | Designs for finished batches B, B2, C (with its update and literal spec), D, E (with its drift note), E2, G and Remediation R (with amendment and recovery), retired 2026-10-09. Code comments citing `docs/designs/BATCH-B2.md` or `BATCH-D.md` mean these files. | The reasoning behind a shipped rule. Behavior itself: read the code and tests. |
| `prompts/` | Design and review prompts that were answered (Batch C literal specs, IN-24 pickup billing, Remediation R implementation, renewal-notice review), retired 2026-10-09. | History only. |
| `reset-2026-10-08/` | Snapshots from the 2026-10-08 reset (STATUS, PLAN, MASTER-ROADMAP, START-HERE). | Earlier wording of those files. |

Files that are still current stayed where they were:
`docs/plans/overhaul/DESIGN.md` (screen specs), `PREVIEW-SETUP.md` and
`PREVIEW-ISOLATION-PROOF.md` (preview isolation evidence),
`GOOGLE-WORKSPACE.md` and `CLAUDE-WORKSPACE-SETUP.md` (Google setup
register), and everything under `docs/audits/` and `docs/reviews/`.
