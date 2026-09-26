# AGENTS.md — read this first, every session

This is the provider-neutral constitution for every AI system working on
this repo (Claude, ChatGPT/Codex, Astra, Augment, GitHub Copilot, or any
other). Tool-specific files (`CLAUDE.md`, etc.) point back here and must
never contradict it. The repo — not chat history — is the memory. If it
isn't written down here or in `docs/`, assume the next AI won't know it.

## What this is

**Appliance Desk** — the operating system for Chris Robinson's appliance
rental business in Colorado: a public website that brings in leads, an
admin "desk" where Chris runs the business, and a customer portal.
Chris is the owner/operator and **is not a developer** — every status
update or question directed at him must be plain, non-technical English.
See `docs/OWNER-GUIDE.md` for how *he* uses the finished product.

Purpose-built for appliance rental. Not a generalized SaaS or
multi-industry platform — don't add abstractions "in case" another
industry needs them.

## Never touch existing projects

This is a NEW, standalone project. Never modify, reuse, rename, delete,
or repurpose the existing Cortiware, Robinson AI Systems toolkit,
YardSync, Household Assistant, or oldReplit repositories/Vercel
projects/Neon projects. If you're unsure whether something already
exists under a name you're about to use, ask before creating it.

## Priorities, in order

Correctness & security → legal compliance (accessibility, privacy) →
simplicity & maintainability → features.

## Definition of Done (non-negotiable)

A feature is not done until **all** of these are true:

1. No placeholder functions, stub logic, TODO-as-implementation, or mock
   data presented as real.
2. It's covered by automated tests that exercise the real behavior — not
   just "it renders" or "it compiles."
3. CI (tests + type-check + lint + accessibility checks + build) passes.
4. It's been verified against the acceptance criteria in the relevant
   `docs/` file.

If you can't fully finish something, **say so explicitly** and mark it
incomplete in `docs/HANDOFF.md`. Never present partial work as finished.
Chris has been burned by overclaiming before — honesty about what is and
isn't working matters more than looking complete.

## Stay in scope

Build only what the current phase (see below) asks for. If you think of
something else worth doing, add it to `docs/ROADMAP.md` and mention it to
Chris in your report — don't build it unasked.

## Ask before anything irreversible or costly

Stop and ask Chris before: turning on live Stripe payments, buying
anything (domains, paid plans, add-ons), deleting real data, or changing
anything outside this project.

## Branching & PRs

- `main` is production. Protect it with required PRs + passing CI where
  the plan allows (Neon's free tier currently caps protected branches —
  see `docs/DECISIONS.md`).
- AI agents never commit directly to `main`.
- Branch names: `ai/<tool>/<topic>` for AI work (e.g.
  `ai/claude/customer-portal`), plus `feature/…` and `fix/…`. No GitFlow.
- Open a PR, make sure CI passes, get a preview deployment, update
  `docs/HANDOFF.md`, and stop to report to Chris before starting the next
  phase.

## Where the rules actually live

- Pricing, lead scoring, statuses, fees → `docs/BUSINESS-RULES.md` (one
  source of truth — never hard-code a price or a status transition
  outside what that doc describes).
- Database shape and why → `docs/DATABASE.md` + `prisma/schema.prisma`.
- System wiring (Vercel/Neon/GitHub, env vars) → `docs/ARCHITECTURE.md`.
- Accessibility rules → `docs/DESIGN-SYSTEM.md`.
- Dated decisions and why → `docs/DECISIONS.md`.
- Current state / what's incomplete → `docs/HANDOFF.md` — **read this
  first every session**, and **update it before ending any session.**

## How to run things

```bash
npm install               # installs deps; postinstall runs `prisma generate`
npm run dev                # local dev server
npm run typecheck           # generates Next.js route types, then tsc --noEmit
npm run lint                 # eslint (includes jsx-a11y rules)
npm test                      # unit tests (vitest)
npm run test:e2e               # Playwright + axe accessibility tests
npm run build                   # production build
npm run db:migrate:dev            # create + apply a migration locally
npm run db:migrate:deploy          # apply pending migrations (CI/production)
npm run db:seed                     # one-time: creates Chris's OWNER account
```

CI (`.github/workflows/ci.yml`) runs migrate-deploy, typecheck, lint,
unit tests, build, and Playwright/axe accessibility tests against a real
throwaway Postgres — on every PR and on `main`.

## A real constraint you should know about

The sandbox this project was originally built in could not reach
`binaries.prisma.sh` (Prisma's engine download host), so **local**
`prisma generate`/`migrate` calls failed there with a 403. This is a
sandbox network policy, not a bug in the app. GitHub Actions and Vercel
both have normal internet access and run these commands successfully —
CI passing is the real verification gate, not any one contributor's
local sandbox. If you hit the same 403 in your own environment, don't
retry or work around it — note it and move on. See `docs/DECISIONS.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
