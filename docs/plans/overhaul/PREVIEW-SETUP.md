## Current hosted prerequisite — passed, 2026-10-01

Original store saved as Production only under explicit owner approval; both
original synthetic fixtures removed. New foundation/tasks checkpoint deployed
READY and its owner-only hosted runtime check passed private write/read,
unsigned denial and exact owned-file cleanup/absence. See
[PREVIEW-ISOLATION-PROOF.md](PREVIEW-ISOLATION-PROOF.md) for exact evidence.
O09/O10 infrastructure prerequisite cleared; final integrated batch gate G is
pending. Older checkpoint blockers below are historical. No separate proof PR,
full-CI rerun, production activation or enabling of preview photo/backup APIs.

## Hosted evidence update — 2026-10-01

Owner approved dashboard fallback and preview-only credential creation.
Private store store_6Sttks2ULJ8wG5hl connected to Preview only; hosted runtime
DB fixture and provider private-file isolation checks passed. See
[PREVIEW-ISOLATION-PROOF.md](PREVIEW-ISOLATION-PROOF.md) for exact identities,
outcomes, limitations and remaining steps. O02 remains incomplete pending
restriction of the original production-store connection (automatic approval
review blocked this unapproved scope change), exact owned-fixture cleanup,
new deployment/runtime file proof and batch gate G. This supersedes the
earlier unavailable-dashboard blocker; no dependent schema or small PR yet.

## Earlier batch 1 checkpoint — 2026-10-01

Reverified Neon preview br-broad-union-b784qy62 is separate from protected
production br-wild-smoke-b7etke32, under appliance-desk project
jolly-term-08991992. Vercel project prj_3HAWVPau4QJqPu8hf6PbgRBlbLOi belongs
to team_PUafLQmqT7LYBaBs8lEOPYMG and has preview SSO protection.
Vercel get_project currently needs both projectId and idOrName arguments.

O02 remains BLOCKED on hosted runtime fixture and independent private file
workflow proof. Current connectors expose project/deployment inspection but
no Vercel environment/storage mutation tools. This workspace has no Vercel
CLI, VERCEL_TOKEN or Blob token. Do not publish a small proof-only PR or begin
O09 schema before the gate. Browser fallback requires owner permission under
the browser tool access rule; request that access, not passwords in chat.

Concrete next action once browser fallback is authorized:
1. Inspect existing Appliance Desk storage and environment scopes in the Vercel
   dashboard; verify current usage/limits before creating anything.
2. Establish preview-only storage credentials/namespaces separate from the
   production store, with independent private file proof. Preserve the existing
   photo workflow and production settings. If a paid upgrade is required, stop
   and present that concrete requirement rather than buying it.
3. Verify the hosted preview migration/runtime target; create a UUID-owned
   disposable record through the actual preview app. Confirm it exists in the
   preview branch and is absent in production through a narrowly scoped read.
4. Verify a synthetic private file write/read in the independent preview store,
   denied anonymous access and absence from production storage. Clean up only
   owned fixtures using supported application/provider operations.
5. Record redacted resource identities and actual outcomes. Then implement
   task assignment/priority/version, audit/validation, migration health/backup
   coverage and UI as the remainder of this same substantial batch.

No runtime write/storage/configuration proof has been performed or claimed.
The already shipped guards continue to deny preview photo tokens and backup
operations until independent storage is verified.

# O02 preview database safeguard

Status: IN_REVIEW safeguard; full O02 incomplete.

Read-only Neon metadata on 2026-09-30 verifies project jolly-term-08991992:
- Production main: br-wild-smoke-b7etke32, ep-ancient-glitter-b7q9bto9.
- Separate vercel-preview-2: br-broad-union-b784qy62, ep-silent-hill-b7rpraoc.

preview-database-safety.ts permits the verified preview endpoint's stable
direct/pooled aliases only, database appliance_desk, standard Postgres protocol
and port. DIRECT_URL must be unpooled. Missing, malformed, production, unknown
and alternate query-parameter targets fail closed without printing secrets.
prisma.config.ts calls this before Prisma CLI connects; lib/prisma.ts calls
it before creating or reusing the runtime client. Endpoint replacement must
be verified through Neon before changing the non-secret allowlist.
Production and local/CI without Vercel markers retain existing behavior.

Preview email/SMS remain suppressed; Stripe requires test keys. Preview photo
uploads and backup operations remain disabled until independent storage is
verified. No environment secrets/targets were mutated. A passing preview build
proves configured migration/runtime URLs pass the guard and schema reads work;
it does not constitute the required disposable runtime-fixture proof or
independent file workflow. Those, and upgrade proof, remain O02 acceptance gates.
