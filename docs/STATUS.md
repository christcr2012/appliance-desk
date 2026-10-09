# STATUS — current work, blockers and next action

Updated October 9, 2026 (main `aea29ba3`). **Batch T is engineering-complete** (through T-7D #328). **Batch S is
complete:** S-1A #330, S-1B #331, S-1C #332, S-2 #334 (plus the test-fixture drift fix #333). **COM-L1A** (#335) and
**COM-L1B** (#336) are merged. No live payments, customer messages, fee charging or tax filing are activated.

## Next

**2026-10-09 — Batch W approved (IN-57…IN-60).** Next implementation: **W-0A** then **W-0B** (`docs/pr-cards/W-0A.md`, `W-0B.md`; no prerequisite, no migration) — they fix purchase use tax that could never be calculated and a dead Today link. Then COM-L resumes at COM-L2; W-1…W-8 come after COM-L15 and before V. Design: `docs/designs/BATCH-W.md`.

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
- This workspace has generated Prisma clients and reusable dependencies. The existing Vercel Sandbox has PostgreSQL 18 binaries outside PATH; on October 8 an isolated 127.0.0.1-only database named appliance_desk_test was migrated/seeded and 27 real-Postgres targeted integration tests passed. GitHub CI uses PostgreSQL 17 and remains the exact-head gate; no Neon or production database was used.

History and prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use its old unchecked boxes as the current queue.

Older entries (October 8 cleanup, K-CASH design note, publication-check note, S-2, COM-L1A and COM-L1B evidence) moved to
[archive/STATUS-LOG.md](archive/STATUS-LOG.md) on 2026-10-09.
