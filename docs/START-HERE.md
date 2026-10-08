# START HERE â€” Appliance Desk

Robinson Appliance Rentals is Chris's Colorado appliance rental business. Appliance Desk is one Next.js application: the public site, owner/staff Desk and customer portal. It runs on Vercel with Prisma/Neon, Better Auth, Stripe (test), Resend, dormant Twilio, private media, Vitest and sharded Playwright/axe. Chris operates it mostly from a phone; controls and errors must be plain language.

## Read only what this work needs

1. AGENTS â€” workflow and hard limits.
2. [STATUS](STATUS.md) â€” current head/state/next item.
3. [MASTER-ROADMAP](MASTER-ROADMAP.md) â€” one owner/agent handoff and work coverage.
4. Next execution card, then its named design/code/test sections. If JIT, write the short card from approved semantic contracts first; [drift protocol](implementation-contracts/DRIFT-PROTOCOL.md) applies every time.
5. PLAN's relevant acceptance and PLAYBOOK's relevant verification commands.

## Code map

`src/app` routes; `src/domains` rules/transactions; `src/lib` shared/provider/access boundaries; `src/components` UI; `prisma` schema/additive migrations; `tests` behavior and real Postgres; `e2e` browser/axe/shards; `scripts` CI/operations. Domains are singular `automation` and existing purchasing receives parts, not magically appliances. Confirm actual path before editing.

## Fast path to real-database testing

Vercel Sandbox already has PostgreSQL server binaries at
`/usr/lib/postgresql/18/bin` (not necessarily on PATH). For transactions,¶»§q«^