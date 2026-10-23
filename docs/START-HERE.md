# START HERE — Appliance Desk

**Implementing something? Read [/AGENTS.md](../AGENTS.md) (rules), then [SESSION-START.md](SESSION-START.md) and [AGENT-QUICKSTART.md](AGENT-QUICKSTART.md)** — the whole loop on one page, with every known CI failure and its fix. Anything only Chris can do goes on [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md).

**Professional-review engineering:** the [researched implementation contract](designs/PROFESSIONAL-REVIEW-IMPLEMENTATION.md)
maps the professional-review IN register to configurable data, owner controls,
evidence, failure cases and tests. Build the current approved outcome while
affected real use awaits verification; keep planning assumptions distinct from
genuine review. Research/design/code continue under the owner's standing rule.

**October 15 research and integration detail:** after the active W-22FIN packet,
read the [concrete integration contract](implementation-contracts/W-22FIN-INTEGRATION.md)
for verified code seams, worked cents, atomic acceptance/recovery and completion
tests. [Decision follow-through research](research/2026-10-15-owner-decision-follow-through.md)
records current official tax/RDF, payments, communications, retention and accounting
findings with implementation consequences. These are design aids; W-22FIN remains
unfinished, existing real-use gates remain, and K-CASH/BP stay proposed.

**New October 14 decision-to-implementation routing:** October 13 owner
answers cover **56 distinct subjects** (not 56 open PRs). For the
currently active W-22FIN or any future next approved unit, read the
[owner decision implementation map](owner-decisions/2026-10-13-implementation-map.json)
and [engineering/acceptance addendum](designs/OWNER-DECISIONS-2026-10-13-ENGINEERING.md)
after the usual work-index/card and before implementing policy-dependent
customer/owner behavior. Maintain order, leave proposed future designs
unapproved and preserve real-use legal/provider gates. CI guards coverage
with scripts/check-owner-decisions.mjs.


Robinson Appliance Rentals is Chris's Colorado appliance rental business. Appliance Desk is one Next.js application: the public site, owner/staff Desk and customer portal. It runs on Vercel with Prisma/Neon, Better Auth, Stripe (test), Resend, dormant Twilio, private media, Vitest and sharded Playwright/axe. Chris operates it mostly from a phone; controls and errors must be plain language.

## Read only what this work needs

1. Implementing a capability: `npm run work -- start` (checked packet, no install needed), then [SESSION-START](SESSION-START.md) (one page). Otherwise AGENTS — workflow and hard limits.
2. [STATUS](STATUS.md) — current head/state/next item.
3. [MASTER-ROADMAP](MASTER-ROADMAP.md) — ordered scope/work coverage; STATUS holds the current handoff.
4. Next execution card, then its named design/code/test sections. If JIT, write the short card from approved semantic contracts first; [drift protocol](implementation-contracts/DRIFT-PROTOCOL.md) applies every time.
5. PLAN's relevant acceptance and PLAYBOOK's relevant verification commands.

## Code map

`src/app` routes; `src/domains` rules/transactions; `src/lib` shared/provider/access boundaries; `src/components` UI; `prisma` schema/additive migrations; `tests` behavior and real Postgres; `e2e` browser/axe/shards; `scripts` CI/operations. Domains are singular `automation` and existing purchasing receives parts, not magically appliances. Confirm actual path before editing.

## Fast path to real-database testing

Vercel Sandbox already has PostgreSQL server binaries at
`/usr/lib/postgresql/18/bin` (not necessarily on PATH). For transactions,
tax, billing, migrations, permissions and idempotency, use
`bash scripts/local-postgres-test.sh tests/<relevant-spec>.test.ts`
from the repository root. It runs against a freshly created, disposable
**localhost-only** `appliance_desk_test`. Read
[PLAYBOOK §4b](PLAYBOOK.md#4b-local-real-postgresql-testing-in-vercel-sandbox)
for the exact procedure, safeguards and fallback. Never use a Neon
preview/production database for these tests. CI's independent PostgreSQL 17
suite remains required for merging.

## One authority per fact

| Fact | Authority |
|---|---|
| Workflow/hard limits | AGENTS; PLAYBOOK for command recipes |
| Current state / ordered work | STATUS / MASTER-ROADMAP |
| Remaining acceptance | PLAN |
| Business/domain design | designs/BATCH-* (targeted headings); next card for exact execution |
| Card coverage / drift | pr-cards/work-index.json; shared DRIFT-PROTOCOL |
| Owner-only inputs / release gates | OWNER-INPUTS / GO-LIVE-CHECKLIST |
| Runtime facts | code/schema/tests; BUSINESS-RULES, DATABASE, ARCHITECTURE updated as behavior ships |
| Product/look/owner operation | PRODUCT-SPEC, DESIGN-SYSTEM, OWNER-GUIDE |
| Proposed business policy | business/README and BP design; not automatically active |
| Historical evidence | archive, audits, reviews and dated DECISIONS; never current instructions |

Preserve all stable finding/O-card/B/IN IDs. All future work starts default-off where it could create commitments. Keep signed customer terms immutable. Do not turn a proposed plan or passing test into a claim of live readiness.
