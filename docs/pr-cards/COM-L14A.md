# COM-L14A — Customer and lead unified communications timeline

Status: MERGED after exact-head CI and review (PR assigned at release). Baseline main 7e47395 (COM-L13B #382 merged). No migration or provider activation. Design BATCH-COM section 7, 8 and work-index COM-L14A.

Acceptance:
- Append *confirmed, FK-linked* communication messages and calls to owner/admin customer chronological timeline (existing notes+audit). Equal-timestamp stable order by occurrence time, source kind and ID; bounded 26-per-source reads, one 25-item merged page, tamper-resistant cursor with stable retries. Filters include communication activity; no secondary infinite history load.
- Lead detail gets bounded private communication history with a stable cursor and safe links to the exact inbox thread/call. No matching by raw phone alone and no cross-customer/family contact merges.
- Distinguish INBOUND versus OUTBOUND, SMS accepted/delivered/failed/unknown (accepted is not delivered), call missed/voicemail/answered/unknown. Do not decrypt/render bodies or private media in timeline. Redaction remains safe. Legacy MessageHistoryPanel stays until migrated; it clearly links to detailed communications context.
- Role validation OWNER/ADMIN in both pages and domain access; STAFF/CUSTOMER never gain general history or company billing. Tests prove equal-time cursor across all kinds, no cross-account/context leakage, delivery state semantics, duplicate avoidance, read limit; isolated real PostgreSQL plus route smoke/axe when necessary.
- STATUS/work-index/design note updated as if merged, exact-head full CI, self diff review, no unresolved threads. Automated review unavailable — waived if quota stays exhausted.
Next COM-L14B contextual job/maintenance/billing, then COM-L15; owner pause only after COM-L15 merges before W-1.

## Evidence and implementation detail
- `context-timeline.ts` enforces OWNER/ADMIN at its query boundary and only returns messages/calls through RESOLVED threads tied to a specific Customer or Lead foreign key. It selects no message body, phone, provider URL, recording, secrets or cost and caps each chronological stream at 26.
- Customer timeline merges notes, audit activity, SMS and calls using deterministic time/source/id ordering with one cursor and communications filter; lead contact history similarly paginates linked records and internal notes, while retaining legacy email history. It never infers association from shared numbers.
- Text delivery distinguishes provider-accepted versus delivered/failed/unknown; call results distinguish missed, voicemail and answered. Links point to the protected inbox/thread or call detail.
- `tests/communication-timeline.test.ts`: cursor/tie/scope/render semantics. `tests/communication-timeline-integration.test.ts`: real PostgreSQL isolated customer/lead/unresolved thread and page-boundary proof. `e2e/communication-timeline.spec.ts`: owner mobile navigation and accessibility. All still require full exact-head CI and review prior to merge.
- No migration, live sender, consent override or payment/telecom-cost change. Automated review unavailable — waived unless feedback arrives; inspect the diff and resolve any review findings before merge.
