# SEC-NEXT-PATCH — verified compatible security dependency repair

Baseline: main `059fa296c37f160163e6428c3ff6770f7ef3e790`, merged #424.
Owner authorized repository improvements; AGENTS requires security repairs separately.
One dependency risk boundary, no schema migration or product/business contract change.

## Change and source

Pin Next.js and its matching eslint-config-next from 16.3.6 to **16.3.8**;
refresh their actual lockfile resolutions and perform a real clean generation/install.
Npm registry metadata confirms both versions exist; actual npm audit ranges for
six Next advisories were >=16.x <16.3.8. Review primary Next maintainer advisories:
GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv,
GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4.
Source format: https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4
No blanket audit fix, framework downgrade, unreviewed major override or provider change.

## Prove before merge

- Real clean `work -- install` exercises the new generation/dependency bootstrap.
- Read the installed Next upgrade/version guidance; no application API changes inferred.
- `npm run check:preflight` and `check:work`; index/link and secret checks; typecheck/lint.
- Focused session/preview-database safety tests, then full exact-head Actions CI's
  existing PostgreSQL, build, authenticated browser/security/axe suites and release-policy.
- Actual npm audit readback: Next no longer listed. Do not claim zero advisories
  while the separate development-tool braces advisory remains.
- Review actual bot output and threads; explicit manual waiver only when unavailable.

## Separate upstream follow-up

GHSA-vfj7-8cjw-p6xm affects braces <=3.0.3 in the development lint dependency chain.
A 3.0.4 patch lookup returned E404. The audit suggested a major eslint-config-next 14
**downgrade**, not an acceptable automatic Next 16 repair. No untrusted customer glob
input found in lint. Record precise reopening condition: compatible published patch
or reviewed parent update; investigate again then. No unsupported override or false
clean audit. This advisory does not block the independent Next patch or approved D12.

## Completion and handoff

Implementation is on this branch; actual check/merge evidence is in the PR/STATUS.
After verified merge, use the existing compact five-PR development continuation to
resume W-22D12; preserve CPA IN-79, real TEST acceptance, LIVE/money-out gates and
scheduled checked main-to-live releases. No manual deployment.
