# MKT-2 — Hide public pricing during discovery
Status: engineering complete; merged with this PR.
Owner approved 2026-10-09: immediately hide all public pricing and the pricing page during interest discovery.
Baseline: 9b51c2b; independent owner request, does not reorder COM/W.
Drift: public prelaunch homepage already exists, but nav, pricing/city routes and sitemap still expose rates.
Contract: reuse stored prelaunchMode. When enabled, remove pricing navigation, redirect pricing/city pages before fetching prices, omit them from sitemap and omit structured priceRange. Home preview query cannot bypass prelaunch. Remove unused price props from contact client payload. Preserve all internal price data and live-mode behavior.
Acceptance: e2e/launch.spec.ts verifies homepage, direct routes, prices and sitemap. Required full CI and preview checks before merge; verify actual domain after release.
No schema, billing, auth, customer records or message changes. Owner can restore public pricing by disabling prelaunch mode after approving launch readiness.

Review disposition: P1 stale prelaunch assertions fixed in the mobile menu, public CSP transition and child-title test. New prelaunch route/sitemap test passed on first CI. CI run 1 found only these three stale expectations; run 2 verifies the corrected suite.
