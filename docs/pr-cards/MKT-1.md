# MKT-1 — Metricool public campaign visit tracking

Status: implemented on ai/codex/metricool-public-tracking; exact-head CI and release required.
Approved scope: owner request 2026-10-09 to connect robinsonappliancerentals.com to Metricool.
Baseline inspected: bee0039 (COM-L8 #370).
One risk area: public analytics/data minimization. No schema or business mutation.

## Drift and build contract
Public marketing chrome lives in src/app/(public)/layout.tsx, not the root layout.
Existing CSP allows only self images. Add the single Metricool image origin only
on the exact marketing route list. No third-party script permission.
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
