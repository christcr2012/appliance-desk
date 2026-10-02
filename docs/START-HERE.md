# START HERE — what this project is and where everything lives

Read after `AGENTS.md`. This file changes rarely. Current state is in
`docs/STATUS.md`; the work is in `docs/PLAN.md`; the procedure is in
`docs/PLAYBOOK.md`.

## The business, in one paragraph

Robinson Appliance Rentals rents washers and dryers (first), with delivery,
installation and maintenance included, to households and property managers
in Greeley, Colorado and the surrounding area. Chris Robinson owns and runs
it, often from a phone between shifts in his other job. The business is
preparing to launch; Stripe is in test mode, customer email/SMS sending is
off, and the public site makes no promises about opening dates. Evergreen
v2.0 is the brand (evergreen/ivory/fresh-green, Manrope).

## The product, in one paragraph

**Appliance Desk** is one Next.js application with three faces:

- **Public website** (`/`): catalog, pricing, lead form, launch-list signup.
- **The Desk** (`/desk/**`): where Chris and staff run the business — Today,
  leads, customers (with properties/contacts), estimates, rental agreements
  and e-signature, jobs/dispatch/driver view, inventory (appliances, parts,
  purchasing), maintenance, billing/invoices/statements, reports, tasks,
  staff, settings. Roles: OWNER, ADMIN, STAFF (restricted — no finance).
- **Customer portal** (`/account/**`): rentals, maintenance requests with
  photos, billing, pickup requests, signing.

Stack: Next.js 16 App Router + TypeScript strict · Tailwind · Prisma +
PostgreSQL on Neon · Better Auth · Stripe (test) · Resend (email) · Twilio
(SMS, dormant) · Vercel Blob (private files) · Sentry · Vitest · Playwright +
axe · GitHub Actions · Vercel (preview per PR, production on `main`).

## Where things live in the code

```
src/app/            routes: (public) pages, /login, /account/**, /desk/**, /api/**
src/domains/<x>/    business logic by domain — all rules and writes live here, not in pages
src/lib/            auth, prisma, email, sms, stripe, session, rate-limit, uploads
src/components/     shared UI (desk primitives, pagination, status badges, forms)
prisma/             schema.prisma + migrations/ (additive only) + seed.ts
tests/              vitest unit + real-Postgres integration tests (~1,000)
e2e/                Playwright + axe browser tests (24 files), shards.json
scripts/            CI/ops scripts: migration check, schema health, CI login, shard runner
.github/workflows/  ci.yml
docs/               everything below
```

## The documents, by purpose

**Working set — read these; they are current and short:**

| File | What it is |
|---|---|
| `AGENTS.md` | The rules. |
| `docs/START-HERE.md` | This file. |
| `docs/STATUS.md` | Where work stands: batch table, blockers, what is next. Updated every session. |
| `docs/PLAN.md` | The six remaining batches (A–F) with full acceptance criteria, and the launch gates. |
| `docs/PLAYBOOK.md` | Step-by-step procedure for a batch, including local verification. |
| `docs/OWNER-INPUTS.md` | Decisions only Chris can make, with stable IDs. |

**Reference — open the section you need; do not read end to end:**

| File | What it is |
|---|---|
| `docs/BUSINESS-RULES.md` | Prices, fees, discounts, lead scoring, statuses and transitions. The one source of truth for business behavior. |
| `docs/PRODUCT-SPEC.md` | What each screen/flow does, by role. |
| `docs/DATABASE.md` | Tables, why they are shaped that way, backup policy. |
| `docs/ARCHITECTURE.md` | Vercel/Neon/GitHub wiring, env vars, email addresses, CI layout and the 5-minute CI budget guide. |
| `docs/DESIGN-SYSTEM.md` | Tokens, components, accessibility rules. `docs/brand/` has the Evergreen kit. |
| `docs/plans/overhaul/DESIGN.md` | Screen blueprints and interaction specs for the desk/portal overhaul (sections 4–8 are the ones batches cite). |
| `docs/OWNER-GUIDE.md` | How Chris operates the finished product. Keep it true as features land. |
| `docs/AI-PR-READ-FIRST.md` | Blocking security/billing constraints for any PR touching money, auth, messaging, public forms. |
| `docs/DECISIONS.md` | Dated log of decisions and why. Append; search; never read whole. |
| `docs/ROADMAP.md` | Ideas and deferred items not being built now. |
| `docs/AUDIT_SYNTHESIS.md` | The audit program's root causes (RC1–RC12) and the original batch definitions; `docs/PLAN.md` is the executable version. |
| `docs/audits/Package-*.md` | The eight detailed audit reports (117 findings, cited by ID in the plan). |
| `docs/reviews/` | Business audit B01–B36, historical review-thread ledger, earlier reviews. |
| `docs/plans/overhaul/PREVIEW-SETUP.md`, `PREVIEW-ISOLATION-PROOF.md` | How previews are isolated from production, with evidence. |
| `docs/plans/overhaul/GOOGLE-WORKSPACE.md`, `CLAUDE-WORKSPACE-SETUP.md`, `docs/plans/google-workspace-integration/` | Google Workspace integration spec and setup register (Batch E, conditional). |
| `docs/OPERATIONS_SYSTEM_AUDIT.md`, `docs/AUDIT_ROADMAP.md` | Earlier operational audit; audit program closeout. |

**Archive — `docs/archive/`:** retired documents kept for history (the old
3,500-line HANDOFF, the old plan files with model-switch schedules and
card-per-PR rules, the old repository overview). Nothing in there is an
instruction. If an archived file and a working file disagree, the working
file wins.

## Vocabulary you will meet

- **Batch A–F** — the six remaining PR-sized units of work (`docs/PLAN.md`).
- **O-cards (O00–O32)** — the original overhaul roadmap items. They are now
  folded into the batches; the plan quotes their requirements inline.
- **B01–B36** — Chris's business audit items (`docs/reviews/2026-10-01-business-logic-audit.md`).
- **P1 C1, P8 H3, …** — audit findings: Package number, severity (Critical/High/Medium), index.
- **RC1–RC12** — the twelve root causes the findings collapse into.
- **IN-01…** — owner inputs (`docs/OWNER-INPUTS.md`). **GW-01…** — Google
  Workspace setup items.
- **Gate / acceptance** — the evidence a batch must show before it is done.
- **Preview** — Vercel's per-PR deployment on an isolated database.
