# Rollback runbook

Use this when a released change is making the site, the desk or billing worse and it has to be backed out. It does **not** authorize a release, a production data change, or switching on any live provider. Everything that touches real money, real customers or production data needs Chris's explicit say-so first.

**The one rule: we roll the screens and code back, never the database.** Every database change in this project is additive (new tables and columns that old code simply ignores), so old code runs fine on the newer database. Dropping a table or restoring over production would lose real customer, billing or signature data and is never part of a rollback.

## Decide how big the problem is

1. **A setting or switch is the cause** (for example customer email or Automatic renewals): turn the owner switch off in the desk (Settings). No code change. Stop here if that fixes it.
2. **A recent change is wrong but nothing is being charged or sent wrongly:** go to "Back out a change" below and let the next daily release carry the fix.
3. **Customers are being charged, emailed or shown wrong things right now:** tell Chris at once, turn off the affected owner switch first, then use "Restore the previous live site" with his approval.

## Back out a change (normal path)

1. In GitHub, open the pull request that introduced the change and note its merge commit.
2. Create a branch from the current `main`, named `ai/<tool>/revert-<topic>`.
3. Revert that merge commit onto the branch (`git revert -m 1 <merge commit>`). If it does not apply cleanly because later work touched the same files, revert by hand and say so in the pull request.
4. Add one regression test or scenario assertion for what went wrong, or name the existing one that now guards it.
5. Open a pull request into `main` (never commit to `main` or `live`). Wait for the exact-head `ci` check to be green, then merge.
6. The daily release job promotes the checked `main` to `live` on its own schedule. Do not promote by hand.
7. Write what happened in `docs/STATUS.md`.

## Restore the previous live site (urgent, with Chris's approval)

1. In the Vercel dashboard for this project, open Deployments and use **Instant Rollback** on the last good production deployment. This swaps the serving site back in seconds and does not touch the database or the `live` branch.
2. Understand the side effect: Vercel stops automatically promoting new deployments after an instant rollback until someone promotes again. Make the fix in `main` (previous section) and ask Chris to confirm before promoting the fixed deployment.
3. Do not force-push `live` and do not run a manual production deployment.

## If a database change itself is the problem

1. Do not delete the new tables or columns and do not run SQL against production.
2. Write a new additive migration that fixes the data or relaxes the constraint, test it on the throwaway database (`npm run test:db`), and release it the normal way.
3. If rows were damaged, recover them in an isolated database by following `docs/runbooks/RESTORE.md`, compare, and let Chris decide what is copied back.

## Check it worked

1. The pull request's exact-head `ci` is green; the integrated scenarios (`tests/scenarios/`, listed in `docs/LAUNCH-LEDGER.md`) all pass.
2. Open the desk **Today** page and the public home page and confirm they load; open one customer account page.
3. Regenerate the ledger with `npm run ledger` if a plan or checklist line changed, and confirm no line moved from PROVEN to OPEN by accident.
4. For payments or email trouble, also read `docs/runbooks/PROVIDER-OUTAGE.md` and `docs/runbooks/UNKNOWN-STRIPE-STATE.md` before anyone re-runs anything.

## Drill

The revert step is rehearsed on a throwaway branch (never pushed): revert a merged pull request's merge commit and confirm it applies cleanly and leaves only that pull request's files changed. The database side has no rollback step by design, which `prisma/migrations` and `scripts/check-migrations.mjs` enforce (additive only).

Last drilled: 2026-10-17 — reverted the merge commit of pull request #493 on a scratch branch; it applied cleanly and touched only that pull request's six files. The Vercel Instant Rollback step has not been drilled and needs Chris's dashboard; it is listed as an open item in `docs/LAUNCH-LEDGER.md`.
