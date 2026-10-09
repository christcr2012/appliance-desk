# COM-L3 — Communications schema: threads, messages, links and templates

Status: MERGED (#352), after exact-head CI and review gates. Prerequisite: COM-L2 PR #346 merged as 12bcd837; baseline inspected main 12bcd837 (2026-10-09). Approved scope: docs/designs/BATCH-COM.md §2.1 and docs/MASTER-ROADMAP.md COM-L3. Risk area: one additive schema migration. No runtime sends, provider activation, UI, spending or live changes.

## Checklist A — contract drift before coding
| Assumption | Actual on main | Disposition |
|---|---|---|
| Foundation account, numbers, contact points and attempts | Prisma models from COM-L2 are present at 12bcd837 | Compatible extension; add reciprocal relations and composite scoped FKs |
| Existing deliveries have no template lineage | MessageDelivery records and email stay intact | Add nullable templateRevisionId, no backfill |
| MessagePurpose supports existing transactional and marketing | Prisma enum has those two variants | Add approved CONVERSATIONAL value without changing legacy rows |
| Backup policy covers every model and orders FK dependencies | src/domains/backup/manifest.ts and scripts/lib/table-order.ts | Register five new models and verify restoration |
| Review issues inherited from #346 | No open review threads; automated code review hit usage limit | Manual diff review; no carried findings |

## Build contract
- CommunicationThread unique for account + business number + contact point. Cross-account number/message links forbidden by composite FKs. Customer vs lead is exclusive, never guessed from phone.
- CommunicationReadMarker is per thread and staff user; read cursor must point to the same thread. Authorization and cursor movement belong to L6B.
- CommunicationMessage has stable order and account/provider identity; inbound stores encrypted body without a fake delivery; outbound requires a real MessageDelivery and never duplicates it.
- CommunicationLink uses an enum allowlist for approved business entities and references a real message; L7 will add calls, L14 contextual transaction checks.
- CommunicationTemplateRevision is versioned per key, freezes used contents, binds a unique current revision, and keeps a consistent channel and purpose per template family. Frozen revision pointer on MessageDelivery is optional for historical messages. L6A adds validation/approval behavior, not this schema migration.
- All existing consent, callback, delivery state, email and provider gating remain unchanged and default off. No raw secrets stored or backed up.

## Tests and acceptance
- Prisma validate/generate, migration-safety and backup dependency-order check.
- Disposable local PostgreSQL: tests/communications-threads-schema-integration.test.ts covering scoped FKs, thread uniqueness, subject exclusion, per-user cursor uniqueness, inbound/outbound evidence, provider ID deduplication, links, revision uniqueness/immutability and backup.
- npm run check:quick, focused npm run preflight -- --db, then exact PR-head ci and security/schema manual review. One migration only. No paid preview unless Vercel's current rules require it.

## Reconciliation B (before publishing)
Document schema in docs/DATABASE.md; mark PR merged and advance Next in docs/STATUS.md inside this same PR. Later COM-L4A must inherit these exact schema relations, no new provider permissions or send switches.


## Implementation and acceptance evidence (2026-10-09)
- PR #352 implements five additive models, MessageDelivery.templateRevisionId, CONVERSATIONAL message purpose, composite FKs, SQL CHECKs, scoped inbound/outbound guards and immutable template revisions. No legacy data reclassified, no provider activation.
- On disposable PostgreSQL, 5/5 communications schema tests pass. The populated restore drill proves preservation of all five new tables and the existing circular delivery/attempt link. Each repeat restore uses its own newly created local target; production backup restore safety remains unchanged.
- Local quick/type/lint gates passed (one unrelated existing unused import warning); preflight passed 64 related + 18 selected tests. Exact PR-head CI and GitHub review/merge status are the final authority.
- Downstream COM-L4A inherits account, thread, provider and template invariants in CHANGES-SINCE-DESIGN. No change to consent, live runtime gates or business pricing.
