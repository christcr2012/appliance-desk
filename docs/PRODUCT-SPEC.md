# Product spec — features & acceptance criteria

Organized by the phase plan in `docs/HANDOFF.md`. Each feature lists what
"working" means for it. Update this file as each phase is built —
acceptance criteria should be written (or at least sketched) *before* a
feature is built, not reverse-engineered after.

## Phase 1 — Foundation (this phase)

### Repo, Vercel, Neon, CI

- [x] Private GitHub repo `christcr2012/appliance-desk` exists, `main` is
      the default branch.
- [x] Vercel project `appliance-desk` exists in the Robinson AI Systems
      team, connected to the repo.
- [x] Neon project "Appliance Desk" exists with database `appliance_desk`.
- [x] CI (`.github/workflows/ci.yml`) runs migrate-deploy → typecheck →
      lint → unit tests → build → accessibility tests on every PR.
- **Acceptance:** a PR against `main` shows all CI checks and a Vercel
  preview deployment.

### Auth with roles

- [x] `OWNER` / `ADMIN` / `CUSTOMER` roles exist on the `User` model.
- [x] `/login` — accessible email/password form (labeled fields, errors
      tied to fields, keyboard-navigable).
- [x] `/desk/**` requires `OWNER` or `ADMIN`; anyone else is redirected.
- [x] `/account/**` requires any signed-in user.
- [x] Enforcement happens on the server (`requireRole`/`requireSession`),
      not just by hiding navigation.
- **Acceptance:** `tests/session.test.ts` proves a `CUSTOMER` is
  redirected away from an `OWNER`/`ADMIN`-only page and vice versa where
  applicable; `e2e/accessibility.spec.ts` proves the login page passes
  automated a11y checks.

### Docs skeleton & error monitoring

- [x] All files listed in `AGENTS.md` exist.
- [ ] Sentry is wired in code (`instrumentation.ts` /
      `instrumentation-client.ts`) but **inactive** until `SENTRY_DSN` /
      `NEXT_PUBLIC_SENTRY_DSN` are set as real values in Vercel — see
      `docs/HANDOFF.md`.

## Later phases

Feature lists for Phases 2–7 will be filled in here as each phase
starts, following the phase plan and scope in `AGENTS.md`/
`docs/HANDOFF.md` — kept short until then rather than speculatively
detailed now.
