## 2026-10-01 — Security and billing reliability audit (read before starting the next PR)

This note is part of the repo memory for the current AI coding agent and any future follow-on PRs.

The repo was reviewed for billing, webhook, auth, email/SMS, and public-form abuse risk. The main issues found are:

- Stripe webhook dedupe/race risk around duplicate or near-simultaneous event delivery
- delayed-settlement ACH/payment ambiguity during checkout completion before the final async success/failure event arrives
- silent external provider failure being treated as non-fatal without a clear surfaced result to the caller
- in-memory rate limiting being best-effort only and not a production-grade anti-abuse control across multiple serverless instances
- brittle preview safety logic that can fail closed if the preview database target changes

This is not a cleanup-only note. It is a project-level constraint that should be considered before any subsequent PR begins, especially any PR touching:

- billing or Stripe flow code
- invoice/payment state transitions
- webhook processing or event dedupe logic
- auth/session access logic
- public forms and abuse protections
- email or SMS provider calls

Future PRs must preserve the existing billing correctness and event-idempotency protections. They must not silently assume a provider send succeeded, and they must not treat the local rate limiter as a complete defense against real public abuse.

This note is intentionally written so a coding agent creating the next PR notices it before starting work. It is meant to reduce rework and merge conflicts caused by missing these constraints.

See `docs/AI-PR-READ-FIRST.md` for the full audit and the categorized fix-now / fix-soon / monitor list.
