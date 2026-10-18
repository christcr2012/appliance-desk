# Identity, delegation and security contract

## Effective authority

For every dispatch calculate:

`effective = current user role/resource rights ∩ issued scopes ∩ selected business/environment ∩ current delegation policy ∩ actual provider/business gates`.

Server derives actor IDs and instance identity. This is a single-business installation at baseline; do not invent multitenancy by treating a caller-supplied business ID as isolation. An installation ID is set server-side. If multi-business support is added later, schema keys and all queries require a real tenant partition migration.

Owner can delegate all supported owner actions, admin only its actual subset, staff only assigned permitted work, customer only its records. Initial diagnostic catalog is owner/admin; deny staff/customer those tools even if an OAuth scope string is forged. Later role-scoped adapters can expose customer/staff capabilities deliberately. Archive/revoke/downgrade is checked on every call and again under the operation's lock before a mutation. A cached JWT signature does not override revocation.

## Connection types

| Credential | Intended authority | Compatibility rule |
|---|---|---|
| Existing OpsAgentKey | Existing issue read and structured note only | Keep existing endpoint behavior; never accept it as a new MCP/RTC credential or upgrade it automatically |
| OAuth connector | Existing signed-in user with approved scopes/policy | Authorization code + S256 PKCE; maintained provider; no implicit/password grant, wildcard redirect or disabled consent |
| RTC pass | Human-created, bounded delegation of current role | RTC 1 wire format, expiry and profile semantics; shown once in protected UI; hashed storage; never returned by a tool |
| Monitor service delegation | Owner-created noninteractive identity with finite scope | Separate revocable policy, expiry, action categories, environment and audit; no owner password or copied browser session |

OAuth client registration is not user registration. Support administrator pre-registration first and standard Client ID Metadata Documents with strict fetch controls; add bounded DCR for clients that require it. Anonymous registration grants no tool access and cannot set trusted/skip-consent flags. Registration metadata HTTPS fetch: reject userinfo, fragments, nonstandard schemes, private/loopback/link-local IPs including IPv6/mapped addresses; resolve and validate every redirect hop, cap redirects/bytes/time, pin validated destinations against DNS rebinding; test with controlled resolver. Explicit localhost callback exception only for permitted native loopback redirects, never for metadata fetch. Use exact redirect matching and an issuer bound to canonical origin; do not inherit wildcard Vercel hosts as trusted OAuth issuers.

Persist subject, client, resource/audience, grant ID, expiry, scope and connection choices. Access tokens default 15 minutes; refresh tokens rotate, default 30 days, with reuse detection invalidating the token family. These are configurable security starting values, not an entitlement ceiling. Provider adapter owns cryptography/PKCE/code replay protection; application stores revocation links and preserves policy version, areas, listing and environment on refresh. Do not put scope or role changes through a refresh grant. Reconsent for additional authority; compatible catalog updates need no new sign-in.

## User-selectable policies

Provide explainable presets: Observe (diagnostics), Maintain (selected recovery), Engineer (repair workflow and measurement), Custom. Presets are editable by the delegating owner and do not create authority above their role. No hard-coded $0/no-production policy for actual users. Show enabled operations, environments, cost exposure, destructive effects, whether action approvals are required, expiry, schedule and allowed delivery channels before consent. A policy has a version and summary hash.

`approvalMode = PER_ACTION | DELEGATED`; `allowedActions`, `allowedEnvironments`, optional monetary/budget limits, expiry and resource constraints are stored, validated and audited. Observe is the initial suggested selection, not the only available product mode. For irreversible/money/security actions display a meaningful preview and apply the user's chosen approval policy plus real provider/legal/domain requirements. RTC additionally requires wire `confirm: true` under its contract; that flag cannot create missing owner authority or approve itself. An already valid policy can permit unattended execution where no independent approval is required.

Approval receipts bind actor, connection, target, action, canonical args hash, preview hash, policy version, expiry and required source version. They are one-use under the operation lock; arbitrary client `confirm` never substitutes for the receipt when per-action consent is required. A delegated action records the authorizing policy/version instead. TOCTOU changes invalidate previews and require regeneration. An agent cannot widen its own grant or mint itself a pass. Owner/admin security changes reuse existing identity and reauthentication/MFA requirements.

## Confidentiality and malicious input

- Default outputs are typed safe diagnostic facts, not regex-scrubbed raw logs. No customers' names, addresses, contacts, message bodies, signatures, private media URLs, secret values or database dumps in generic diagnostics.
- Authorized domain-specific customer tools may return the specific fields their genuine role/resource grant permits. Diagnostic sanitization is not a permanent ban on legitimate business workflows.
- Issue notes, provider messages, repository content, repair evidence and retrieved text are untrusted data, never instructions to run a tool or expand authority. Report claims separately from verified evidence.
- Allowed repo is `christcr2012/appliance-desk`; allowed source paths are repository-relative and traversal-safe. Verify PR host/repo/number and trusted CI provenance before recording evidence. No arbitrary webhook URL, shell, SQL, outbound fetch or file write tool.
- Results and handles are bound to grant, subject, instance and environment; reauthorize retrieval after downgrade/revocation. Expire after 24 hours; never shared cache across principals. Private responses `Cache-Control: no-store`.
- Limit input/result bytes, nesting, list size and concurrent jobs. Reuse durable database rate limiting, extended to atomic two-instance counters. Initial rates: 60 requests/hour per credential (legacy limit preserved), owner-configurable new-agent policy rates; registration/login use independent IP/client controls so a tool quota cannot bypass them. HTTP 429 includes Retry-After.
- OAuth tokens, passes, approval secrets and auth backups are excluded from business recovery archives. Restoring business data cannot revive old grants, tokens, handles or worker leases. Immutable nonsecret audit evidence can be retained under the business retention policy.

## Developer operation boundary

Development agents remain under repository $0 unauthorized spend, real-data/provider restrictions, scheduled release, CI and review gates. Do not test product money, email, permissions or restore by mutating live resources. Test granted end-user capability with disposable fixtures and fake provider edges, then separately record authorized real acceptance. The design request authorizes documentation work, not live activation.

## Required adversarial proof

Wrong audience/issuer; expired/replayed code and refresh token; CSRF/state mismatch; redirect manipulation; metadata SSRF/rebinding; malicious note requesting a tool call; role downgrade and revocation during execute/refresh/readback; result handle theft; scope bypass through call/batch/RTC; concurrent budget reservation; fabricated CI/PR evidence; scheduled agent widening its own policy; secret/PII canaries in outputs/logs/archives. These are mandatory MCP-3/4/5/7/9 tests, not a later optional security audit.
