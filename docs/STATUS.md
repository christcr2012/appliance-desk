# STATUS — current work, blockers and next action

Updated October 9, 2026 (main `aea29ba3`). **Batch T is engineering-complete** (through T-7D #328). **Batch S is
complete:** S-1A #330, S-1B #331, S-1C #332, S-2 #334 (plus the test-fixture drift fix #333). **COM-L1A** (#335) and
**COM-L1B** (#336) are merged. No live payments, customer messages, fee charging or tax filing are activated.

## Next

**2026-10-09 — Batch W approved (IN-57…IN-60).** Next implementation: **W-0A** then **W-0B** (`docs/pr-cards/W-0A.md`, `W-0B.md`; no prerequisite, no migration) — they fix purchase use tax that could never be calculated and a dead Today link. Then COM-L resumes at COM-L2; W-1…W-8 come after COM-L15 and before V. Design: `docs/designs/BATCH-W.md`.

**Recovered unfinished work (2026-10-09, read before starting anything):** found uncommitted in the Vercel Sandbox
`appliance-desk-s1c-oct8` and committed there (not on GitHub; the sandbox clone has no push credentials):
- `/vercel/appliance-desk-com-l2`, branch `ai/gpt6/com-l2-foundation`, commit `02e715a` — **COM-L2 started**: schema
  (+217 lines), migration `20261012130000_com_l2_telecom_foundation`, backup manifest, and
  `tests/communications-foundation-integration.test.ts`. Unverified. When COM-L2 comes up, run drift checklist A on it
  against current `main` (rename the migration folder if a later one exists) and finish it instead of starting over.
- `/vercel/appliance-desk`, branch `recovery/t7d-leftovers-2026-10-09`, commit `691a02f` — edits to the tax overview
  (`workspace-overview.ts`, `sales-tax/page.tsx`, its test, T-7D card, contract log) left after #328 merged. Compare with
  `main`; keep only what main lacks, as part of W-3 (taxes in one place) — or discard if superseded.
  The main sandbox checkout is on that recovery branch: `git checkout main && git pull` before new work.
- **Carried test fix:** `tests/system-issue-sweep-integration.test.ts` › "health sweep creates no duplicate …" compares
  global table counts while other test files run in parallel, so it can fail by chance (#337 CI). Make it race-free
  (assert the sweep's own writes, not global counts) in the next PR that touches Batch S code, or in W-0B.

**Order after W-0:** COM-L2 … COM-L15 → W-1 … W-8 → V → F-part-2. Keep owner/legal/CPA and live payment
gates. [MASTER-ROADMAP](MASTER-ROADMAP.md) is the single handoff; [PLAN](PLAN.md) owns acceptance; implementing sessions
start at [SESSION-START](SESSION-START.md).

## Built

A/B/C/R/B2/D/E/E2, F-part-1, G, T (engineering) and S are merged; COM-L1A and COM-L1B are merged. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Engineering complete through #328; owner/CPA/provider/go-live gates remain |
| S | **Complete** (#330–#334) |
| W-0A/W-0B → COM-L → W-1…W-8 → V → F-part-2 | Approved remaining launch engineering and final product proof |
| K → M → O → COM-N | Approved later engineering; K/M after launch unless owner reschedules |
| BP | Proposed business documents/design; runtime acceptance still required |
| O32/O29/direct QBO/P/COM-A | Explicitly deferred or owner-selected prerequisites |

## Gates and limitations

- Stripe test; live customer email/SMS off. Owner approvals still govern activation, provider purchases and production writes.
- CPA/attorney/GIS, COM setup/consent/retention, V visual approval and final launch inputs remain in OWNER-INPUTS/GO-LIVE-CHECKLIST.
- Official-page fetchability does not prove a tax answer. Preserve source failures and the manual path.
- Historical audits remain final-review inputs under F2-D; this cleanup is not a full security certification.
- See **Environment** below for local database testing.

History and prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use its old unchecked boxes as the current queue.

## Environment (update when it changes)

- **Local database testing:** Vercel Sandbox, project `appliance-desk`. Persistent sandbox in use:
  **`appliance-desk-s1c-oct8`** (most recently active, 2026-10-09; main checkout `/vercel/appliance-desk`, per-card
  worktrees beside it, PostgreSQL 18). Older persistent `appliance-desk-batch-t1` may have an expired snapshot. Resume,
  don't recreate — steps in PLAYBOOK 4b. Stop the session when done.

Older entries (October 8 cleanup, K-CASH design note, publication-check note, S-2, COM-L1A and COM-L1B evidence) moved to
[archive/STATUS-LOG.md](archive/STATUS-LOG.md) on 2026-10-09.
