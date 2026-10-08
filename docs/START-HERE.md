# START HERE — Appliance Desk

Robinson Appliance Rentals is Chris's Colorado appliance rental business. Appliance Desk is one Next.js application: the public site, owner/staff Desk and customer portal. It runs on Vercel with Prisma/Neon, Better Auth, Stripe (test), Resend, dormant Twilio, private media, Vitest and sharded Playwright/axe. Chris operates it mostly from a phone; controls and errors must be plain language.

## Read only what this work needs

1. AGENTS — workflow and hard limits.
2. [STATUS](STATUS.md) — current head/state/next item.
3. [MASTER-ROADMAP](MASTER-ROADMAP.md) — one owner/agent handoff and work coverage.
4. Next execution card, then its named design/code/test sections. If JIT, write the short card from approved semantic contracts first; [drift protocol](implementation-contracts/DRIFT-PROTOCOL.md) applies every time.
5. PLAN's relevant acceptance and PLAYBOOK's relevant verification commands.

## Code map

`src/app` routes; `src/domains` rules/transactions; `src/lib` shared/provider/access boundaries; `src/components` UI; `prisma` schema/additive migrations; `tests` behavior and real Postgres; `e2e` browser/axe/shards; `scripts` CI/operations. Domains are singular `automation` and existing purchasing receives parts, not magically appliances. Confirm actual path before editing.

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
