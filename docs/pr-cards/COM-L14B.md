# COM-L14B — contextual communication evidence for jobs, maintenance and billing

Status: MERGED after exact-head CI and review (PR assigned at release). Baseline merged COM-L14A #383. No migration. Authority BATCH-COM §7-8, work-index and existing real code.

Deliver private context evidence on existing job, maintenance and invoice detail pages:
- Explicit MessageDelivery subject keys and CommunicationLink rows only; never matching by recipient phone, email, contact, agreement family, or customer name.
- Show chronological, bounded message/call notification facts with time, channel, truthful provider state, outcome, and safe resolving link for OWNER/ADMIN. Distinguish queued/accepted/delivered/failed/suppressed, no claim accepted means delivered. No body, media, provider error raw text, recipient address, cost, or customer secrets.
- STAFF may see only selected assigned-job contact-attempt facts with no inbox link, content, provider details, or finances; never general company history. Staff cannot view maintenance or invoice company communications. OWNER/ADMIN may drill to private thread. Future fixed templates still separately gated, no send operation on these panels.
- Data scoped in the query boundary to explicit source entity ID and role. If no explicit link exists, show missing evidence, not inferred contact. Keep bounded reads and "recent only" indicator rather than claiming a full archive.
- Real isolated PostgreSQL scope tests + unit tests for masking/delivery state/order/role, mobile browser/axe on owner screens; existing customer/lead timeline unchanged. Full CI and review, then MERGED index/STATUS/design. COM-L15 follows. Pause only after COM-L15 merge, before W-1.

## Implemented checks and review
- Private inbox has one accessible owner/admin message-to-work-record selector, not 50 duplicated forms. Bounded customer-specific choices and transaction-level ownership revalidation; upsert prevents duplicate links. The existing system keeps consent, reply and send gates unchanged.
- `getContextEvidence()` validates page actor and exact work-record scope in the query; STAFF gets no records except assigned job facts and no inbox links. `CommunicationLink` messages additionally require a verified thread whose customer matches the work record.
- Five pure unit tests for status language, bounds, no cross-context access and deduplication; three unit tests for verified owner link, cross-customer refusal and audit; two isolated real PostgreSQL tests for assigned-job scope; owner mobile/axe browser spec.
- No new provider calls, sender, feature activation, charges or schema migration. Automated review unavailable — waived. Self-review covers data minimization, security gates and bounded queries. Exact-head full CI required before merge.
