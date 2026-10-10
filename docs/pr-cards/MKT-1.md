# MKT-1 — Metricool public campaign visit tracking

Status: engineering complete, merged #371. CI 38008066162 passed on 585cc8a2f49b4c419250e26667e464a95185ea2b. Production release/receipt remain separate.
Approved scope: owner request 2026-10-09 to connect robinsonappliancerentals.com to Metricool.
Baseline inspected: bee0039 (COM-L8 #370).
One risk area: public analytics/data minimization. No schema or business mutation.

## Drift and build contract
Public marketing chrome lives in src/app/(public)/layout.tsx, not the root layout.
Existing CSP allows only self images. Add the single Metricool image origin only
on public-layout documents so client navigation retains the permission. Tracking itself stays on the exact marketing route list. No third-party script permission.
Use the image protocol from the owner's supplied Metricool tracker: hash/u/bw/bh/ref.
Build the request locally to omit private query values, fragments and referrer paths.
Only production with a valid configured hash and matching HTTPS site origin activates.
No API/auth credentials, form contents, database/customer writes, email or SMS.
Respect DNT/GPC. Do not treat a queued image as evidence Metricool received it.
Privacy disclosure changes invalidate the previous privacy-page approval; do not
record an owner approval automatically. Existing approval workflow remains authoritative.

## Acceptance and verification
- tests/metricool.test.ts: environment, origin, route, query, referrer, privacy signals.
- tests/legal-gate.test.ts: old approval invalidation, current version agreement.
- e2e/security-response-headers.spec.ts: public/private CSP boundary.
- npm run check:quick; targeted unit tests; full required CI.
- Release only a green exact head; confirm production request and Metricool visits.
- Setting: METRICOOL_TRACKING_HASH, production only; blank disables.
Environment configuration is appropriate for this provider identity: credentials and
deployment-specific integration identities already live in Vercel, not business prices.
No marketing policy or rental terms are changed by the tracker.

Local preflight required a selected browser spec before running unit checks.
Per the owner cost rule, browser/build checks run in required free GitHub CI.
Direct targeted unit tests plus the full quick gate run before the branch push.

Review fixes: public-layout CSP survives privacy-to-marketing client transitions; returning via an excluded route counts a new visit. Component regression and real browser transition coverage added. Canonical public origin was absent in production (live JSON-LD said localhost); NEXT_PUBLIC_APP_URL is now configured to the business domain.

Closeout: 17 targeted tests, full quick gate, required CI and performance checks passed. Both review findings fixed with component/browser regressions. Owner explicitly authorized moving this to live on 2026-10-09. No workflow dispatch tool is exposed; an equivalent non-force fast-forward is authorized only after exact main ci succeeds, with a lease on observed live. Privacy review and actual Metricool receipt remain open.
