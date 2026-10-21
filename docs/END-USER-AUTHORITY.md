# End-user authority versus developer-agent restrictions

**Owner decision: October 16, 2026.** This overrides interpretations of implementation-agent rules as permanent restrictions on the capabilities offered to actual users. It is a product-architecture decision, not permission for the current implementer to incur charges or change live accounts.

## Separate actors

**Developer coding agents** build, test, verify, review and deploy the service. Their $0 unauthorized-spending, no-unapproved-live-action, production-off, release, acceptance and fixture restrictions remain in force during implementation. These restrictions are not end-user product requirements.

**The end user and the end user's delegated agent** must be able to perform **every feasible provider-supported operation within their actual permissions**, including paid or metered resources, financial operations, access/security administration, live/production changes, deletion and other irreversible actions. Show meaningful cost, risk, scope, privacy and reversibility notices. Support the user's choice of delegated authorization, optional caps and per-action approvals; impose additional confirmation only where the provider, law, or the user's own policy requires it. A developer-only approval cannot silently prevent a genuinely entitled user or their properly delegated agent from carrying out the action.

## Product implementation contract

- The provider and end user's credentials, entitlements, revocations, account/tenant scope, user-configured policies and platform protections are binding. User delegation never bypasses those, grants another person's authority, or permits leaking confidential credentials.
- A sensitive action must have a useful preview/warning when practical. Disclose genuine price estimates and **unknown or unbounded metered exposure**, without misrepresenting unknown cost as $0. An uncertain price is **not in itself** a reason to make a provider-supported action forever read-only or “guide only.”
- Implement real execution for supported APIs with correct permissions, journal/replay controls, verification and explicit failure/uncertainty reporting. Guided paths are only a legitimate final outcome if the provider itself requires an unavailable/manual interaction; missing implementation remains a roadmap gap, not an accepted feature.
- Optional limits chosen by users are legitimate. **Do not inherit the developer's defaults** such as $0 autonomous spending, scratch-only mutations or production-off as permanent user restrictions. Do not weaken the developer's independent prohibitions while coding/testing this requirement.
- Audit code, design, catalog, setup defaults, decisions and tests for unconditional blockers on spending, security, destructive work, production, owner/admin changes and money-out. Classify each: developer-only, true provider constraint, user-configured delegation, or missing product capability. Remedy the latter through the normal repository roadmap and review/CI/release workflow.

## Acceptance expectations

Tests must separately prove: (1) developer/CI actors cannot spend or mutate real/live resources outside their approvals; (2) properly entitled end users and their agents can execute provider-supported actions after the user-configured authorization and accurate warnings, including operations prohibited to our developer agents; (3) out-of-scope, revoked and improperly delegated actions are still blocked; and (4) financial/irreversible effects are journaled without unsafe retries.

This decision applies across **GitHub MCP, Stripe MCP, Vercel MCP, Neon MCP, Google Workspace MCP, Robinson's Toolkit Hub**, and applicable user-facing projects. Service-specific authority boundaries, including the distinction between tenant/customer/owner/admin roles, remain real and enforceable. This documentation update does **not** certify that runtime remediation or live acceptance has completed.

## Appliance Desk application roles

For Appliance Desk, **a customer must not gain owner/operator powers** merely because an agent is authorized by that customer. Capabilities are those granted by that account's genuine customer, owner or staff role. The builder's prelaunch test-only constraints do not eliminate owner-authorized product features once launched, but the existing owner-controlled go-live choices remain intentionally deferred until enabled by the business owner.

## Sol 5.6 remaining verification and correction contract — owner 2026-10-21

This is explicitly requested implementation preparation for the universal permissions
directive, not new authentication infrastructure or a second roadmap. Continue
AGENTS/SESSION-START, the active work-index packet and MASTER-ROADMAP ordering.
K-CASH-4A/4B PR #508 is merged; K-CASH-5A/5B PR #509 is currently draft.
Reconcile both and actual main/live before editing; do not replace that concurrent
financial source or freeze a new financial scope. Attach confirmed defects to the affected original card.

### Existing behavior to reuse and audit boundary

Better Auth and trusted invitation/provisioning already exist. Public signup stays
disabled. Roles OWNER/ADMIN/STAFF/CUSTOMER are server-owned; archived sessions must
fail, and desk/customer queries must enforce access independently of navigation.
A prior focused run passed 33 session/operational-customer/language authorization
tests. That is limited regression evidence, not complete live/customer isolation.

This is business software, not a provider MCP or a newly approved multi-business
SaaS. Do not add provider OAuth or a universal tenant system without architectural
need. Robinson AI Systems developer/operator access and Robinson Appliance Rentals
production business use are separate operation contexts; neither email domain nor
company affiliation grants OWNER/admin. Keep explicit assigned application roles.
Do not remove genuine money, signed-contract, privacy or user-selected protections
as supposed developer-only limits. Coding-agent spending/release rules still bind
the implementer, not an ordinary authorized production customer's capabilities.

### Concrete source and verification seams

- `src/lib/auth.ts`: Better Auth, trusted provisioning and server-controlled roles.
- `src/lib/session.ts`: authenticated actor, active account and role enforcement.
- `src/domains/security/sessions.ts`: session revocation/administration.
- `src/app/api/auth/[...all]/route.ts`: actual auth route, cookie/session boundaries.
- `src/app/desk/customers/[id]/operational-customer.tsx`: follow its server loaders,
  actions and DTO projections; a hidden UI control is not an authorization check.
- `prisma/schema.prisma`: existing identity/customer/ownership relations; use
  additive migrations only when a confirmed defect needs them.

Extend `tests/session.test.ts`, `tests/operational-customer-access.test.ts`,
`tests/customer-language-authorization-w26.test.ts`,
`tests/customer-isolation.test.ts`,
`tests/auth-provisioning-security-integration.test.ts`,
`tests/session-control-integration.test.ts` and
`e2e/session-deactivation.spec.ts` as affected. Trace actual exports/callers before
freezing selectors; do not invent tests that merely mirror implementation.

### Ordered remaining work and measurable completion

1. Recover the active approved unit with `npm run work -- start` and its checked
   packet. Inventory auth-sensitive routes/actions/search/export/download/results
   used by that unit; record actor, required role, customer relation, query predicate,
   DTO, side effect and existing regression. Reconcile prior passing behavior.
2. Trace developer-only versus genuine business/user/provider restrictions through
   selected unit settings, dispatch/domain functions and UI. For each confirmed
   defect freeze the exact input → authorization → locked storage → DTO/effect
   contract in that original card/packet, then implement all callers/fakes together.
   If no defect is found, record bounded audit evidence rather than inventing code.
3. Use disposable customers A/B, inactive user, staff, explicitly assigned admin
   and owner. Prove A cannot guess B's record, action, export, attachment or result;
   foreign requests cause no mutation/disclosure. Prove valid own-record use and
   legitimate staff/owner business operations succeed. Domain membership alone must
   never promote a user. Use synthetic identities only.
4. Prove trusted provisioning rejects caller-chosen elevated roles, public signup
   stays disabled, session revocation/archiving takes effect, logout/account switching
   cannot retain another actor, and CSRF/cookie boundaries hold. Protect privileged
   role/session changes separately. Preserve customer-versus-staff data projections.
5. For writes follow existing transaction/row lock and `assertActiveTeamActor`
   pattern. Recheck role/customer scope inside the transaction; update all affected
   fakes and DB fixtures together. No real customer messages/payments during tests.
6. Run focused tests via the current packet, `npm run work -- check` and the existing
   preflight. Use `npm run test:db -- tests/customer-isolation.test.ts` only against
   disposable storage; use `npm run test:browser -- e2e/session-deactivation.spec.ts`
   for actual login/session regression. CI disposable logins come from the approved
   fixture script, never public signup or production accounts. Preserve secret scan,
   exact-head ci/all required gates and any scorecard/review requirements.
7. Update the original card, packet, STATUS and acceptance ledger with precise scope.
   Implemented/tested/merged/deployed/live are distinct. Daily release, real financial
   provider, customer consent and professional sign-offs remain separate. Missing local
   Postgres blocks only local DB proof: use authorized CI and continue other work.

Resume prompt: Complete the universal permissions/authentication audit and confirmed
corrections within this project's existing approved scope. Read this section,
AGENTS/SESSION-START and the active packet; reconcile current main/open work/live
acceptance. Reuse existing Better Auth and role/customer isolation, implement only
confirmed gaps, test disposable identities through actual server boundaries, address
review and merge when required gates pass. Do not invent a provider-MCP architecture,
multi-business retrofit or background completion.
