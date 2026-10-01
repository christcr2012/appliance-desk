# Security and billing reliability audit — read before starting the next PR

This note is intentionally added to the repo so the AI coding agent and future contributors see it before starting work on the next PR.

## Why this exists

This audit was written after reviewing the repo's billing, Stripe webhook, auth/session, and public-form protections. It is not a general cleanup note. It is a production-risk checklist that must be considered during any subsequent PR work.

This note is meant to be read before the next PR is opened, and it should be treated as a blocking design input for any code that touches:

- billing or Stripe payments
- webhook processing or invoice state
- auth/session access checks
- external messaging (email/SMS)
- public forms or abuse protections
- preview/deployment environment validation
- any code that changes payment state, invoice state, or customer/business-record integrity

## Required interpretation for future PRs

The following findings are not optional suggestions. They are the current baseline for code review.

### P0 / fix before merge

1. Stripe webhook idempotency and race safety
   - File: `src/domains/billing/webhooks.ts`
   - Risk: at-least-once webhook delivery plus delayed payment settlement can produce duplicate or partially applied state in a narrow concurrency window.
   - Requirement: future PRs touching billing webhooks must preserve or improve dedupe and must include regression tests for duplicate event delivery and async payment outcomes.

2. ACH / delayed-settlement ambiguity
   - File: `src/domains/billing/webhooks.ts`
   - Risk: checkout/session completion can happen before money has actually cleared; the system intentionally waits for the async payment event, but that creates a temporary ambiguous state that must be monitored.
   - Requirement: future PRs must not treat a checkout completion as final payment unless Stripe has confirmed the payment cleared.

3. Silent provider failures must not be mistaken for success
   - File: `src/lib/email.ts`
   - Risk: failure states are often downgraded to `{ sent: false }` without surfacing the real failure to the caller.
   - Requirement: future code that depends on email/SMS delivery must check the provider result and handle operational failure explicitly.

4. Public anti-abuse controls are best-effort only
   - File: `src/lib/rate-limit.ts`
   - Risk: in-memory rate limiting does not protect against distributed attackers across multiple Vercel instances.
   - Requirement: future PRs on public forms must not treat the in-memory limiter as a sufficient production-grade anti-abuse defense. If a feature needs strong protection, the real fix should be a persistent or managed rate-limited solution.

### P1 / fix before broad rollout or next release

5. Matching Stripe invoice lines to rental lines by label is brittle
   - File: `src/domains/billing/webhooks.ts`
   - Risk: exact description matching can fail when labels change or pricing logic evolves.
   - Requirement: future billing changes should preserve a clear, auditable mapping from Stripe line items to local billing records.

6. Hardcoded preview database host enforcement is brittle
   - File: `src/lib/preview-database-safety.ts`
   - Risk: preview restrictions fail closed if the preview database branch changes.
   - Requirement: preview-environment safety must be updated deliberately when infrastructure changes, and tests must cover the allowed/disallowed host cases.

7. Session access checks should be defensive
   - File: `src/lib/session.ts`
   - Risk: assumptions about the exact `session.user` shape can create login access edge cases if auth behavior changes.
   - Requirement: future auth-related work should prefer defensive validation and explicit deny-by-default behavior when role or archived-state data is missing.

### P2 / monitor and document

8. Payment method resolution may be incomplete for future Stripe types
   - File: `src/domains/billing/webhooks.ts`
   - Risk: new payment methods or Stripe API shape drift can produce missing payment metadata.
   - Requirement: future billing work should log and handle unsupported payment types explicitly.

9. Silent external service failures can create false success states
   - File: `src/lib/email.ts`, `src/lib/sms.ts`
   - Risk: operational failure can be invisible to users and staff.
   - Requirement: callers should record failed messages in an audit trail or visible status when the business action depends on the message being delivered.

## Repository-specific guidance for the next PR

Before starting the next PR, the agent should do the following:

- Review the billing webhook path and confirm no code change introduces a new duplicate or partial-payment path.
- Check whether the PR touches any public form and, if so, confirm the rate limiter is not being treated as a strong security barrier.
- If the PR touches Stripe or invoice records, add explicit regression tests for duplicate event delivery and delayed-settlement outcomes.
- If the PR touches email or SMS, verify the caller checks provider result and does not assume a send succeeded.
- If the PR touches authorization, confirm unknown/missing role data still denies access.
- If the PR touches preview/runtime safety, verify any allowed-host logic still matches the current Neon/Vercel environment.

## Merge gate for this audit

This note is intentionally written as a project-level constraint for future work. It should be reviewed before any subsequent PR merges. The goal is not to block all work, but to ensure the next PR does not regress the correctness and safety of the billing and auth paths that are already the most sensitive parts of the app.

This audit should be considered a valid input for all later PR planning and merge decisions.

## Files reviewed during this audit

- `src/domains/billing/webhooks.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/lib/stripe.ts`
- `src/lib/deployment-safety.ts`
- `src/lib/preview-database-safety.ts`
- `src/lib/session.ts`
- `src/lib/rate-limit.ts`
- `src/lib/email.ts`
- `src/lib/sms.ts`

## Summary

The repo is more production-aware than a typical early business app, and some of the safeguards already in place are good. The main unresolved risks are concentrated in:

- Stripe webhook concurrency and duplicate-delivery handling
- delayed-settlement financial state transitions
- external provider failure handling
- public-form abuse protections that are intentionally weak outside a single instance

These constraints must be accounted for in subsequent PRs and should be treated as part of the project memory, not as optional follow-up tasks.

---

This note was added on 2026-10-01 as a project safety audit for future AI agent PR work.

